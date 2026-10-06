import { Square, carpetHoles, kochCurve, kochFlake, squarePoly } from './fractals';
import { Vec, polygonBounds, v } from './math';

/** Where a child room sits inside its portal: centre and characteristic size. */
export interface Frame {
  cx: number;
  cy: number;
  size: number;
}

export interface SolidDef {
  kind: 'flake' | 'carpet' | 'block' | 'ground';
  poly: Vec[];
  /** Finer fractal outline, drawn faintly: the detail you only reach by diving. */
  detail?: Vec[];
  holes?: Square[];
  portal?: string;
  frame?: Frame;
  /** Where the player reappears in this room when coming back up. */
  ret?: Vec;
}

export type ItemKind = 'wallJump' | 'dash' | 'fragment' | 'refill';
export interface ItemDef {
  kind: ItemKind;
  x: number;
  y: number;
  id: string;
}

export type HintKey = 'move' | 'jump' | 'hold' | 'walljump' | 'dash' | 'refill' | 'dive' | 'fragment' | 'super';
export interface HintDef {
  x: number;
  y: number;
  key: HintKey;
}

export interface RoomDef {
  id: string;
  name: string;
  chapter: 1 | 2;
  w: number;
  h: number;
  walls: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  /** Optional non-rectangular walkable area (everything outside is solid). */
  shape?: Vec[];
  shapeDetail?: Vec[];
  frame?: Frame;
  solids: SolidDef[];
  spikes: Vec[][];
  items: ItemDef[];
  hints: HintDef[];
  spawn: Vec;
  exit: Vec;
  requires?: string[];
  parent?: string;
}

// ---------- builders ----------

export function flake(cx: number, cy: number, size: number, iter: number, opts: { rot?: number; portal?: string } = {}): SolidDef {
  const rot = opts.rot ?? 0;
  const poly = kochFlake(cx, cy, size, iter, rot);
  const s: SolidDef = { kind: 'flake', poly, detail: kochFlake(cx, cy, size, iter + 1, rot) };
  if (opts.portal) {
    s.portal = opts.portal;
    s.frame = { cx, cy, size };
    const b = polygonBounds(poly);
    s.ret = v(cx, b.minY - 8);
  }
  return s;
}

/** A solid Sierpinski carpet slab: square collision, fractal windows drawn inside. */
export function carpet(x: number, y: number, size: number, iter: number, opts: { portal?: string } = {}): SolidDef {
  const s: SolidDef = {
    kind: 'carpet',
    poly: squarePoly({ x, y, s: size }),
    holes: carpetHoles(x, y, size, iter),
  };
  if (opts.portal) {
    s.portal = opts.portal;
    s.frame = { cx: x + size / 2, cy: y + size / 2, size };
    s.ret = v(x + size / 2, y - 6);
  }
  return s;
}

export function block(x: number, y: number, w: number, h: number): SolidDef {
  return { kind: 'block', poly: [v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h)] };
}

/**
 * The inverse carpet: the holes of a Sierpinski carpet become solid blocks,
 * the carpet itself becomes walkable space.
 */
export function carpetBlocks(x: number, y: number, size: number, iter: number, skip: (q: Square) => boolean = () => false) {
  return carpetHoles(x, y, size, iter)
    .filter((q) => !skip(q))
    .map((q) => ({ kind: 'block' as const, poly: squarePoly(q), holes: q.s > size / 4 ? carpetHoles(q.x, q.y, q.s, 1) : undefined }));
}

/** Koch-curve terrain from x0 to x1 at height y, closed down to `bottom`. */
export function kochGround(x0: number, x1: number, y: number, iter: number, bottom: number, up = true): SolidDef {
  const curve = kochCurve(v(x0, y), v(x1, y), iter, up ? 1 : -1);
  const fine = kochCurve(v(x0, y), v(x1, y), iter + 1, up ? 1 : -1);
  return {
    kind: 'ground',
    poly: [...curve, v(x1, bottom), v(x0, bottom)],
    detail: [...fine, v(x1, bottom), v(x0, bottom)],
  };
}

/** Row of crystal spikes pointing up (dir=-1) or down (dir=1), base on y. */
export function spikes(x0: number, x1: number, y: number, dir = -1, size = 6): Vec[][] {
  const out: Vec[][] = [];
  const n = Math.max(1, Math.round((x1 - x0) / size));
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w;
    out.push([v(a, y), v(a + w / 2, y + dir * size * 0.95), v(a + w, y)]);
  }
  return out;
}

/** Vertical spike column on x, pointing left (dir=-1) or right (dir=1). */
export function spikesV(x: number, y0: number, y1: number, dir = 1, size = 6): Vec[][] {
  const out: Vec[][] = [];
  const n = Math.max(1, Math.round((y1 - y0) / size));
  const h = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = y0 + i * h;
    out.push([v(x, a), v(x + dir * size * 0.95, a + h / 2), v(x, a + h)]);
  }
  return out;
}

export function room(d: Partial<RoomDef> & Pick<RoomDef, 'id' | 'name' | 'chapter' | 'w' | 'h' | 'spawn' | 'exit'>): RoomDef {
  return {
    walls: { left: true, right: true, top: true, bottom: false },
    solids: [],
    spikes: [],
    items: [],
    hints: [],
    ...d,
  };
}

/** A room whose walkable area is the inside of a Koch snowflake. */
export function flakeRoom(
  d: Omit<Partial<RoomDef>, 'shape'> & Pick<RoomDef, 'id' | 'name' | 'chapter' | 'spawn' | 'exit'>,
  size: number,
  iter: number,
): RoomDef {
  const shape = kochFlake(0, 0, size, iter);
  const b = polygonBounds(shape);
  // Shift so the room's bounding box starts at 0,0.
  const dx = -b.minX;
  const dy = -b.minY;
  const mv = (p: Vec) => v(p.x + dx, p.y + dy);
  return room({
    ...d,
    w: b.maxX - b.minX,
    h: b.maxY - b.minY,
    walls: { left: false, right: false, top: false, bottom: false },
    shape: shape.map(mv),
    shapeDetail: kochFlake(0, 0, size, iter + 1).map(mv),
    frame: { cx: dx, cy: dy, size },
  });
}

/** A square room whose frame matches a carpet portal. */
export function squareFrame(size: number): Frame {
  return { cx: size / 2, cy: size / 2, size };
}

/** Turn any square-ish solid into a portal to `child`. */
export function portalize<T extends SolidDef>(s: T, child: string): T {
  const b = polygonBounds(s.poly);
  s.portal = child;
  s.frame = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, size: b.maxX - b.minX };
  s.ret = v((b.minX + b.maxX) / 2, b.minY - 6);
  return s;
}
