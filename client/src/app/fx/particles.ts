import { FxStage, clamp, pick, reduced, rnd } from './fx-stage';

type ParticleKind = 'dot' | 'spark' | 'star' | 'shell' | 'conf' | 'dust';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravity, px/s^2. */
  g: number;
  drag: number;
  age: number;
  life: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  kind: ParticleKind;
  /** Flutter / twinkle speed and phase. */
  flut: number;
  fph: number;
  sway: number;
  grow: number;
  /** Starting opacity. */
  a0: number;
  /** Firework shells burst when they reach `ty` (or stall). */
  shell?: { ty: number; colors: string[]; n: number };
}

type ParticleInit = Partial<Omit<Particle, 'age'>> & {
  /** Priority particles may evict others when the cap is reached. */
  pri?: boolean;
};

export interface BurstOptions {
  speed?: [number, number];
  angle?: [number, number];
  kind?: ParticleKind;
  colors?: string[];
  g?: number;
  drag?: number;
  life?: [number, number];
  size?: [number, number];
  pri?: boolean;
}

type BodyState = 'wait' | 'fly' | 'slide' | 'rest' | 'absorb';

interface BodyGroup {
  total: number;
  rested: number;
  absorbAt: number;
  dst: { x: number; y: number };
}

/** A face-down card flying across the table with simple physics. */
interface Body {
  el: HTMLElement;
  shadow: HTMLElement;
  group: BodyGroup;
  cw: number;
  ch: number;
  state: BodyState;
  start: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  vr: number;
  /** Tumble angle (flips the card as it flies). */
  tum: number;
  vt: number;
  tx: number;
  ty: number;
  ax: number;
  ay: number;
  t: number;
  born: number;
}

const MAX_PARTS = 600;
const MAX_BODIES = 30;
const GRAV = 2400;
const TAU = 6.283;

/** Canvas particles plus the flying-card bodies, stepped by one requestAnimationFrame loop that stops when nothing is alive. */
export class ParticleSystem {
  private readonly parts: Particle[] = [];
  private readonly bodies: Body[] = [];
  private raf = 0;
  private lastTs = 0;
  private clock = 0;

  constructor(private readonly stage: FxStage) {}

  get alive(): { parts: number; bodies: number } {
    return { parts: this.parts.length, bodies: this.bodies.length };
  }

  spawn(o: ParticleInit): void {
    const { pri, ...init } = o;
    if (this.parts.length >= MAX_PARTS) {
      if (!pri) return;
      this.parts[(Math.random() * this.parts.length) | 0] = this.parts[this.parts.length - 1];
      this.parts.pop();
    }
    this.parts.push({
      x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 1, size: 3, color: '#fff', rot: 0, vr: 0, kind: 'dot',
      flut: 0, fph: rnd(0, 6.28), sway: 0, grow: 0, a0: 1, ...init, age: 0,
    });
    this.ensure();
  }

