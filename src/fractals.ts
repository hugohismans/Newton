import { Vec, v } from './math';

const SQRT3_6 = Math.sqrt(3) / 6;

/** One Koch refinement of an open polyline. sign=+1 puts bumps on the left of travel (screen space, y down). */
function refine(pts: Vec[], sign: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    out.push(a);
    out.push(v(a.x + dx / 3, a.y + dy / 3));
    out.push(v((a.x + b.x) / 2 + dy * SQRT3_6 * sign, (a.y + b.y) / 2 - dx * SQRT3_6 * sign));
    out.push(v(a.x + (2 * dx) / 3, a.y + (2 * dy) / 3));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Koch curve from a to b. sign=+1 bumps "up" when travelling left→right. */
export function kochCurve(a: Vec, b: Vec, iter: number, sign = 1): Vec[] {
  let pts = [a, b];
  for (let i = 0; i < iter; i++) pts = refine(pts, sign);
  return pts;
}

/**
 * Koch snowflake as a closed polygon (no repeated last point).
 * `size` is the side of the base triangle, centred on its centroid.
 * inward=true gives the "anti-snowflake".
 */
export function kochFlake(cx: number, cy: number, size: number, iter: number, rot = 0, inward = false): Vec[] {
  const h = (size * Math.sqrt(3)) / 2;
  const base = [v(0, (-2 * h) / 3), v(size / 2, h / 3), v(-size / 2, h / 3), v(0, (-2 * h) / 3)];
  let pts = base;
  for (let i = 0; i < iter; i++) pts = refine(pts, inward ? -1 : 1);
  pts.pop();
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return pts.map((p) => v(cx + p.x * c - p.y * s, cy + p.x * s + p.y * c));
}

export interface Square {
  x: number;
  y: number;
  s: number;
}

/** Holes of a Sierpinski carpet of side `size` at top-left (x,y), `iter` levels deep. */
export function carpetHoles(x: number, y: number, size: number, iter: number): Square[] {
  const out: Square[] = [];
  const rec = (x0: number, y0: number, s: number, n: number) => {
    if (n <= 0) return;
    const t = s / 3;
    out.push({ x: x0 + t, y: y0 + t, s: t });
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) rec(x0 + i * t, y0 + j * t, t, n - 1);
  };
  rec(x, y, size, iter);
  return out;
}

export const squarePoly = (q: Square): Vec[] => [
  v(q.x, q.y),
  v(q.x + q.s, q.y),
  v(q.x + q.s, q.y + q.s),
  v(q.x, q.y + q.s),
];
