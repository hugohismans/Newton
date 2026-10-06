import { Audio } from './audio';
import { Background } from './background';
import { Collider } from './collide';
import { Controls, Input } from './input';
import { ORDER, ROOMS } from './levels';
import { Vec, clamp, easeInOut, lerp, pointInPolygon, v } from './math';
import { Particles } from './particles';
import { Abilities, P, Player } from './player';
import { Cam, RoomState, RoomView, drawRoom, hexA, setCam } from './render';
import { RoomDef } from './room';
import { ABILITY_CARDS, hintText } from './text';

type Mode = 'title' | 'play' | 'dying' | 'wipe' | 'dive' | 'rise' | 'pause' | 'card' | 'end';

interface Save {
  room: string;
  abilities: Abilities;
  collected: string[];
  deaths: number;
  time: number;
}

interface Frame {
  id: string;
  portal: number;
}

interface MenuItem {
  label: () => string;
  act: () => void;
}

interface Transition {
  parent: RoomDef;
  child: RoomDef;
  portal: number;
  k: number;
  /** Fixed point of the zoom, parent coords. */
  P: Vec;
  c0: Vec;
  /** child → parent mapping. */
  T: (p: Vec) => Vec;
  Ti: (p: Vec) => Vec;
  t: number;
  dur: number;
  playerFrom: Vec;
  parentState: RoomState;
  childState: RoomState;
}

const SAVE_KEY = 'newton-save-v1';
const DT = 1 / 60;
const VIEW_UNITS = 184;

const freshSave = (): Save => ({
  room: ORDER[0],
  abilities: { wallJump: false, dash: false },
  collected: [],
  deaths: 0,
  time: 0,
});

export class Game {
  private ctx: CanvasRenderingContext2D;
  private bg: Background;
  private audio = new Audio();
  private input: Input;
  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private unit = 1;
  private safe = { l: 0, r: 0, t: 0, b: 0 };

  private save: Save = freshSave();
  private hasSave = false;
  private collected = new Set<string>();
  private def!: RoomDef;
  private view!: RoomView;
  private world = new Collider();
  private state!: RoomState;
  private views = new Map<string, RoomView>();
  private stack: Frame[] = [];
  private player = new Player(0, 0);
  private cam: Cam = { x: 0, y: 0, s: 1 };
  private camPrev: Vec = v(0, 0);
  private particles = new Particles();
  private shake = 0;
  private mode: Mode = 'title';
  private modeT = 0;
  private time = 0;
  private acc = 0;
  private trans: Transition | null = null;
  private wipe: { t: number; mid: () => void; done: boolean } | null = null;
  private banner = { text: '', sub: '', t: 0 };
  private card: { title: string; body: string; t: number } | null = null;
  private menu: { title: string; items: MenuItem[]; sel: number; rects: DOMRect[] } | null = null;
  private prevY = 0;
  private bgDepth = 0;
  private bgMix = 0;
  private slowFrames = 0;
  private roomEnterT = 0;
  private dyingPos = v(0, 0);

  constructor(bgCanvas: HTMLCanvasElement, private fg: HTMLCanvasElement, private safeEl: HTMLElement) {
    this.ctx = fg.getContext('2d')!;
    this.bg = new Background(bgCanvas);
    this.input = new Input(fg);
    this.input.onGesture = () => this.audio.unlock();
    this.loadSave();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.resize();
    // Dev helpers: ?room=<id> jumps straight into a room, &overview frames it whole.
    const q = new URLSearchParams(location.search);
    const dbg = q.get('room');
    if (dbg && ROOMS[dbg]) {
      this.overview = q.has('overview');
      if (q.has('all')) this.save.abilities = { wallJump: true, dash: true };
      const at = q.get('at')?.split(',').map(Number);
      this.loadRoom(dbg, at && at.length === 2 ? v(at[0], at[1]) : undefined);
      const st = q.get('stack');
      if (st) this.stack = st.split('|').map((f) => ({ id: f.split(':')[0], portal: +f.split(':')[1] }));
      this.setMode('play');
      return;
    }
    this.loadRoom(this.save.room);
    this.openTitle();
  }
  private overview = false;

  // ---------- persistence ----------

