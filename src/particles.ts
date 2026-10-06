export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav: number;
  drag: number;
}

export class Particles {
  list: Particle[] = [];

  emit(x: number, y: number, n: number, o: Partial<Particle> & { speed?: number; angle?: number; spread?: number } = {}) {
    for (let i = 0; i < n; i++) {
      const a = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const sp = (o.speed ?? 40) * (0.4 + Math.random() * 0.8);
      const max = (o.max ?? 0.6) * (0.6 + Math.random() * 0.6);
      this.list.push({
        x: x + (Math.random() - 0.5) * 2,
        y: y + (Math.random() - 0.5) * 2,
        vx: Math.cos(a) * sp + (o.vx ?? 0),
        vy: Math.sin(a) * sp + (o.vy ?? 0),
        life: max,
        max,
        size: (o.size ?? 1.5) * (0.6 + Math.random() * 0.8),
        color: o.color ?? '#ffffff',
        grav: o.grav ?? 0,
        drag: o.drag ?? 2,
      });
    }
    if (this.list.length > 600) this.list.splice(0, this.list.length - 600);
  }

  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt;
      p.vy += p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const f = p.life / p.max;
      ctx.globalAlpha = Math.min(1, f * 1.5);
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + 0.6 * f);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  clear() {
    this.list = [];
  }
}
