import { Vec, closestOnSegment } from './math';

export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  owner: number;
}

export interface Contact {
  nx: number;
  ny: number;
  depth: number;
  owner: number;
}

/** Normals with ny below this point "up" enough to stand on (y grows downward). */
export const GROUND_NY = -0.64;

/** Static segment soup with a uniform-grid broadphase, queried with circles. */
export class Collider {
  segs: Seg[] = [];
  private grid = new Map<number, number[]>();
  private readonly cell = 24;
  private stamp: Uint32Array = new Uint32Array(0);
  private stampId = 1;

  addPolyline(pts: Vec[], closed: boolean, owner: number) {
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      this.addSeg({ ax: a.x, ay: a.y, bx: b.x, by: b.y, owner });
    }
  }

  private key(cx: number, cy: number) {
    return (cx + 4096) * 8192 + (cy + 4096);
  }

  private addSeg(s: Seg) {
    const idx = this.segs.length;
    this.segs.push(s);
    const c = this.cell;
    const x0 = Math.floor(Math.min(s.ax, s.bx) / c);
    const x1 = Math.floor(Math.max(s.ax, s.bx) / c);
    const y0 = Math.floor(Math.min(s.ay, s.by) / c);
    const y1 = Math.floor(Math.max(s.ay, s.by) / c);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(idx);
      }
  }

  /** Visit each segment near the circle once. */
  private each(x: number, y: number, r: number, fn: (s: Seg) => void) {
    if (this.stamp.length < this.segs.length) this.stamp = new Uint32Array(this.segs.length * 2);
    const id = ++this.stampId;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const list = this.grid.get(this.key(gx, gy));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          fn(this.segs[i]);
        }
      }
  }

  /** All contacts of a circle at (x,y), without moving it. */
  contacts(x: number, y: number, r: number): Contact[] {
    const out: Contact[] = [];
    this.each(x, y, r, (s) => {
      const p = closestOnSegment(x, y, s.ax, s.ay, s.bx, s.by);
      const dx = x - p.x;
      const dy = y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) return;
      const d = Math.sqrt(d2);
      if (d < 1e-6) return;
      out.push({ nx: dx / d, ny: dy / d, depth: r - d, owner: s.owner });
    });
    return out;
  }

  /**
   * Push a circle out of the geometry. Ground contacts are resolved straight
   * up so the player never slides down slopes or rolls off ledge corners.
   */
  resolve(pos: Vec, r: number, out: Contact[]) {
    for (let iter = 0; iter < 4; iter++) {
      const cs = this.contacts(pos.x, pos.y, r);
      if (cs.length === 0) return;
      cs.sort((a, b) => b.depth - a.depth);
      const c = cs[0];
      if (c.ny < GROUND_NY) {
        pos.y -= c.depth / -c.ny + 0.001;
      } else {
        pos.x += c.nx * (c.depth + 0.001);
        pos.y += c.ny * (c.depth + 0.001);
      }
      out.push(c);
    }
  }
}
