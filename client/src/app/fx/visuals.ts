import { Moment } from '../core/models';
import { FxStage, Spot, clamp, reduced, rnd } from './fx-stage';
import { ParticleSystem } from './particles';

export type MomentOf<T extends Moment['type']> = Extract<Moment, { type: T }>;

/** What every effect gets to work with. */
export interface Fx {
  stage: FxStage;
  ps: ParticleSystem;
  /** Removes everything on screen (used by the win celebration's failsafe). */
  clearAll(): void;
}

export const COLORS: Partial<Record<string, string>> = { red: '#ff4d5e', yellow: '#ffd23f', green: '#34d399', blue: '#4f9bff' };
export const RAINBOW = ['#ff4d5e', '#ffd23f', '#34d399', '#4f9bff', '#c084fc', '#ff7ac8'];
export const GOLD = ['#ffd23f', '#ffe27a', '#ffb81c', '#fff3b0', '#ff9f1c'];
export const CONFETTI = ['#ff4d5e', '#ffd23f', '#34d399', '#4f9bff', '#ffffff', '#c084fc', '#ff7ac8'];

interface RingOptions {
  r0?: number;
  r1?: number;
  ms?: number;
  delay?: number;
  a?: number;
  inner?: number;
}

/** An expanding ring of light. */
export function ring(st: FxStage, x: number, y: number, color: string, o: RingOptions = {}): void {
  const { r0 = 20, r1 = 200, ms = 650, delay = 0, a = 0.85, inner = 74 } = o;
  const e = st.mk('fx-ring', `left:${x - 100}px;top:${y - 100}px;background:radial-gradient(circle closest-side,transparent ${inner}%,${color} ${inner + 16}%,transparent 100%)`);
  st.animate(e, [{ transform: `scale(${r0 / 100})`, opacity: a }, { opacity: a * 0.7, offset: 0.4 }, { transform: `scale(${r1 / 100})`, opacity: 0 }], { duration: ms, delay, easing: 'cubic-bezier(.15,.7,.3,1)' });
  st.expire(e, ms + delay + 80);
}