  private loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Save;
        if (ROOMS[s.room]) {
          this.save = { ...freshSave(), ...s };
          this.hasSave = true;
        }
      }
    } catch {
      /* storage unavailable */
    }
    this.collected = new Set(this.save.collected);
  }

  private writeSave() {
    this.save.collected = [...this.collected];
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch {
      /* storage unavailable */
    }
  }

  // ---------- layout ----------

  private resize() {
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.fg.width = Math.round(this.vw * this.dpr);
    this.fg.height = Math.round(this.vh * this.dpr);
    this.bg.resize(this.vw, this.vh);
    const r = this.safeEl.getBoundingClientRect();
    this.safe = { l: r.left, t: r.top, r: this.vw - r.right, b: this.vh - r.bottom };
    this.input.layout(this.vw, this.vh, this.safe);
    // Landscape: fixed height in world units. Portrait: fixed width.
    this.unit = this.vw >= this.vh ? this.vh / VIEW_UNITS : this.vw / (VIEW_UNITS * 1.1);
    this.cam.s = this.unit;
  }

  // ---------- rooms ----------

  private viewFor(id: string) {
    let rv = this.views.get(id);
    if (!rv) this.views.set(id, (rv = new RoomView(ROOMS[id])));
    return rv;
  }

  private newState(def: RoomDef): RoomState {
    return {
      collected: this.collected,
      refillTimers: new Map(),
      exitOpen: (def.requires ?? []).every((r) => this.collected.has(r)),
      activePortal: -1,
    };
  }

  private buildCollider(def: RoomDef) {
    const c = new Collider();
    def.solids.forEach((s, i) => c.addPolyline(s.poly, true, i));
    if (def.shape) c.addPolyline(def.shape, true, -2);
    else {
      const { w, h, walls } = def;
      const ext = 400;
      if (walls.left) c.addPolyline([v(0, -ext), v(0, h + (walls.bottom ? 0 : ext))], false, -2);
      if (walls.right) c.addPolyline([v(w, -ext), v(w, h + (walls.bottom ? 0 : ext))], false, -2);
      if (walls.top) c.addPolyline([v(-ext, 0), v(w + ext, 0)], false, -2);
      if (walls.bottom) c.addPolyline([v(-ext, h), v(w + ext, h)], false, -2);
    }
    return c;
  }

  private loadRoom(id: string, at?: Vec) {
    this.def = ROOMS[id];
    this.view = this.viewFor(id);
    this.world = this.buildCollider(this.def);
    this.state = this.newState(this.def);
    const p = at ?? this.def.spawn;
    this.player.teleport(p.x, p.y);
    this.player.maxDashes = 1;
    this.particles.clear();
    const c = this.camTarget(this.def, p, true);
    this.cam.x = c.x;
    this.cam.y = c.y;
    this.camPrev = v(c.x, c.y);
    this.roomEnterT = this.time;
    this.bgMix = this.def.chapter === 2 ? 1 : 0;
    this.bgDepth = this.stack.length;
    this.audio.setDepth(this.stack.length);
  }

  private showBanner(text: string, sub = '') {
    this.banner = { text, sub, t: 3 };
  }

  private enterMainRoom(id: string) {
    this.stack = [];
    this.loadRoom(id);
    this.save.room = id;
    this.writeSave();
    const n = ORDER.indexOf(id);
    this.showBanner(this.def.name, this.def.chapter === 1 ? `I · Flocon — ${n + 1}` : `II · Tapis — ${n + 1}`);
  }

  private camTarget(def: RoomDef, p: Vec, snap = false): Vec {
    const halfW = this.vw / this.unit / 2;
    const halfH = this.vh / this.unit / 2;
    let x = p.x + (snap ? 0 : this.player.facing * 14 + this.player.vel.x * 0.08);
    let y = p.y - 8 + (snap ? 0 : clamp(this.player.vel.y * 0.08, -10, 18));
    const pad = 24;
    x = def.w + pad * 2 <= halfW * 2 ? def.w / 2 : clamp(x, halfW - pad, def.w - halfW + pad);
    y = def.h + pad * 2 <= halfH * 2 ? def.h / 2 : clamp(y, halfH - pad, def.h - halfH + pad);
    return v(x, y);
  }

  // ---------- main loop ----------

  frame(dtReal: number) {
    dtReal = Math.min(dtReal, 0.1);
    if (dtReal > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90) {
      this.bg.degrade();
      this.slowFrames = 0;
    }
    this.acc += dtReal;
    let steps = 0;
    while (this.acc >= DT && steps < 5) {
      this.acc -= DT;
      this.step(DT);
      steps++;
    }
    if (steps === 5) this.acc = 0;
    this.particles.update(dtReal);
    this.render(this.acc / DT);
  }

  private step(dt: number) {
    this.time += dt;
    this.modeT += dt;
    const c = this.input.read();
    this.banner.t -= dt;

    switch (this.mode) {
      case 'title':
      case 'pause':
      case 'end':
        this.updateMenu(c);
        break;
      case 'card':
        if (this.card) this.card.t += dt;
        if (this.card && this.card.t > 0.9 && (c.jumpPressed || c.dashPressed || c.anyPressed)) {
          this.card = null;
          this.setMode('play');
        }
        break;
      case 'play':
        this.updatePlay(dt, c);
        break;
      case 'dying':
        if (this.modeT > 0.55) {
          this.startWipe(() => {
            this.loadRoomKeepStack(this.def.id);
          });
        }
        break;
      case 'wipe':
        this.updateWipe(dt);
        break;
      case 'dive':
      case 'rise':
        this.updateTransition(dt);
        break;
    }
    this.prevY = c.y;
  }

  private setMode(m: Mode) {
    this.mode = m;
    this.modeT = 0;
  }

  private loadRoomKeepStack(id: string) {
    const stack = this.stack;
    this.loadRoom(id);
    this.stack = stack;
    this.bgDepth = stack.length;
  }

  private updatePlay(dt: number, c: Controls) {
    if (c.pausePressed) {
      this.openPause();
      return;
    }
    this.save.time += dt;
    const pl = this.player;
    pl.update(dt, c, this.world, this.save.abilities);
    for (const e of pl.events) this.onPlayerEvent(e);

    // Camera.
    this.camPrev = v(this.cam.x, this.cam.y);
    const tgt = this.camTarget(this.def, pl.pos);
    const f = 1 - Math.exp(-dt * 7);
    this.cam.x += (tgt.x - this.cam.x) * f;
    this.cam.y += (tgt.y - this.cam.y) * f;
    this.shake = Math.max(0, this.shake - dt * 30);

    // Refill crystals.
    for (const [id, tm] of this.state.refillTimers) {
      const n = tm - dt;
      if (n <= 0) {
        this.state.refillTimers.delete(id);
        const it = this.def.items.find((i) => i.id === id);
        if (it) this.particles.emit(it.x, it.y, 10, { color: '#7dffb8', speed: 30, max: 0.5 });
      } else this.state.refillTimers.set(id, n);
    }

    // Items.
    for (const it of this.def.items) {
      if (this.collected.has(it.id) || this.state.refillTimers.has(it.id)) continue;
      const d = Math.hypot(it.x - pl.pos.x, it.y - pl.pos.y);
      if (it.kind === 'refill') {
        if (d < 9 && pl.dashes < pl.maxDashes && this.save.abilities.dash) {
          pl.dashes = pl.maxDashes;
          this.state.refillTimers.set(it.id, 2.5);
          this.audio.refill();
          this.particles.emit(it.x, it.y, 18, { color: '#7dffb8', speed: 70, max: 0.5 });
          pl.freeze = 0.04;
        }
        continue;
      }
      if (d > 11) continue;
      this.collected.add(it.id);
      if (it.kind === 'fragment') {
        this.audio.pickup();
        this.particles.emit(it.x, it.y, 40, { color: '#ffe39a', speed: 90, max: 0.9 });
        this.showBanner('Fragment trouvé', 'La sortie s’ouvre…');
        this.writeSave();
      } else {
        this.save.abilities[it.kind] = true;
        this.audio.ability();
        this.particles.emit(it.x, it.y, 70, { color: it.kind === 'dash' ? '#ff7ac8' : '#9fd4ff', speed: 140, max: 1.1 });
        this.shake = 4;
        const cd = ABILITY_CARDS[it.kind];
        this.card = { title: cd.title, body: cd.body[this.input.device], t: 0 };
        this.writeSave();
        this.setMode('card');
      }
    }
    // Exit gates react to newly collected fragments in any room.
    for (const st of [this.state]) st.exitOpen = (this.def.requires ?? []).every((r) => this.collected.has(r));

    // Portal under the player.
    const owner = pl.grounded ? pl.groundOwner : -1;
    this.state.activePortal = owner >= 0 && this.def.solids[owner]?.portal ? owner : -1;
    if (this.state.activePortal >= 0 && (c.divePressed || c.downPressed)) {
      this.startDive(this.state.activePortal);
      return;
    }

    // Hazards.
    if (this.hitsSpike(pl.pos) || pl.pos.y > this.def.h + 40 || pl.pos.y < -200) {
      this.die();
      return;
    }

    // Exit.
    if (this.state.exitOpen && Math.hypot(this.def.exit.x - pl.pos.x, this.def.exit.y - pl.pos.y) < 10) {
      this.audio.exit();
      this.particles.emit(this.def.exit.x, this.def.exit.y, 30, { color: '#ffffff', speed: 80 });
      if (this.stack.length > 0) this.startRise();
      else {
        const next = ORDER[ORDER.indexOf(this.def.id) + 1];
        this.startWipe(() => {
          if (next) this.enterMainRoom(next);
          else {
            this.save.room = ORDER[0];
            this.writeSave();
            this.openEnd();
          }
        });
      }
    }
  }

  private hitsSpike(p: Vec) {
    const r = P.r * 0.7;
    for (const tri of this.def.spikes) {
      const minX = Math.min(tri[0].x, tri[1].x, tri[2].x) - r;
      const maxX = Math.max(tri[0].x, tri[1].x, tri[2].x) + r;
      const minY = Math.min(tri[0].y, tri[1].y, tri[2].y) - r;
      const maxY = Math.max(tri[0].y, tri[1].y, tri[2].y) + r;
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      if (pointInPolygon(p, tri)) return true;
      for (let i = 0; i < 3; i++) {
        const a = tri[i];
        const b = tri[(i + 1) % 3];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
        if (Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) < r) return true;
      }
    }
    return false;
  }

  private onPlayerEvent(e: string) {
    const pl = this.player;
    const foot = v(pl.pos.x, pl.pos.y + P.r);
    switch (e) {
      case 'jump':
        this.audio.jump();
        this.particles.emit(foot.x, foot.y, 6, { color: '#cfe8ff', speed: 25, angle: -Math.PI / 2, spread: 2.4, max: 0.35 });
        break;
      case 'walljump':
        this.audio.wallJump();
        this.particles.emit(pl.pos.x - pl.facing * P.r, pl.pos.y, 8, {
          color: '#cfe8ff',
          speed: 35,
          angle: pl.facing > 0 ? 0 : Math.PI,
          spread: 1.6,
          max: 0.35,
        });
        break;
      case 'land':
        this.audio.land();
        this.particles.emit(foot.x, foot.y, 8, { color: '#cfe8ff', speed: 30, angle: -Math.PI / 2, spread: 3, max: 0.3 });
        break;
      case 'dash':
        this.audio.dash();
        this.shake = 2.5;
        this.particles.emit(pl.pos.x, pl.pos.y, 14, { color: '#ff9ad6', speed: 60, max: 0.4 });
        vibrate(12);
        break;
      case 'super':
        this.audio.wallJump();
        this.particles.emit(foot.x, foot.y, 14, { color: '#ffe39a', speed: 60, max: 0.4 });
        break;
      case 'refill':
        break;
    }
  }

  private die() {
    this.save.deaths++;
    this.audio.death();
    this.shake = 6;
    vibrate(40);
    this.dyingPos = v(this.player.pos.x, this.player.pos.y);
    const col = this.playerColor();
    this.particles.emit(this.dyingPos.x, this.dyingPos.y, 36, { color: col, speed: 110, max: 0.8, size: 2 });
    this.setMode('dying');
  }

  // ---------- transitions ----------

  private startWipe(mid: () => void) {
    this.wipe = { t: 0, mid, done: false };
    this.setMode('wipe');
  }

  private updateWipe(dt: number) {
    const w = this.wipe!;
    w.t += dt;
    if (!w.done && w.t >= 0.32) {
      w.done = true;
      w.mid();
      if (this.mode !== 'wipe') {
        // mid() opened a menu (end screen).
        this.wipe = null;
        return;
      }
    }
    if (w.t >= 0.7) {
      this.wipe = null;
      this.setMode('play');
    }
  }

  private makeTransition(parent: RoomDef, portalIdx: number, child: RoomDef, c0: Vec, c1Child: Vec): Transition {
    const pf = parent.solids[portalIdx].frame!;
    const cf = child.frame!;
    const k = cf.size / pf.size;
    const T = (p: Vec) => v(pf.cx + (p.x - cf.cx) / k, pf.cy + (p.y - cf.cy) / k);
    const Ti = (p: Vec) => v(cf.cx + (p.x - pf.cx) * k, cf.cy + (p.y - pf.cy) * k);
    const cEnd = T(c1Child);
    const Pt = v((k * cEnd.x - c0.x) / (k - 1), (k * cEnd.y - c0.y) / (k - 1));
    return {
      parent,
      child,
      portal: portalIdx,
      k,
      P: Pt,
      c0,
      T,
      Ti,
      t: 0,
      dur: 1.35,
      playerFrom: v(this.player.pos.x, this.player.pos.y),
      parentState: this.newState(parent),
      childState: this.newState(child),
    };
  }

  private startDive(portalIdx: number) {
    const parent = this.def;
    const child = ROOMS[parent.solids[portalIdx].portal!];
    const c1 = this.camTarget(child, child.spawn, true);
    this.trans = this.makeTransition(parent, portalIdx, child, v(this.cam.x, this.cam.y), c1);
    this.trans.parentState.activePortal = portalIdx;
    this.audio.dive();
    vibrate(20);
    this.setMode('dive');
  }

  private startRise() {
    const top = this.stack[this.stack.length - 1];
    const parent = ROOMS[top.id];
    const child = this.def;
    const ret = parent.solids[top.portal].ret!;
    // Camera in the parent once we're back, computed with the player at the return point.
    this.player.pos = v(ret.x, ret.y);
    const c0 = this.camTarget(parent, ret, true);
    this.trans = this.makeTransition(parent, top.portal, child, c0, v(this.cam.x, this.cam.y));
    this.trans.playerFrom = v(ret.x, ret.y);
    this.audio.rise();
    this.setMode('rise');
  }

  private updateTransition(dt: number) {
    const tr = this.trans!;
    tr.t += dt;
    const e = this.zoomProgress();
    this.bgDepth = this.stack.length + (this.mode === 'dive' ? e : e - 1);
    if (tr.t < tr.dur) return;
    if (this.mode === 'dive') {
      this.stack.push({ id: tr.parent.id, portal: tr.portal });
      this.loadRoomKeepStack(tr.child.id);
      this.showBanner(tr.child.name, `Profondeur ${this.stack.length}`);
      this.particles.emit(this.player.pos.x, this.player.pos.y, 24, { color: '#ffffff', speed: 60, max: 0.6 });
    } else {
      const top = this.stack.pop()!;
      const ret = tr.parent.solids[top.portal].ret!;
      this.loadRoomKeepStack(top.id);
      this.player.teleport(ret.x, ret.y);
      const c = this.camTarget(this.def, ret, true);
      this.cam.x = c.x;
      this.cam.y = c.y;
      this.particles.emit(ret.x, ret.y, 24, { color: '#ffffff', speed: 60, max: 0.6 });
      if (this.stack.length === 0) {
        const n = ORDER.indexOf(this.def.id);
        this.showBanner(this.def.name, this.def.chapter === 1 ? `I · Flocon — ${n + 1}` : `II · Tapis — ${n + 1}`);
      }
    }
    this.trans = null;
    this.setMode('play');
  }

  /** 0 = parent at normal zoom, 1 = child at normal zoom. */
  private zoomProgress() {
    const tr = this.trans!;
    const u = easeInOut(clamp(tr.t / tr.dur, 0, 1));
    return this.mode === 'dive' ? u : 1 - u;
  }

  // ---------- menus ----------

  private openTitle() {
    const items: MenuItem[] = [];
    if (this.hasSave)
      items.push({
        label: () => 'Continuer',
        act: () => this.startGame(false),
      });
    items.push({ label: () => (this.hasSave ? 'Nouvelle partie' : 'Jouer'), act: () => this.startGame(true) });
    items.push({ label: () => `Son : ${this.audio.muted ? 'non' : 'oui'}`, act: () => this.audio.setMuted(!this.audio.muted) });
    this.menu = { title: '', items, sel: 0, rects: [] };
    this.setMode('title');
  }

  private startGame(fresh: boolean) {
    if (fresh) {
      this.save = freshSave();
      this.collected = new Set();
    }
    this.hasSave = true;
    this.menu = null;
    this.enterMainRoom(this.save.room);
    this.startWipeIn();
  }

  private startWipeIn() {
    this.wipe = { t: 0.32, mid: () => {}, done: true };
    this.setMode('wipe');
  }

  private openPause() {
    this.menu = {
      title: 'Pause',
      sel: 0,
      rects: [],
      items: [
        { label: () => 'Reprendre', act: () => this.closeMenu() },
        {
          label: () => 'Recommencer la salle',
          act: () => {
            this.closeMenu();
            this.startWipe(() => this.loadRoomKeepStack(this.def.id));
          },
        },
        { label: () => `Son : ${this.audio.muted ? 'non' : 'oui'}`, act: () => this.audio.setMuted(!this.audio.muted) },
        {
          label: () => 'Menu principal',
          act: () => {
            this.writeSave();
            this.stack = [];
            this.loadRoom(this.save.room);
            this.openTitle();
          },
        },
      ],
    };
    this.setMode('pause');
  }

  private openEnd() {
    this.menu = {
      title: 'end',
      sel: 0,
      rects: [],
      items: [
        {
          label: () => 'Rejouer',
          act: () => {
            this.startGame(true);
          },
        },
      ],
    };
    this.setMode('end');
  }

  private closeMenu() {
    this.menu = null;
    this.setMode('play');
  }

  private updateMenu(c: Controls) {
    const m = this.menu;
    if (!m) return;
    const taps = this.input.taps.splice(0);
    if (this.mode === 'pause' && c.pausePressed) {
      this.closeMenu();
      return;
    }
    if (this.modeT < 0.25) return;
    if (c.y !== 0 && c.y !== this.prevY) {
      m.sel = (m.sel + c.y + m.items.length) % m.items.length;
      this.audio.click();
    }
    for (const tp of taps) {
      const i = m.rects.findIndex((r) => tp.x >= r.left && tp.x <= r.right && tp.y >= r.top && tp.y <= r.bottom);
      if (i >= 0) {
        m.sel = i;
        this.audio.click();
        m.items[i].act();
        return;
      }
    }
    if (taps.length === 0 && (c.jumpPressed || c.divePressed)) {
      this.audio.click();
      m.items[m.sel].act();
    }
  }

  // ---------- rendering ----------

  private playerColor() {
    const ab = this.save.abilities;
    if (!ab.dash) return '#eaf6ff';
    return this.player.dashes > 0 ? '#ff7ac8' : '#7ab8ff';
  }

  private render(alpha: number) {
    const ctx = this.ctx;
    const t = this.time;
    const depth = this.bgDepth;
    const ch = this.trans ? (this.zoomProgress() > 0.5 ? this.trans.child.chapter : this.trans.parent.chapter) : this.def.chapter;
    this.bgMix += ((ch === 2 ? 1 : 0) - this.bgMix) * 0.05;
    const inMenu = this.mode === 'title' || this.mode === 'end';
    const camX = this.cam.x;
    const camY = this.cam.y;
    this.bg.draw(t, {
      centerX: (ch === 2 ? -0.74364 : 0.0) + camX * 0.00035 * (ch === 2 ? 0.012 : 2.6) * Math.pow(0.33, depth),
      centerY: (ch === 2 ? 0.13182 : 0.0) + camY * 0.00035 * (ch === 2 ? 0.012 : 2.6) * Math.pow(0.33, depth),
      zoom: (ch === 2 ? 0.012 : 2.6) * Math.pow(0.33, depth) * (inMenu ? 1.0 : 1),
      mix: this.bgMix,
      hue: depth * 0.12 + (ch === 2 ? 0.55 : 0),
      bright: inMenu ? 1.0 : 0.85,
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fg.width, this.fg.height);

    if (this.mode === 'title') {
      this.drawTitle();
      return;
    }
    if (this.mode === 'end') {
      this.drawEnd();
      return;
    }

    if (this.trans) this.drawTransition();
    else {
      const sx = (Math.random() - 0.5) * this.shake * 0.5;
      const sy = (Math.random() - 0.5) * this.shake * 0.5;
      const cam: Cam = {
        x: lerp(this.camPrev.x, this.cam.x, this.mode === 'play' ? alpha : 1) + sx,
        y: lerp(this.camPrev.y, this.cam.y, this.mode === 'play' ? alpha : 1) + sy,
        s: this.unit,
      };
      if (this.overview) {
        cam.x = this.def.w / 2;
        cam.y = this.def.h / 2;
        cam.s = Math.min(this.vw / (this.def.w + 40), this.vh / (this.def.h + 40));
      }
      setCam(ctx, cam, this.vw, this.vh, this.dpr);
      drawRoom(ctx, this.view, this.state, cam, t);
      if (this.overview) this.drawGrid(cam);
      this.drawHints(cam);
      this.particles.draw(ctx);
      if (this.mode !== 'dying') this.drawPlayer(cam, alpha);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHud();
    if (this.input.device === 'touch' && (this.mode === 'play' || this.mode === 'dying')) this.drawTouch();
    if (this.wipe) this.drawWipe();
    if (this.mode === 'card') this.drawCard();
    if (this.mode === 'pause') this.drawMenu();
  }

  private drawTransition() {
    const ctx = this.ctx;
    const tr = this.trans!;
    const e = this.zoomProgress();
    const zoom = Math.pow(tr.k, e);
    const center = v(tr.P.x + (tr.c0.x - tr.P.x) / zoom, tr.P.y + (tr.c0.y - tr.P.y) / zoom);
    const pCam: Cam = { x: center.x, y: center.y, s: this.unit * zoom };
    const ci = tr.Ti(center);
    const cCam: Cam = { x: ci.x, y: ci.y, s: (this.unit * zoom) / tr.k };
    const pv = this.viewFor(tr.parent.id);
    const cv = this.viewFor(tr.child.id);

    const pa = 1 - smooth(0.55, 0.95, e);
    if (pa > 0) {
      ctx.globalAlpha = pa;
      setCam(ctx, pCam, this.vw, this.vh, this.dpr);
      drawRoom(ctx, pv, tr.parentState, pCam, this.time);
      ctx.globalAlpha = 1;
    }
    // The inside of the portal reveals the child room, then the child takes over.
    const a1 = smooth(0.02, 0.4, e);
    const a2 = smooth(0.45, 0.9, e);
    setCam(ctx, cCam, this.vw, this.vh, this.dpr);
    if (a1 > 0 && a2 < 1) {
      ctx.save();
      const clip = new Path2D();
      const cs = tr.child.shape;
      if (cs) {
        clip.moveTo(cs[0].x, cs[0].y);
        for (const p of cs) clip.lineTo(p.x, p.y);
        clip.closePath();
      } else clip.rect(0, 0, tr.child.w, tr.child.h);
      ctx.clip(clip);
      ctx.globalAlpha = a1 * (1 - a2);
      drawRoom(ctx, cv, tr.childState, cCam, this.time);
      ctx.restore();
    }
    if (a2 > 0) {
      ctx.globalAlpha = a2;
      drawRoom(ctx, cv, tr.childState, cCam, this.time);
      ctx.globalAlpha = 1;
    }

    // The player melts into the portal (dive) or pops out of it (rise).
    if (this.mode === 'dive') {
      const q = smooth(0, 0.3, e);
      const pf = tr.parent.solids[tr.portal].frame!;
      const pos = v(lerp(tr.playerFrom.x, pf.cx, q), lerp(tr.playerFrom.y, pf.cy, q));
      setCam(ctx, pCam, this.vw, this.vh, this.dpr);
      this.drawOrb(pos, (P.r * (1 - q)) / zoom + 0.0001, 1 - q);
    }
  }

  private drawGrid(cam: Cam) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1 / cam.s;
    ctx.font = `${10 / cam.s}px monospace`;
    for (let x = 0; x <= this.def.w; x += 20) {
      ctx.strokeStyle = x % 100 === 0 ? 'rgba(255,255,0,0.35)' : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.def.h);
      ctx.stroke();
      if (x % 100 === 0) (ctx.fillStyle = '#ff0', ctx.fillText(String(x), x + 1, 10 / cam.s));
    }
    for (let y = 0; y <= this.def.h; y += 20) {
      ctx.strokeStyle = y % 100 === 0 ? 'rgba(255,255,0,0.35)' : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.def.w, y);
      ctx.stroke();
      if (y % 100 === 0) (ctx.fillStyle = '#ff0', ctx.fillText(String(y), 1, y - 1));
    }
    ctx.fillStyle = '#0f0';
    ctx.beginPath();
    ctx.arc(this.def.spawn.x, this.def.spawn.y, 4, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  private drawOrb(p: Vec, r: number, a: number) {
    const ctx = this.ctx;
    ctx.globalAlpha = a;
    ctx.fillStyle = this.playerColor();
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawPlayer(cam: Cam, alpha: number) {
    const ctx = this.ctx;
    const pl = this.player;
    const a = this.mode === 'play' ? alpha : 1;
    const x = lerp(pl.prev.x, pl.pos.x, a);
    const y = lerp(pl.prev.y, pl.pos.y, a);
    const col = this.playerColor();
    // Dash afterimages.
    for (const tr of pl.trail) {
      ctx.globalAlpha = tr.life * 0.5;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, P.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Glow.
    const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
    g.addColorStop(0, hexA(col, 0.35));
    g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - 16, y - 16, 32, 32);
    // Hair.
    ctx.fillStyle = col;
    pl.hair.forEach((h, i) => {
      ctx.beginPath();
      ctx.arc(h.x, h.y, Math.max(0.6, 2.6 - i * 0.35), 0, Math.PI * 2);
      ctx.fill();
    });
    // Body (squash & stretch, anchored at the feet).
    ctx.save();
    ctx.translate(x, y + P.r);
    ctx.scale(pl.scale.x, pl.scale.y);
    ctx.beginPath();
    ctx.arc(0, -P.r, P.r + 0.3, 0, Math.PI * 2);
    ctx.fillStyle = pl.flash > 0 ? '#ffffff' : col;
    ctx.fill();
    ctx.lineWidth = 0.9 / cam.s;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    // Eyes.
    ctx.fillStyle = '#0a0d1c';
    const ex = pl.facing * 1.6;
    const blink = Math.sin(this.time * 1.3) > 0.985 ? 0.25 : 1;
    for (const o of [-1.1, 1.3]) {
      ctx.beginPath();
      ctx.ellipse(ex + o, -P.r - 0.6, 0.55, 1.1 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHints(cam: Cam) {
    const ctx = this.ctx;
    const fontPx = clamp(this.unit * 2.6, 11, 17);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${fontPx / cam.s}px 'Sora', system-ui, sans-serif`;
    for (const h of this.def.hints) {
      if (h.key === 'dash' && !this.save.abilities.dash) continue;
      const d = Math.hypot(h.x - this.player.pos.x, h.y - this.player.pos.y);
      const a = clamp(1 - (d - 70) / 80, 0, 1) * clamp((this.time - this.roomEnterT) * 2, 0, 1);
      if (a <= 0) continue;
      const text = hintText(h.key, this.input.device);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const w = ctx.measureText(text).width;
      const ph = (fontPx * 1.7) / cam.s;
      roundRect(ctx, h.x - w / 2 - 6 / cam.s, h.y - ph / 2, w + 12 / cam.s, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = '#eef6ff';
      ctx.fillText(text, h.x, h.y + 0.5 / cam.s);
    }
    ctx.restore();
  }

  private drawHud() {
    const ctx = this.ctx;
    const s = clamp(Math.min(this.vw, this.vh) / 400, 0.8, 1.4);
    // Banner.
    if (this.banner.t > 0) {
      const a = clamp(this.banner.t, 0, 1) * clamp((3 - this.banner.t) * 3, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(220, 235, 255, 0.75)';
      ctx.font = `600 ${11 * s}px 'Sora', system-ui, sans-serif`;
      const top = this.safe.t + this.vh * 0.14;
      ctx.fillText(this.banner.sub.toUpperCase(), this.vw / 2, top);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${26 * s}px 'Sora', system-ui, sans-serif`;
      ctx.fillText(this.banner.text, this.vw / 2, top + 30 * s);
      ctx.restore();
    }
    // Depth & fragments, top right.
    const x = this.vw - this.safe.r - 18 * s;
    let y = this.safe.t + 26 * s;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = `600 ${12 * s}px 'Sora', system-ui, sans-serif`;
    const frags = [...this.collected].filter((id) => id.startsWith('frag')).length;
    if (frags > 0) {
      ctx.fillStyle = '#ffe39a';
      ctx.fillText(`✦ ${frags}`, x, y);
      y += 18 * s;
    }
    const depth = this.stack.length;
    if (depth > 0) {
      ctx.fillStyle = 'rgba(200, 230, 255, 0.85)';
      const label = `profondeur ${depth}`;
      ctx.fillText(label, x, y);
      // Nested squares glyph: one per level.
      const gx = x - ctx.measureText(label).width - 12 * s;
      ctx.strokeStyle = 'rgba(200,230,255,0.7)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= depth; i++) {
        const sz = 12 * s * Math.pow(0.5, i);
        ctx.strokeRect(gx - sz / 2, y - 4 * s - sz / 2, sz, sz);
      }
    }
    ctx.restore();
  }

  private drawTouch() {
    const ctx = this.ctx;
    const inp = this.input;
    const [jump, dash, dive, pause] = inp.buttons;
    dash.visible = this.save.abilities.dash;
    dive.visible = this.state.activePortal >= 0;
    ctx.save();
    // Stick.
    const R = inp.stickRadius();
    if (inp.stick) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(inp.stick.ox, inp.stick.oy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.arc(inp.stick.x, inp.stick.y, R * 0.42, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const ox = this.safe.l + R * 1.6;
      const oy = this.vh - this.safe.b - R * 1.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox, oy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(ox, oy, R * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    const btn = (b: typeof jump, held: boolean, icon: (r: number) => void, col = '255,255,255') => {
      if (!b.visible) return;
      ctx.fillStyle = `rgba(${col},${held ? 0.3 : 0.1})`;
      ctx.strokeStyle = `rgba(${col},${held ? 0.7 : 0.35})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.strokeStyle = `rgba(${col},0.85)`;
      ctx.fillStyle = `rgba(${col},0.85)`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      icon(b.r);
      ctx.restore();
    };
    btn(jump, inp.held('jump'), (r) => {
      ctx.beginPath();
      ctx.moveTo(-r * 0.32, r * 0.12);
      ctx.lineTo(0, -r * 0.22);
      ctx.lineTo(r * 0.32, r * 0.12);
      ctx.stroke();
    });
    btn(
      dash,
      inp.held('dash'),
      (r) => {
        ctx.beginPath();
        ctx.moveTo(r * 0.1, -r * 0.45);
        ctx.lineTo(-r * 0.2, r * 0.05);
        ctx.lineTo(r * 0.08, r * 0.05);
        ctx.lineTo(-r * 0.1, r * 0.45);
        ctx.stroke();
      },
      this.player.dashes > 0 ? '255,140,210' : '140,180,255',
    );
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    btn(
      dive,
      inp.held('dive'),
      (r) => {
        ctx.beginPath();
        ctx.arc(0, r * 0.05, r * (0.38 + 0.06 * pulse), 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.3);
        ctx.lineTo(0, r * 0.15);
        ctx.moveTo(-r * 0.15, 0);
        ctx.lineTo(0, r * 0.15);
        ctx.lineTo(r * 0.15, 0);
        ctx.stroke();
      },
      this.def.chapter === 2 ? '255,190,100' : '125,252,255',
    );
    btn(pause, false, (r) => {
      ctx.fillRect(-r * 0.28, -r * 0.3, r * 0.18, r * 0.6);
      ctx.fillRect(r * 0.1, -r * 0.3, r * 0.18, r * 0.6);
    });
    ctx.restore();
  }

  private drawWipe() {
    const ctx = this.ctx;
    const w = this.wipe!;
    const maxR = Math.hypot(this.vw, this.vh);
    const u = w.t < 0.32 ? 1 - easeInOut(w.t / 0.32) : easeInOut(clamp((w.t - 0.38) / 0.32, 0, 1));
    const pl = this.player;
    const sx = this.vw / 2 + (pl.pos.x - this.cam.x) * this.unit;
    const sy = this.vh / 2 + (pl.pos.y - this.cam.y) * this.unit;
    ctx.save();
    ctx.fillStyle = '#04050c';
    ctx.beginPath();
    ctx.rect(0, 0, this.vw, this.vh);
    if (u > 0) ctx.arc(sx, sy, u * maxR, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  }

  private drawCard() {
    const ctx = this.ctx;
    const c = this.card!;
    const a = clamp(c.t * 3, 0, 1);
    const s = clamp(Math.min(this.vw, this.vh) / 400, 0.8, 1.4);
    ctx.save();
    ctx.globalAlpha = a * 0.7;
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,220,255,0.8)';
    ctx.font = `600 ${12 * s}px 'Sora', system-ui, sans-serif`;
    ctx.fillText('NOUVELLE CAPACITÉ', this.vw / 2, this.vh * 0.36);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${38 * s}px 'Sora', system-ui, sans-serif`;
    ctx.fillText(c.title, this.vw / 2, this.vh * 0.36 + 44 * s);
    ctx.font = `400 ${15 * s}px 'Sora', system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(235,242,255,0.92)';
    wrapText(ctx, c.body, this.vw / 2, this.vh * 0.36 + 80 * s, Math.min(this.vw * 0.8, 460 * s), 21 * s);
    if (c.t > 0.9) {
      ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(this.time * 4));
      ctx.font = `600 ${12 * s}px 'Sora', system-ui, sans-serif`;
      ctx.fillText(this.input.device === 'touch' ? 'Touche pour continuer' : 'Appuie pour continuer', this.vw / 2, this.vh * 0.84);
    }
    ctx.restore();
  }

  private drawMenuItems(top: number, s: number) {
    const ctx = this.ctx;
    const m = this.menu!;
    m.rects = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    m.items.forEach((it, i) => {
      const y = top + i * 46 * s;
      const w = 240 * s;
      const h = 38 * s;
      const r = new DOMRect(this.vw / 2 - w / 2, y - h / 2, w, h);
      m.rects.push(r);
      const sel = i === m.sel && this.input.device !== 'touch';
      ctx.fillStyle = sel ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
      ctx.strokeStyle = sel ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, r.x, r.y, r.width, r.height, h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${15 * s}px 'Sora', system-ui, sans-serif`;
      ctx.fillText(it.label(), this.vw / 2, y + 1);
    });
  }

  private drawMenu() {
    const ctx = this.ctx;
    const s = clamp(Math.min(this.vw, this.vh) / 400, 0.8, 1.4);
    ctx.save();
    ctx.fillStyle = 'rgba(3,4,10,0.72)';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${30 * s}px 'Sora', system-ui, sans-serif`;
    ctx.fillText(this.menu!.title, this.vw / 2, this.vh * 0.22);
    this.drawMenuItems(this.vh * 0.22 + 60 * s, s);
    ctx.restore();
  }

  private drawTitle() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const s = clamp(Math.min(this.vw, this.vh) / 400, 0.8, 1.5);
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, this.vh);
    g.addColorStop(0, 'rgba(3,4,10,0.1)');
    g.addColorStop(1, 'rgba(3,4,10,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ty = this.vh * (this.vh > this.vw ? 0.3 : 0.24);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.min(64 * s, this.vw / 7)}px 'Sora', system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(120, 220, 255, 0.8)';
    ctx.shadowBlur = 24;
    ctx.fillText('N E W T O N', this.vw / 2, ty);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(220,235,255,0.8)';
    ctx.font = `400 ${14 * s}px 'Sora', system-ui, sans-serif`;
    ctx.fillText('un voyage au cœur des fractales', this.vw / 2, ty + 40 * s);
    this.drawMenuItems(ty + 100 * s, s);
    ctx.fillStyle = 'rgba(220,235,255,0.45)';
    ctx.font = `400 ${11 * s}px 'Sora', system-ui, sans-serif`;
    const hint =
      this.input.device === 'touch'
        ? 'Joue en paysage · plein écran recommandé'
        : 'Clavier : flèches/ZQSD · Espace/C saut · X/Maj dash  —  Manette compatible';
    ctx.fillText(hint, this.vw / 2, this.vh - this.safe.b - 22 * s);
    ctx.restore();
  }

  private drawEnd() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const s = clamp(Math.min(this.vw, this.vh) / 400, 0.8, 1.5);
    ctx.save();
    ctx.fillStyle = 'rgba(3,4,10,0.55)';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ty = this.vh * 0.25;
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${34 * s}px 'Sora', system-ui, sans-serif`;
    ctx.fillText('Fin du prototype', this.vw / 2, ty);
    ctx.font = `400 ${15 * s}px 'Sora', system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(230,240,255,0.85)';
    const m = Math.floor(this.save.time / 60);
    const sec = Math.floor(this.save.time % 60);
    const frags = [...this.collected].filter((id) => id.startsWith('frag')).length;
    ctx.fillText(
      `${m}:${String(sec).padStart(2, '0')}  ·  ${this.save.deaths} chute${this.save.deaths > 1 ? 's' : ''}  ·  ✦ ${frags}`,
      this.vw / 2,
      ty + 40 * s,
    );
    ctx.fillText('Merci d’avoir plongé.', this.vw / 2, ty + 66 * s);
    this.drawMenuItems(ty + 120 * s, s);
    ctx.restore();
  }
}

function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
