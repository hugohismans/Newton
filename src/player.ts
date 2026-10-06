import { Collider, Contact, GROUND_NY } from './collide';
import { Controls } from './input';
import { Vec, approach, clamp, lerp, sign, v } from './math';

/** Movement constants, taken from Celeste (pixels and seconds). */
export const P = {
  r: 4,
  maxRun: 90,
  runAccel: 1000,
  runReduce: 400,
  airMult: 0.65,
  gravity: 900,
  maxFall: 160,
  fastMaxFall: 240,
  fastFallAccel: 300,
  halfGravThreshold: 40,
  jumpSpeed: -105,
  jumpHBoost: 40,
  varJumpTime: 0.2,
  coyote: 0.1,
  jumpBuffer: 0.1,
  wallJumpH: 130,
  wallJumpForce: 0.16,
  wallSlideStart: 20,
  wallSlideTime: 1.2,
  wallCheck: 3,
  dashSpeed: 240,
  endDashSpeed: 160,
  endDashUpMult: 0.75,
  dashTime: 0.15,
  dashCooldown: 0.2,
  dashRefillCooldown: 0.1,
  dashBuffer: 0.08,
  superH: 260,
  freeze: 0.05,
};

export interface Abilities {
  wallJump: boolean;
  dash: boolean;
}

export type PlayerEvent = 'jump' | 'walljump' | 'land' | 'dash' | 'super' | 'refill';

export class Player {
  pos: Vec;
  prev: Vec;
  vel = v(0, 0);
  facing = 1;
  grounded = false;
  groundOwner = -1;
  wallDir = 0;
  dashes = 1;
  maxDashes = 1;
  dashing = 0;
  dashDir = v(1, 0);
  freeze = 0;
  private coyote = 0;
  private jumpBuf = 0;
  private dashBuf = 0;
  private varJump = 0;
  private varJumpSpeed = 0;
  private wallForce = 0;
  private wallForceDir = 0;
  private wallSlideTimer = P.wallSlideTime;
  private dashCd = 0;
  private dashRefillCd = 0;
  /** Visual state. */
  scale = v(1, 1);
  hair: Vec[] = [];
  trail: { x: number; y: number; life: number }[] = [];
  flash = 0;
  events: PlayerEvent[] = [];

  constructor(x: number, y: number) {
    this.pos = v(x, y);
    this.prev = v(x, y);
    for (let i = 0; i < 6; i++) this.hair.push(v(x, y));
  }