  burst(x: number, y: number, n: number, o: BurstOptions = {}): void {
    const { speed = [100, 400], angle = [0, Math.PI * 2], kind = 'spark', colors = ['#fff'], g = 500, drag = 1.4, life = [0.5, 1], size = [2, 4], pri = false } = o;
    for (let i = 0; i < n; i++) {
      const a = rnd(angle[0], angle[1]);
      const s = rnd(speed[0], speed[1]);
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g, drag, life: rnd(life[0], life[1]), size: rnd(size[0], size[1]), color: pick(colors), kind, pri });
    }
  }

  dust(x: number, y: number, n: number, spread: number, k: number): void {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU);
      this.spawn({ x: x + Math.cos(a) * spread, y: y + Math.sin(a) * spread * 0.7, vx: Math.cos(a) * rnd(40, 130) * k, vy: Math.sin(a) * rnd(20, 80) * k, drag: 3, life: rnd(0.5, 0.9), size: rnd(5, 11) * k, color: '#d8d2ff', kind: 'dust', a0: 0.3, grow: 1.6 });
    }
  }

  private explode(x: number, y: number, colors: string[], n: number): void {
    const k = this.stage.scale;
    this.burst(x, y, n, { speed: [90 * k, 380 * k], colors, g: 240, drag: 1.7, life: [0.9, 1.6], size: [1.8, 3.2], kind: 'spark', pri: true });
    this.burst(x, y, Math.round(n / 4), { speed: [30 * k, 200 * k], colors: ['#fff', ...colors], g: 120, drag: 1.2, life: [1, 1.8], size: [1.5, 2.5], kind: 'dot', pri: true });
    this.spawn({ x, y, kind: 'dot', size: 46 * k, life: 0.28, color: '#fff', a0: 0.6, pri: true });
  }

  /** A firework shell: rises with a trail, then explodes. */
  shell(x: number, ty: number, colors: string[], n: number): void {
    const { H } = this.stage;
    const d = Math.max(60, H - ty);
    const g = 450;
    this.spawn({ x, y: H + 8, vx: rnd(-25, 25), vy: -Math.sqrt(2 * g * d), g, drag: 0, life: 4, size: 3, color: '#ffe9b0', kind: 'shell', shell: { ty, colors, n }, pri: true });
  }

  /** Confetti cannon in a bottom corner (side -1 = left, 1 = right). */
  cannon(side: -1 | 1, n: number, colors: string[]): void {
    const { W, H } = this.stage;
    const x = side < 0 ? -6 : W + 6;
    const y = H + 6;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + side * -rnd(0.12, 0.85);
      const s = H * rnd(1.0, 2.05);
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 700, drag: 2.2, life: rnd(3.4, 5), size: rnd(7, 12) * Math.max(0.75, this.stage.scale), color: pick(colors), kind: 'conf', rot: rnd(0, 6.28), vr: rnd(-12, 12), flut: rnd(6, 14), sway: rnd(15, 55) });
    }
    this.burst(x, y, 12, { speed: [200, 700], angle: side < 0 ? [-1.5, -0.2] : [-2.9, -1.6], colors: ['#fff', '#ffd23f'], g: 300, drag: 3, life: [0.2, 0.4], size: [2, 3.5], pri: true });
  }

  /** Face-down cards fly from `src` to a little heap beside `dst`, bounce, settle, then slide into the chip. */
  spray(src: { x: number; y: number }, dst: { x: number; y: number; w: number; h: number }, count: number): void {
    const n = Math.min(count, 12, MAX_BODIES - this.bodies.length);
    if (n <= 0 || reduced()) return;
    const { W, H } = this.stage;
    const k = this.stage.scale;
    const cw = Math.round(clamp(46 * k, 26, 58));
    const ch = Math.round(cw * 1.5);
    let dx = src.x - dst.x;
    let dy = src.y - dst.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const heap = {
      x: clamp(dst.x + dx * (dst.w / 2 + cw * 0.55), cw, W - cw),
      y: clamp(dst.y + dy * (dst.h / 2 + ch * 0.45), ch * 0.6, H - ch * 0.6),
    };
    const group: BodyGroup = { total: n, rested: 0, absorbAt: 0, dst };
    for (let i = 0; i < n; i++) {
      const el = this.stage.mk('fx-card', `width:${cw}px;height:${ch}px;--cw:${cw}px;display:none`);
      const shadow = this.stage.mk('fx-shadow', `width:${cw}px;height:${ch}px;display:none`);
      const tx = heap.x + rnd(-cw * 0.55, cw * 0.55);
      const ty = heap.y + rnd(-ch * 0.22, ch * 0.22);
      const x0 = src.x + rnd(-6, 6);
      const y0 = src.y + rnd(-6, 6);
      const vz = rnd(600, 860) * Math.max(0.7, k);
      const air = (2 * vz) / GRAV;
      this.bodies.push({
        el, shadow, group, cw, ch, state: 'wait', start: this.clock + i * 0.06,
        x: x0, y: y0, z: 0, vx: ((tx - x0) * 0.8) / air, vy: ((ty - y0) * 0.8) / air, vz,
        rot: rnd(0, 6.28), vr: rnd(-9, 9), tum: rnd(0, 3), vt: rnd(9, 17), tx, ty, ax: 0, ay: 0, t: 0, born: 0,
      });
    }
    this.ensure();
  }

  /** Removes every particle and body (their elements go with the overlay) and stops the loop. */
  clear(): void {
    this.parts.length = 0;
    this.bodies.length = 0;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.wipe();
  }

  private wipe(): void {
    const { ctx, canvas } = this.stage;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  private ensure(): void {
    if (this.raf) return;
    this.lastTs = 0;
    this.raf = requestAnimationFrame((ts) => this.tick(ts));
  }

  private tick(ts: number): void {
    this.raf = 0;
    try {
      const dt = this.lastTs ? clamp((ts - this.lastTs) / 1000, 0.001, 1 / 30) : 1 / 60;
      this.lastTs = ts;
      this.clock += dt;
      this.update(dt);
      this.draw();
    } catch {
      this.parts.length = 0;
    }
    if (this.parts.length || this.bodies.length) this.raf = requestAnimationFrame((t) => this.tick(t));
    else {
      this.lastTs = 0;
      this.wipe();
    }
  }

  private update(dt: number): void {
    const { W, H } = this.stage;
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life || p.y > H + 90 || p.x < -140 || p.x > W + 140) {
        parts[i] = parts[parts.length - 1];
        parts.pop();
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt + (p.sway ? Math.sin(p.fph) * p.sway * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.fph += p.flut * dt;
      if (p.kind === 'shell' && p.shell) {
        if (Math.random() < 0.9) this.spawn({ x: p.x, y: p.y, vx: rnd(-18, 18), vy: rnd(10, 50), g: 80, drag: 1, life: rnd(0.3, 0.6), size: 1.6, color: '#ffd9a0', kind: 'dot' });
        if (p.y <= p.shell.ty || p.vy > -40) {
          const at = parts.indexOf(p);
          if (at >= 0) {
            parts[at] = parts[parts.length - 1];
            parts.pop();
          }
          this.explode(p.x, p.y, p.shell.colors, p.shell.n);
        }
      }
    }
    for (let i = this.bodies.length - 1; i >= 0; i--) if (this.stepBody(this.bodies[i], dt)) this.bodies.splice(i, 1);
  }

  private draw(): void {
    const { ctx, W, H, dpr } = this.stage;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const additive of [false, true]) {
      ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      for (const p of this.parts) {
        const add = p.kind === 'spark' || p.kind === 'dot' || p.kind === 'star' || p.kind === 'shell';
        if (add !== additive) continue;
        const t = p.age / p.life;
        const a = p.a0 * (t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1);
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        drawParticle(ctx, p, a, t);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Advances one flying card; returns true when it is finished and removed. */
  private stepBody(b: Body, dt: number): boolean {
    const clock = this.clock;
    if (b.state === 'wait') {
      if (clock < b.start) return false;
      b.state = 'fly';
      b.born = clock;
      b.el.style.display = '';
      b.shadow.style.display = '';
    }
    if (b.state === 'fly') {
      b.vz -= GRAV * dt;
      b.z += b.vz * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      b.tum += b.vt * dt;
      if (b.z <= 0) {
        b.z = 0;
        if (Math.abs(b.vz) > 140) {
          b.vz = -b.vz * 0.45; // restitution
          b.vx *= 0.72;
          b.vy *= 0.72;
          b.vr *= 0.6;
          this.dust(b.x, b.y, 2, 4, 0.6);
        } else {
          b.vz = 0;
          b.state = 'slide';
        }
      }
    }
    if (b.state === 'slide') {
      // On the table: friction plus a gentle pull toward the heap, like it slid there.
      const f = Math.exp(-4.5 * dt);
      b.vx = (b.vx + (b.tx - b.x) * 22 * dt) * f;
      b.vy = (b.vy + (b.ty - b.y) * 22 * dt) * f;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vr *= Math.exp(-6 * dt);
      b.rot += b.vr * dt;
      b.tum += (Math.round(b.tum / Math.PI) * Math.PI - b.tum) * Math.min(1, 14 * dt);
      if (Math.hypot(b.vx, b.vy) < 12 && Math.hypot(b.tx - b.x, b.ty - b.y) < 8 && clock - b.born > 0.5) {
        b.state = 'rest';
        b.vx = b.vy = 0;
        b.group.rested++;
        if (b.group.rested >= b.group.total) b.group.absorbAt = clock + 0.4;
      }
    }
    if (clock - b.born > 3 && b.state !== 'absorb') {
      if (b.state !== 'rest') {
        b.state = 'rest';
        b.group.rested++;
      }
      if (!b.group.absorbAt) b.group.absorbAt = clock;
    }
    if (b.state === 'rest' && b.group.absorbAt && clock >= b.group.absorbAt) {
      b.state = 'absorb';
      b.t = 0;
      b.ax = b.x;
      b.ay = b.y;
    }
    let sc = 1;
    let op = 1;
    let x = b.x;
    let y = b.y;
    if (b.state === 'absorb') {
      b.t += dt / 0.3;
      const e = Math.min(1, b.t) ** 2;
      x = b.ax + (b.group.dst.x - b.ax) * e;
      y = b.ay + (b.group.dst.y - b.ay) * e;
      sc = 1 - 0.7 * e;
      op = 1 - e;
      if (b.t >= 1) {
        b.el.remove();
        b.shadow.remove();
        return true;
      }
    }
    const s = (1 + b.z / 520) * sc;
    const sh = sc * (1 - b.z / 900);
    b.el.style.opacity = String(op);
    b.el.style.transform = `translate3d(${x - b.cw / 2}px,${y - b.ch / 2 - b.z}px,0) rotate(${b.rot}rad) scale(${s},${s * Math.cos(b.tum)})`;
    b.shadow.style.opacity = String(0.5 * op * (1 - Math.min(0.85, b.z / 300)));
    b.shadow.style.transform = `translate3d(${x - b.cw / 2 + 3}px,${y - b.ch / 2 + 5}px,0) rotate(${b.rot}rad) scale(${sh},${sh * Math.max(0.35, Math.abs(Math.cos(b.tum)))})`;
    return false;
  }
}

function drawStar(c: CanvasRenderingContext2D, r: number): void {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.28 : r;
    const a = (Math.PI / 4) * i - Math.PI / 2;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, a: number, t: number): void {
  if (p.kind === 'conf') {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, Math.cos(p.fph));
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
    ctx.restore();
  } else if (p.kind === 'dust') {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 + p.grow * t), 0, TAU);
    ctx.fill();
  } else if (p.kind === 'spark') {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
    ctx.stroke();
  } else if (p.kind === 'star') {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    const tw = 0.6 + 0.4 * Math.sin(p.fph);
    ctx.globalAlpha = a * tw;
    ctx.fillStyle = p.color;
    drawStar(ctx, p.size * (0.7 + 0.5 * tw));
    ctx.restore();
  } else {
    // dot / shell: a soft glowing point
    ctx.fillStyle = p.color;
    ctx.globalAlpha = a * 0.3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 2.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, TAU);
    ctx.fill();
  }
}