/** A soft glowing disc that fades in and out. */
export function disc(st: FxStage, x: number, y: number, r: number, color: string, ms: number, a = 0.7): void {
  const e = st.mk('fx-disc', `left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;--c:${color}`);
  st.animate(e, [{ opacity: 0 }, { opacity: a, offset: 0.25 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
  st.expire(e, ms + 80);
}

export function floatText(st: FxStage, text: string, x: number, y: number, color: string, size: number): void {
  const e = st.mk('fx-float', `left:${clamp(x, 30, st.W - 30)}px;top:${clamp(y, 30, st.H - 30)}px;--c:${color};--fs:${size}px`, text);
  st.animate(e, [
    { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 },
    { transform: 'translate(-50%,-60%) scale(1.45)', opacity: 1, offset: 0.14 },
    { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: 0.28 },
    { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: 0.55 },
    { transform: 'translate(-50%,-190%) scale(.95)', opacity: 0 },
  ], { duration: 1500, easing: 'ease-out' });
  st.expire(e, 1600);
}

/** Shakes the whole table. */
export function shake(st: FxStage, amp: number, ms: number, rotAmp = 0): void {
  const table = document.getElementById('stage');
  if (!table || reduced() || st.shaking) return;
  st.shaking = true;
  const n = 10;
  const kf: Keyframe[] = [{ translate: '0 0', rotate: '0deg' }];
  for (let i = 1; i <= n; i++) {
    const d = 1 - i / (n + 1);
    kf.push({ translate: `${rnd(-1, 1) * amp * d}px ${rnd(-1, 1) * amp * d}px`, rotate: `${rnd(-1, 1) * rotAmp * d}deg` });
  }
  kf.push({ translate: '0 0', rotate: '0deg' });
  const done = (): void => {
    st.shaking = false;
  };
  const a = st.animate(table, kf, { duration: ms, easing: 'linear', fill: 'none' });
  if (a) a.finished.then(done, done);
  else done();
  st.later(done, ms + 100);
}

export function flash(st: FxStage, ms = 380, a = 0.95): void {
  const e = st.mk('fx-flash');
  st.animate(e, [{ opacity: a }, { opacity: a * 0.85, offset: 0.2 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
  st.expire(e, ms + 60);
}

export function vignette(st: FxStage, ms = 750): void {
  const e = st.mk('fx-vignette');
  st.animate(e, [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 0 }], { duration: ms });
  st.expire(e, ms + 60);
}

/** Brief non-moving highlight over a chip (also used for reduced motion). */
export function chipFlash(st: FxStage, r: Spot, color: string): void {
  const e = st.mk('fx-chipglow', `left:${r.x - r.w / 2 - 4}px;top:${r.y - r.h / 2 - 4}px;width:${r.w + 8}px;height:${r.h + 8}px;--c:${color}`);
  st.animate(e, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: 800 });
  st.expire(e, 900);
}

/** A chip gets hit: it squashes sideways and wobbles back. */
export function jolt(st: FxStage, chip: HTMLElement | null, power = 1): void {
  if (!chip || reduced()) return;
  const a = 12 * power;
  st.animate(chip, [
    { translate: '0 0', scale: '1 1' },
    { translate: `${-a}px 0`, scale: '1.1 .88', offset: 0.14 },
    { translate: `${a * 0.8}px 0`, scale: '.95 1.06', offset: 0.38 },
    { translate: `${-a * 0.4}px 0`, scale: '1.03 .98', offset: 0.62 },
    { translate: `${a * 0.15}px 0`, scale: '1 1', offset: 0.82 },
    { translate: '0 0', scale: '1 1' },
  ], { duration: 560, easing: 'ease-out', fill: 'none' });
}

export function pulse(st: FxStage, chip: HTMLElement | null, to = 1.15, times = 1, ms = 520): void {
  if (!chip || reduced()) return;
  const kf: Keyframe[] = [{ scale: '1' }];
  for (let i = 0; i < times; i++) kf.push({ scale: String(to) }, { scale: '.97' });
  kf.push({ scale: '1' });
  st.animate(chip, kf, { duration: ms * times, easing: 'ease-in-out', fill: 'none' });
}

export function glowChip(st: FxStage, chip: HTMLElement | null, color: string, ms = 900, size = 22): void {
  if (!chip || reduced()) return;
  st.animate(chip, [
    { filter: `drop-shadow(0 0 0 ${color})` },
    { filter: `drop-shadow(0 0 ${size}px ${color}) brightness(1.25)`, offset: 0.25 },
    { filter: `drop-shadow(0 0 ${size}px ${color}) brightness(1.1)`, offset: 0.6 },
    {},
  ], { duration: ms, fill: 'none' });
}

interface SlamOptions {
  from?: number;
  r0?: number;
  r1?: number;
  ms?: number;
  hold?: number;
  peel?: number;
}

/** A stamp that slams down: scale from big to 1 with overshoot and bounce, lingers, then peels away. */
export function slam(st: FxStage, e: HTMLElement, o: SlamOptions = {}): void {
  const { from = 3, r0 = -22, r1 = -6, ms = 650, hold = 1000, peel = 420 } = o;
  st.animate(e, [
    { transform: `translate(-50%,-50%) scale(${from}) rotate(${r0}deg)`, opacity: 0 },
    { transform: `translate(-50%,-50%) scale(.86) rotate(${r1}deg)`, opacity: 1, offset: 0.34 },
    { transform: `translate(-50%,-50%) scale(1.1) rotate(${r1}deg)`, offset: 0.52 },
    { transform: `translate(-50%,-50%) scale(.97) rotate(${r1}deg)`, offset: 0.72 },
    { transform: `translate(-50%,-50%) scale(1) rotate(${r1}deg)` },
  ], { duration: ms, easing: 'cubic-bezier(.3,.1,.5,1)' });
  st.animate(e, [
    { transform: `translate(-50%,-50%) scale(1) rotate(${r1}deg)`, opacity: 1 },
    { transform: `translate(-30%,-120%) scale(1.15) rotate(${r1 + 24}deg)`, opacity: 0 },
  ], { duration: peel, delay: ms + hold, easing: 'ease-in' });
  st.expire(e, ms + hold + peel + 100);
}

/** Fade a centred element in and out without moving it (reduced motion). */
export function still(st: FxStage, e: HTMLElement, ms: number): void {
  const centred = 'translate(-50%,-50%)';
  st.animate(e, [
    { opacity: 0, transform: centred },
    { opacity: 1, transform: centred, offset: 0.15 },
    { opacity: 1, transform: centred, offset: 0.8 },
    { opacity: 0, transform: centred },
  ], { duration: ms });
  st.expire(e, ms + 100);
}