  update(dt: number, c: Controls, world: Collider, ab: Abilities) {
    this.events.length = 0;
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    if (c.jumpPressed) this.jumpBuf = P.jumpBuffer;
    if (c.dashPressed) this.dashBuf = P.dashBuffer;

    if (this.freeze > 0) {
      this.freeze -= dt;
      this.updateVisuals(dt);
      return;
    }

    this.jumpBuf -= dt;
    this.dashBuf -= dt;
    this.coyote -= dt;
    this.dashCd -= dt;
    this.dashRefillCd -= dt;
    this.wallForce -= dt;
    this.varJump -= dt;

    if (c.x !== 0) this.facing = c.x;
    this.wallDir = this.checkWall(world);

    if (this.grounded) {
      this.coyote = P.coyote;
      this.wallSlideTimer = P.wallSlideTime;
      if (this.dashRefillCd <= 0 && this.dashing <= 0 && this.dashes < this.maxDashes) {
        this.dashes = this.maxDashes;
        this.events.push('refill');
      }
    }

    // Dash start.
    if (ab.dash && this.dashBuf > 0 && this.dashes > 0 && this.dashCd <= 0) {
      this.dashBuf = 0;
      this.dashes--;
      this.dashCd = P.dashCooldown;
      this.dashRefillCd = P.dashRefillCooldown;
      let dx = c.x;
      let dy = c.y;
      if (dx === 0 && dy === 0) dx = this.facing;
      const len = Math.hypot(dx, dy);
      this.dashDir = v(dx / len, dy / len);
      this.vel.x = this.dashDir.x * P.dashSpeed;
      this.vel.y = this.dashDir.y * P.dashSpeed;
      this.dashing = P.dashTime;
      this.varJump = 0;
      this.freeze = P.freeze;
      this.flash = 1;
      this.scale = this.dashDir.y !== 0 && this.dashDir.x === 0 ? v(0.65, 1.4) : v(1.4, 0.7);
      this.events.push('dash');
      this.updateVisuals(dt);
      return;
    }

    if (this.dashing > 0) {
      this.dashing -= dt;
      // Super / hyper: jump out of a grounded dash.
      if (this.jumpBuf > 0 && this.grounded && this.dashDir.y >= 0 && this.dashDir.x !== 0) {
        this.dashing = 0;
        this.jumpBuf = 0;
        const hyper = this.dashDir.y > 0;
        this.vel.x = sign(this.dashDir.x) * P.superH * (hyper ? 1.25 : 1);
        this.vel.y = P.jumpSpeed * (hyper ? 0.5 : 1);
        this.varJump = P.varJumpTime;
        this.varJumpSpeed = this.vel.y;
        this.dashes = this.maxDashes;
        this.scale = v(0.7, 1.35);
        this.events.push('super');
      } else if (this.dashing <= 0) {
        if (this.dashDir.y <= 0) {
          this.vel.x = this.dashDir.x * P.endDashSpeed;
          this.vel.y = this.dashDir.y * P.endDashSpeed;
        }
        if (this.vel.y < 0) this.vel.y *= P.endDashUpMult;
      } else {
        this.trail.push({ x: this.pos.x, y: this.pos.y, life: 1 });
      }
    }

    if (this.dashing <= 0) {
      // Horizontal.
      if (this.wallForce > 0) {
        this.vel.x = approach(this.vel.x, this.wallForceDir * P.maxRun, P.runAccel * dt);
      } else {
        const mult = this.grounded ? 1 : P.airMult;
        if (Math.abs(this.vel.x) > P.maxRun && sign(this.vel.x) === c.x) {
          this.vel.x = approach(this.vel.x, P.maxRun * c.x, P.runReduce * mult * dt);
        } else {
          this.vel.x = approach(this.vel.x, P.maxRun * c.x, P.runAccel * mult * dt);
        }
      }

      // Vertical.
      if (!this.grounded) {
        let maxFall = P.maxFall;
        if (c.y > 0 && c.x === 0) maxFall = P.fastMaxFall;
        if (ab.wallJump && this.wallDir !== 0 && c.x === this.wallDir && this.vel.y >= 0) {
          this.wallSlideTimer = Math.max(0, this.wallSlideTimer - dt);
          maxFall = lerp(P.maxFall, P.wallSlideStart, this.wallSlideTimer / P.wallSlideTime);
        }
        const half = Math.abs(this.vel.y) < P.halfGravThreshold && c.jump ? 0.5 : 1;
        this.vel.y = approach(this.vel.y, maxFall, P.gravity * half * dt);
        if (this.vel.y > maxFall) this.vel.y = approach(this.vel.y, maxFall, P.fastFallAccel * dt);
      }

      // Variable jump height.
      if (this.varJump > 0) {
        if (c.jump) this.vel.y = Math.min(this.vel.y, this.varJumpSpeed);
        else this.varJump = 0;
      }

      // Jumps.
      if (this.jumpBuf > 0) {
        if (this.coyote > 0) {
          this.jumpBuf = 0;
          this.coyote = 0;
          this.vel.y = P.jumpSpeed;
          this.vel.x += c.x * P.jumpHBoost;
          this.varJump = P.varJumpTime;
          this.varJumpSpeed = this.vel.y;
          this.grounded = false;
          this.scale = v(0.7, 1.35);
          this.events.push('jump');
        } else if (ab.wallJump && this.wallDir !== 0) {
          this.jumpBuf = 0;
          const away = -this.wallDir;
          this.vel.x = away * P.wallJumpH;
          this.vel.y = P.jumpSpeed;
          this.varJump = P.varJumpTime;
          this.varJumpSpeed = this.vel.y;
          if (c.x !== this.wallDir) {
            this.wallForce = P.wallJumpForce;
            this.wallForceDir = away;
          }
          this.facing = away;
          this.scale = v(0.7, 1.35);
          this.events.push('walljump');
        }
      }
    }

    this.move(dt, world);
    this.updateVisuals(dt);
  }

