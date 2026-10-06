import { Vec } from './math';
import { ItemDef, RoomDef } from './room';

export interface Cam {
  x: number; // centre, room units
  y: number;
  s: number; // CSS px per room unit
}

export interface Theme {
  line: string;
  glow: string;
  fill: string;
  detail: string;
  portal: string;
  outside: string;
}

export const THEMES: Record<1 | 2, Theme> = {
  1: {
    line: '#a8f4ff',
    glow: 'rgba(110, 220, 255, 0.28)',
    fill: 'rgba(4, 9, 22, 0.88)',
    detail: 'rgba(160, 240, 255, 0.22)',
    portal: '#7dfcff',
    outside: 'rgba(3, 5, 14, 0.94)',
  },
  2: {
    line: '#ffd690',
    glow: 'rgba(255, 180, 80, 0.26)',
    fill: 'rgba(16, 9, 5, 0.88)',
    detail: 'rgba(255, 210, 140, 0.22)',
    portal: '#ffb347',
    outside: 'rgba(12, 6, 3, 0.94)',
  },
};

const polyPath = (p: Path2D, pts: Vec[]) => {
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  p.closePath();
};

/** Pre-built Path2D objects for a room (static geometry). */
export class RoomView {
  solids: Path2D;
  holes: Path2D;
  details: Path2D;
  spikes: Path2D;
  portals: { path: Path2D; c: Vec; r: number; idx: number }[] = [];
  outside: Path2D;
  edge: Path2D;
  theme: Theme;

  constructor(public def: RoomDef) {
    this.theme = THEMES[def.chapter];
    this.solids = new Path2D();
    this.holes = new Path2D();
    this.details = new Path2D();
    this.spikes = new Path2D();
    def.solids.forEach((s, idx) => {
      polyPath(this.solids, s.poly);
      if (s.detail) polyPath(this.details, s.detail);
      if (s.holes) for (const q of s.holes) this.holes.rect(q.x, q.y, q.s, q.s);
      if (s.portal && s.frame) {
        const p = new Path2D();
        polyPath(p, s.poly);
        this.portals.push({ path: p, c: { x: s.frame.cx, y: s.frame.cy }, r: s.frame.size * 0.35, idx });
      }
    });
    for (const t of def.spikes) polyPath(this.spikes, t);

    // Everything outside the walkable area.
    const BIG = 4000;
    this.outside = new Path2D();
    this.edge = new Path2D();
    if (def.shape) {
      this.outside.rect(-BIG, -BIG, def.w + 2 * BIG, def.h + 2 * BIG);
      polyPath(this.outside, def.shape);
      polyPath(this.edge, def.shape);
      if (def.shapeDetail) polyPath(this.details, def.shapeDetail);
    } else {
      const { w, h, walls } = def;
      if (walls.left) this.outside.rect(-BIG, -BIG, BIG, h + 2 * BIG);
      if (walls.right) this.outside.rect(w, -BIG, BIG, h + 2 * BIG);
      if (walls.top) this.outside.rect(walls.left ? 0 : -BIG, -BIG, w + (walls.left ? 0 : BIG) + (walls.right ? 0 : BIG), BIG);
      if (walls.bottom) this.outside.rect(walls.left ? 0 : -BIG, h, w + (walls.left ? 0 : BIG) + (walls.right ? 0 : BIG), BIG);
      if (walls.left) (this.edge.moveTo(0, -BIG), this.edge.lineTo(0, h + (walls.bottom ? 0 : BIG)));
      if (walls.right) (this.edge.moveTo(w, -BIG), this.edge.lineTo(w, h + (walls.bottom ? 0 : BIG)));
      if (walls.top) (this.edge.moveTo(0, 0), this.edge.lineTo(w, 0));
      if (walls.bottom) (this.edge.moveTo(0, h), this.edge.lineTo(w, h));
    }
  }
}

export interface RoomState {
  collected: Set<string>;
  refillTimers: Map<string, number>;
  exitOpen: boolean;
  activePortal: number; // index into def.solids of the portal under the player, or -1
}

export function setCam(ctx: CanvasRenderingContext2D, cam: Cam, vw: number, vh: number, dpr: number) {
  const k = cam.s * dpr;
  ctx.setTransform(k, 0, 0, k, dpr * (vw / 2 - cam.x * cam.s), dpr * (vh / 2 - cam.y * cam.s));
}

