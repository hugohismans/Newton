export type Device = 'touch' | 'keyboard' | 'gamepad';

/** Snapshot the game reads every fixed step. Edges ("pressed") are latched until consumed. */
export interface Controls {
  x: number; // -1..1 digital
  y: number; // -1..1 digital, +1 = down
  jump: boolean;
  dash: boolean;
  jumpPressed: boolean;
  dashPressed: boolean;
  divePressed: boolean;
  downPressed: boolean;
  pausePressed: boolean;
  anyPressed: boolean;
}

interface TouchButton {
  id: 'jump' | 'dash' | 'dive' | 'pause';
  x: number;
  y: number;
  r: number;
  visible: boolean;
}

interface Stick {
  pointer: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

const KEY_LEFT = ['arrowleft', 'a', 'q'];
const KEY_RIGHT = ['arrowright', 'd'];
const KEY_UP = ['arrowup', 'w', 'z'];
const KEY_DOWN = ['arrowdown', 's'];
const KEY_JUMP = [' ', 'c', 'j', 'n'];
const KEY_DASH = ['x', 'shift', 'k', 'm'];
const KEY_DIVE = ['e', 'enter'];
const KEY_PAUSE = ['escape', 'p'];

export class Input {
  device: Device = 'ontouchstart' in window ? 'touch' : 'keyboard';
  private keys = new Set<string>();
  private latched = { jump: false, dash: false, dive: false, down: false, pause: false, any: false };
  private prevPad: boolean[] = [];
  private prevPadDown = false;
  private padAxes = { x: 0, y: 0 };
  private padHeld = { jump: false, dash: false };
  stick: Stick | null = null;
  private buttonPointers = new Map<number, TouchButton['id']>();
  buttons: TouchButton[] = [
    { id: 'jump', x: 0, y: 0, r: 40, visible: true },
    { id: 'dash', x: 0, y: 0, r: 32, visible: false },
    { id: 'dive', x: 0, y: 0, r: 30, visible: false },
    { id: 'pause', x: 0, y: 0, r: 20, visible: true },
  ];
  /** Last frame's touch-stick direction, used for the "down" edge. */
  private prevStickDown = false;
  private prevKeyDown = false;
  /** Pointer/touch taps in CSS pixels, consumed by menus. */
  taps: { x: number; y: number }[] = [];
  /** Called on the first user gesture (audio unlock). */
  onGesture: (() => void) | null = null;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (e.repeat) return;
      this.device = 'keyboard';
      this.keys.add(k);
      if (KEY_JUMP.includes(k)) this.latched.jump = true;
      if (KEY_DASH.includes(k)) this.latched.dash = true;
      if (KEY_DIVE.includes(k)) this.latched.dive = true;
      if (KEY_PAUSE.includes(k)) this.latched.pause = true;
      if (KEY_DOWN.includes(k)) this.latched.down = true;
      this.latched.any = true;
      this.onGesture?.();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    el.addEventListener('pointerdown', (e) => this.pointerDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.pointerMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.pointerUp(e));
    el.addEventListener('pointercancel', (e) => this.pointerUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  /** Lay out touch buttons in CSS pixels, inside the safe area. */
  layout(w: number, h: number, safe: { l: number; r: number; t: number; b: number }) {
    const s = Math.min(1.25, Math.max(0.8, Math.min(w, h) / 380));
    const [jump, dash, dive, pause] = this.buttons;
    jump.r = 42 * s;
    jump.x = w - safe.r - 28 * s - jump.r;
    jump.y = h - safe.b - 26 * s - jump.r;
    dash.r = 34 * s;
    dash.x = jump.x - jump.r - dash.r - 18 * s;
    dash.y = jump.y - 34 * s;
    dive.r = 30 * s;
    dive.x = jump.x - 6 * s;
    dive.y = jump.y - jump.r - dive.r - 30 * s;
    pause.r = 20 * s;
    pause.x = safe.l + 18 * s + pause.r;
    pause.y = safe.t + 14 * s + pause.r;
  }

  private pointerDown(e: PointerEvent) {
    e.preventDefault();
    this.taps.push({ x: e.clientX, y: e.clientY });
    if (this.taps.length > 8) this.taps.shift();
    if (e.pointerType === 'mouse') {
      // Mouse clicks only count as "any key" (menus); the game is played with keys.
      this.latched.any = true;
      this.onGesture?.();
      return;
    }
    this.device = 'touch';
    this.latched.any = true;
    this.onGesture?.();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
    const x = e.clientX;
    const y = e.clientY;
    const w = window.innerWidth;
    for (const b of this.buttons) {
      if (!b.visible || b.id === 'jump') continue;
      const reach = b.id === 'pause' ? b.r * 1.6 : b.r * 1.35;
      if (Math.hypot(x - b.x, y - b.y) < reach) {
        this.pressButton(b.id, e.pointerId);
        return;
      }
    }
    if (x < w * 0.45) {
      if (!this.stick) this.stick = { pointer: e.pointerId, ox: x, oy: y, x, y };
      return;
    }
    // The whole remaining right side acts as the jump button.
    this.pressButton('jump', e.pointerId);
  }

  private pressButton(id: TouchButton['id'], pointer: number) {
    this.buttonPointers.set(pointer, id);
    if (id === 'jump') this.latched.jump = true;
    if (id === 'dash') this.latched.dash = true;
    if (id === 'dive') this.latched.dive = true;
    if (id === 'pause') this.latched.pause = true;
  }

  private pointerMove(e: PointerEvent) {
    if (this.stick && e.pointerId === this.stick.pointer) {
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
      // Drag the stick origin along so direction changes stay responsive.
      const max = this.stickRadius();
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > max) {
        this.stick.ox = this.stick.x - (dx / d) * max;
        this.stick.oy = this.stick.y - (dy / d) * max;
      }
    }
  }