  private move(dt: number, world: Collider) {
    const wasGrounded = this.grounded;
    const dist = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y)) * dt;
    const steps = Math.max(1, Math.ceil(dist / (P.r * 0.45)));
    const contacts: Contact[] = [];
    for (let i = 0; i < steps; i++) {
      this.pos.x += (this.vel.x * dt) / steps;
      this.pos.y += (this.vel.y * dt) / steps;
      contacts.length = 0;
      world.resolve(this.pos, P.r, contacts);
      for (const ct of contacts) {
        const vn = this.vel.x * ct.nx + this.vel.y * ct.ny;
        if (ct.ny < GROUND_NY) {
          if (this.vel.y > 0) this.vel.y = 0;
        } else if (vn < 0) {
          this.vel.x -= ct.nx * vn;
          this.vel.y -= ct.ny * vn;
          // Bonk: kill variable jump on ceilings.
          if (ct.ny > 0.6) this.varJump = 0;
        }
      }
    }

    let g = this.probeGround(world, 1.5);
    // Snap down small steps and slopes so walking stays glued to the ground.
    if (!g.hit && wasGrounded && this.vel.y >= 0 && this.dashing <= 0) {
      for (let d = 1; d <= 5; d++) {
        const p = this.probeGround(world, d + 1.5);
        if (p.hit) {
          this.pos.y += d;
          world.resolve(this.pos, P.r, contacts);
          g = this.probeGround(world, 1.5);
          break;
        }
      }
    }
    this.grounded = g.hit && this.vel.y >= 0;
    this.groundOwner = this.grounded ? g.owner : -1;
    if (this.grounded && !wasGrounded) {
      const impact = clamp(this.lastFall / P.fastMaxFall, 0.2, 1);
      this.scale = v(1 + 0.45 * impact, 1 - 0.4 * impact);
      if (this.lastFall > 40) this.events.push('land');
    }
    this.lastFall = this.vel.y > 0 ? this.vel.y : this.grounded ? 0 : this.lastFall;
  }
  private lastFall = 0;

  private probeGround(world: Collider, d: number) {
    const cs = world.contacts(this.pos.x, this.pos.y + d, P.r);
    let best: Contact | null = null;
    for (const c of cs) if (c.ny < GROUND_NY && (!best || c.ny < best.ny)) best = c;
    return { hit: !!best, owner: best ? best.owner : -1 };
  }

  private checkWall(world: Collider) {
    const test = (dir: number) =>
      world
        .contacts(this.pos.x + dir * P.wallCheck, this.pos.y, P.r)
        .some((c) => c.nx * -dir > 0.5 && c.ny >= GROUND_NY && c.ny < 0.75);
    if (test(this.facing)) return this.facing;
    if (test(-this.facing)) return -this.facing;
    return 0;
  }

  private updateVisuals(dt: number) {
    this.scale.x = approach(this.scale.x, 1, 3.2 * dt);
    this.scale.y = approach(this.scale.y, 1, 3.2 * dt);
    this.flash = Math.max(0, this.flash - dt * 6);
    for (const t of this.trail) t.life -= dt * 4;
    this.trail = this.trail.filter((t) => t.life > 0);
    // Hair: a short chain trailing behind, pulled by gravity.
    let anchor = v(this.pos.x - this.facing * 1.5, this.pos.y - 2);
    for (let i = 0; i < this.hair.length; i++) {
      const h = this.hair[i];
      h.x += -this.facing * 0.6 * dt * 60 * 0.3;
      h.y += 0.35 * dt * 60 * 0.3;
      const dx = h.x - anchor.x;
      const dy = h.y - anchor.y;
      const d = Math.hypot(dx, dy);
      const seg = i === 0 ? 1.2 : 1.6;
      if (d > seg) {
        h.x = anchor.x + (dx / d) * seg;
        h.y = anchor.y + (dy / d) * seg;
      }
      anchor = h;
    }
  }

  teleport(x: number, y: number) {
    this.pos = v(x, y);
    this.prev = v(x, y);
    this.vel = v(0, 0);
    this.dashing = 0;
    this.dashes = this.maxDashes;
    this.trail = [];
    for (const h of this.hair) {
      h.x = x;
      h.y = y;
    }
  }
}