function glowStroke(ctx: CanvasRenderingContext2D, path: Path2D, color: string, glow: string, px: number, s: number) {
  ctx.strokeStyle = glow;
  ctx.lineWidth = (px * 3.5) / s;
  ctx.stroke(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = px / s;
  ctx.stroke(path);
}

export function drawRoom(ctx: CanvasRenderingContext2D, rv: RoomView, st: RoomState, cam: Cam, t: number) {
  const th = rv.theme;
  const s = cam.s;
  const def = rv.def;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Outside walls.
  ctx.fillStyle = th.outside;
  ctx.fill(rv.outside, 'evenodd');
  glowStroke(ctx, rv.edge, th.line, th.glow, 1.6, s);

  // Solids.
  ctx.fillStyle = th.fill;
  ctx.fill(rv.solids);
  ctx.strokeStyle = th.detail;
  ctx.lineWidth = 0.8 / s;
  ctx.stroke(rv.details);

  // Carpet windows show the fractal behind.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fill(rv.holes);
  ctx.restore();
  ctx.strokeStyle = th.detail;
  ctx.lineWidth = 1 / s;
  ctx.stroke(rv.holes);
  glowStroke(ctx, rv.solids, th.line, th.glow, 1.4, s);

  // Portals: a pulsing core inside the shape.
  rv.portals.forEach((p, i) => {
    const active = st.activePortal === p.idx;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3 + i);
    ctx.save();
    ctx.clip(p.path);
    const g = ctx.createRadialGradient(p.c.x, p.c.y, 0, p.c.x, p.c.y, p.r * (1.1 + 0.15 * pulse));
    g.addColorStop(0, hexA(th.portal, active ? 0.75 : 0.45));
    g.addColorStop(0.45, hexA(th.portal, active ? 0.25 : 0.12));
    g.addColorStop(1, hexA(th.portal, 0));
    ctx.fillStyle = g;
    ctx.fillRect(p.c.x - p.r * 2, p.c.y - p.r * 2, p.r * 4, p.r * 4);
    // Concentric ripples drifting inward: "there is more inside".
    ctx.strokeStyle = hexA(th.portal, 0.35);
    ctx.lineWidth = 1 / s;
    for (let k = 0; k < 3; k++) {
      const f = 1 - ((t * 0.35 + k / 3) % 1);
      ctx.globalAlpha = f;
      ctx.beginPath();
      ctx.arc(p.c.x, p.c.y, p.r * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    glowStroke(ctx, p.path, th.portal, hexA(th.portal, active ? 0.5 : 0.3), active ? 2 : 1.6, s);
  });

  // Spikes.
  ctx.fillStyle = 'rgba(60, 4, 20, 0.9)';
  ctx.fill(rv.spikes);
  glowStroke(ctx, rv.spikes, '#ff5c8a', 'rgba(255, 60, 120, 0.3)', 1.1, s);

  // Exit.
  drawExit(ctx, def.exit, st.exitOpen, t, s, th);

  // Items.
  for (const it of def.items) {
    if (st.collected.has(it.id)) continue;
    const rt = st.refillTimers.get(it.id) ?? 0;
    drawItem(ctx, it, t, s, rt > 0);
  }
}

function drawExit(ctx: CanvasRenderingContext2D, p: Vec, open: boolean, t: number, s: number, th: Theme) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const R = 11;
  if (open) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.8);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.4, hexA(th.portal, 0.25));
    g.addColorStop(1, hexA(th.portal, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);
  }
  for (let k = 0; k < 3; k++) {
    ctx.rotate(open ? t * (0.8 + k * 0.5) * (k % 2 ? -1 : 1) : 0);
    ctx.strokeStyle = open ? (k === 0 ? '#ffffff' : th.portal) : 'rgba(150,160,190,0.45)';
    ctx.lineWidth = (k === 0 ? 1.6 : 1) / s;
    ctx.setLineDash(open ? [R * 0.6, R * 0.25] : [2, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, R - k * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (!open) {
    // A small lock: a hollow fragment shape.
    ctx.strokeStyle = 'rgba(255, 220, 120, 0.7)';
    ctx.lineWidth = 1 / s;
    star(ctx, 0, 0, 3.2, t * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** Koch-ish star (hexagram) path. */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = rot + (i * Math.PI) / 6;
    const rr = i % 2 === 0 ? r : r * 0.58;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function drawItem(ctx: CanvasRenderingContext2D, it: ItemDef, t: number, s: number, spent: boolean) {
  const bob = Math.sin(t * 2.5 + it.x * 0.1) * 1.5;
  const x = it.x;
  const y = it.y + bob;
  ctx.save();
  if (it.kind === 'refill') {
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 2) * 0.15);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
    g.addColorStop(0, spent ? 'rgba(80,255,160,0)' : 'rgba(80,255,160,0.45)');
    g.addColorStop(1, 'rgba(80,255,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-10, -10, 20, 20);
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(3.5, 0);
    ctx.lineTo(0, 5.5);
    ctx.lineTo(-3.5, 0);
    ctx.closePath();
    ctx.fillStyle = spent ? 'rgba(80,255,160,0.05)' : 'rgba(80,255,160,0.35)';
    ctx.fill();
    ctx.strokeStyle = spent ? 'rgba(80,255,160,0.3)' : '#7dffb8';
    ctx.lineWidth = 1.2 / s;
    if (spent) ctx.setLineDash([1.5, 1.5]);
    ctx.stroke();
  } else if (it.kind === 'fragment') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
    g.addColorStop(0, 'rgba(255,215,110,0.6)');
    g.addColorStop(1, 'rgba(255,215,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 14, y - 14, 28, 28);
    star(ctx, x, y, 5.5, t * 0.8);
    ctx.fillStyle = 'rgba(255, 220, 120, 0.35)';
    ctx.fill();
    ctx.strokeStyle = '#ffe39a';
    ctx.lineWidth = 1.3 / s;
    ctx.stroke();
    star(ctx, x, y, 2.6, -t * 1.3);
    ctx.stroke();
  } else {
    // Ability orb.
    const col = it.kind === 'dash' ? '255, 110, 200' : '130, 200, 255';
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 22 + pulse * 4);
    g.addColorStop(0, `rgba(${col},0.7)`);
    g.addColorStop(0.35, `rgba(${col},0.25)`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - 30, y - 30, 60, 60);
    ctx.strokeStyle = `rgb(${col})`;
    ctx.lineWidth = 1.4 / s;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(x, y, 7, 2.8, t * 1.5 + (k * Math.PI) / 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