  private pointerUp(e: PointerEvent) {
    if (this.stick && e.pointerId === this.stick.pointer) this.stick = null;
    this.buttonPointers.delete(e.pointerId);
  }

  stickRadius() {
    return Math.min(window.innerWidth, window.innerHeight) * 0.11;
  }

  held(id: TouchButton['id']) {
    for (const b of this.buttonPointers.values()) if (b === id) return true;
    return false;
  }

  private stickDir() {
    if (!this.stick) return { x: 0, y: 0 };
    const dx = this.stick.x - this.stick.ox;
    const dy = this.stick.y - this.stick.oy;
    const d = Math.hypot(dx, dy);
    if (d < this.stickRadius() * 0.3) return { x: 0, y: 0 };
    return eightWay(dx, dy);
  }

  private pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) pad = p;
    if (!pad) {
      this.padAxes = { x: 0, y: 0 };
      this.padHeld = { jump: false, dash: false };
      return;
    }
    const b = pad.buttons.map((x) => x.pressed);
    const edge = (i: number) => !!b[i] && !this.prevPad[i];
    if (b.some((x, i) => x && !this.prevPad[i])) {
      this.device = 'gamepad';
      this.latched.any = true;
    }
    if (edge(0)) this.latched.jump = true;
    if (edge(1) || edge(2) || edge(7) || edge(5)) this.latched.dash = true;
    if (edge(3)) this.latched.dive = true;
    if (edge(9)) this.latched.pause = true;
    this.padHeld.jump = !!b[0];
    this.padHeld.dash = !!(b[1] || b[2] || b[7] || b[5]);
    let ax = pad.axes[0] ?? 0;
    let ay = pad.axes[1] ?? 0;
    if (b[14]) ax = -1;
    if (b[15]) ax = 1;
    if (b[12]) ay = -1;
    if (b[13]) ay = 1;
    if (Math.hypot(ax, ay) < 0.4) {
      ax = 0;
      ay = 0;
    } else {
      this.device = 'gamepad';
      const d = eightWay(ax, ay);
      ax = d.x;
      ay = d.y;
    }
    this.padAxes = { x: ax, y: ay };
    this.prevPad = b;
  }

  /** Read the frame's controls and clear the latched edges. */
  read(): Controls {
    this.pollPad();
    const has = (list: string[]) => list.some((k) => this.keys.has(k));
    let x = (has(KEY_RIGHT) ? 1 : 0) - (has(KEY_LEFT) ? 1 : 0);
    let y = (has(KEY_DOWN) ? 1 : 0) - (has(KEY_UP) ? 1 : 0);
    const sd = this.stickDir();
    if (sd.x || sd.y) ({ x, y } = sd);
    if (this.padAxes.x || this.padAxes.y) ({ x, y } = this.padAxes);

    const keyDown = has(KEY_DOWN);
    const stickDown = sd.y > 0 && sd.x === 0;
    const padDown = this.padAxes.y > 0 && this.padAxes.x === 0;
    const downEdge =
      this.latched.down ||
      (keyDown && !this.prevKeyDown) || (stickDown && !this.prevStickDown) || (padDown && !this.prevPadDown);
    this.prevKeyDown = keyDown;
    this.prevStickDown = stickDown;
    this.prevPadDown = padDown;

    const c: Controls = {
      x,
      y,
      jump: has(KEY_JUMP) || this.held('jump') || this.padHeld.jump,
      dash: has(KEY_DASH) || this.held('dash') || this.padHeld.dash,
      jumpPressed: this.latched.jump,
      dashPressed: this.latched.dash,
      divePressed: this.latched.dive,
      downPressed: downEdge,
      pausePressed: this.latched.pause,
      anyPressed: this.latched.any,
    };
    this.latched = { jump: false, dash: false, dive: false, down: false, pause: false, any: false };
    return c;
  }
}

/** Snap a direction to 8 ways, Celeste style. */
function eightWay(dx: number, dy: number) {
  const a = Math.atan2(dy, dx);
  const oct = Math.round(a / (Math.PI / 4));
  const ang = (oct * Math.PI) / 4;
  return { x: Math.round(Math.cos(ang)), y: Math.round(Math.sin(ang)) };
}
