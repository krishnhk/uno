import { RoomView } from '../core/models';
import { Spot, clamp, pick, reduced, rnd } from './fx-stage';
import { deckRect, pileRect, spot } from './geometry';
import {
  COLORS, CONFETTI, Fx, GOLD, MomentOf as Of, RAINBOW, chipFlash, disc, flash, floatText, glowChip, jolt, pulse, ring, shake, slam, still, vignette,
} from './visuals';


const POWER: Partial<Record<string, number>> = { wild4: 1.7, draw2: 1.3, wild: 1.3, skip: 1.15, reverse: 1.1 };
const PLACES = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH'];

// ---------- card impact ----------

/** The card lands on the pile: ripples, a shove for the cards under it, sparks and dust. */
function impact({ stage: st, ps }: Fx, m: Of<'play'>): void {
  const pr = pileRect(st);
  const col = COLORS[m.color] ?? '#cfc6ff';
  const k = st.scale;
  const power = POWER[m.value] ?? 1;
  const size = Math.max(pr.w, pr.h);
  if (reduced()) {
    disc(st, pr.x, pr.y, size * 0.9, col, 600, 0.5);
    return;
  }
  ring(st, pr.x, pr.y, col, { r0: size * 0.35, r1: size * (1.5 + power * 0.6), ms: 650 });
  ring(st, pr.x, pr.y, '#ffffff', { r0: size * 0.3, r1: size * (1.1 + power * 0.4), ms: 520, delay: 70, a: 0.45 });
  // The cards already on the pile get shoved and settle back with a spring.
  const trails = [...document.querySelectorAll('#stage-center .discard .trail')];
  const top = trails[trails.length - 1];
  trails.slice(0, -1).forEach((el, i) => {
    const a = rnd(0, 6.283);
    const d = (5 + 4 * power) * k * (1 - i * 0.08);
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d;
    const r = rnd(-5, 5) * power;
    st.animate(el, [
      { translate: '0 0', rotate: '0deg' },
      { translate: `${dx}px ${dy}px`, rotate: `${r}deg`, offset: 0.16 },
      { translate: `${-dx * 0.5}px ${-dy * 0.5}px`, rotate: `${-r * 0.4}deg`, offset: 0.42 },
      { translate: `${dx * 0.18}px ${dy * 0.18}px`, rotate: `${r * 0.12}deg`, offset: 0.7 },
      { translate: '0 0', rotate: '0deg' },
    ], { duration: 640, easing: 'ease-out', fill: 'none' });
  });
  if (top) st.animate(top, [{ scale: '1.16 .88' }, { scale: '.96 1.06', offset: 0.35 }, { scale: '1.03 .98', offset: 0.65 }, { scale: '1 1' }], { duration: 480, easing: 'ease-out', fill: 'none' });
  ps.burst(pr.x, pr.y, Math.round(10 + 8 * power), { colors: [col, '#fff'], speed: [110 * k, 380 * k * power], g: 600, drag: 2.2, life: [0.35, 0.7], size: [1.8, 3.4], pri: true });
  ps.dust(pr.x, pr.y, 7, pr.w * 0.45, k);
}

/** A wild changes the colour: a big wave across the screen and a rainbow of sparkles. */
function colorWave({ stage: st, ps }: Fx, m: Of<'play'>): void {
  const pr = pileRect(st);
  const col = COLORS[m.color] ?? '#fff';
  if (reduced()) {
    flash(st, 500, 0.18);
    return;
  }
  const far = Math.hypot(Math.max(pr.x, st.W - pr.x), Math.max(pr.y, st.H - pr.y)) + 40;
  ring(st, pr.x, pr.y, col, { r0: 30, r1: far, ms: 1200, a: 0.9, inner: 62 });
  ring(st, pr.x, pr.y, '#ffffff', { r0: 20, r1: far * 0.75, ms: 950, delay: 120, a: 0.35, inner: 80 });
  disc(st, pr.x, pr.y, far * 0.5, col, 900, 0.22);
  const swirl = document.getElementById('swirl');
  if (swirl) {
    st.animate(swirl, [{ filter: `brightness(2.6) saturate(1.6) drop-shadow(0 0 30px ${col})` }, { filter: `brightness(1.8) drop-shadow(0 0 20px ${col})`, offset: 0.4 }, {}], { duration: 900, fill: 'none' });
    st.animate(swirl, [{ scale: '1' }, { scale: '1.18', offset: 0.25 }, { scale: '0.97', offset: 0.55 }, { scale: '1' }], { duration: 700, fill: 'none', easing: 'ease-out' });
  }
  const k = st.scale;
  for (let i = 0; i < 26; i++) {
    const a = rnd(0, 6.283);
    const s = rnd(120, 520) * k;
    ps.spawn({ x: pr.x, y: pr.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 1.6, g: 120, life: rnd(0.8, 1.5), size: rnd(3, 6) * k, color: pick(RAINBOW), kind: i % 2 ? 'star' : 'dot', vr: rnd(-3, 3), flut: rnd(8, 16), pri: true });
  }
}

// ---------- penalties ----------

/** The victim's chip reacts to the cards landing: rings, a jolt and a "+N". */
function hit(fx: Fx, r: Spot, n: number, power: number, label?: string): void {
  const { stage: st, ps } = fx;
  const k = st.scale;
  if (reduced()) {
    chipFlash(st, r, '#ff6a3d');
    floatText(st, label ?? `+${n}`, r.x, r.y - r.h / 2, '#ff7a45', 40 * k);
    return;
  }
  const base = Math.max(r.w, r.h);
  ring(st, r.x, r.y, '#ff5a3c', { r0: base * 0.2, r1: base * 0.7 + 50 * power, ms: 620 });
  ring(st, r.x, r.y, '#ffb347', { r0: base * 0.15, r1: base * 0.55 + 40 * power, ms: 520, delay: 90, a: 0.6 });
  jolt(st, r.el, power);
  floatText(st, label ?? `+${n}`, r.x, r.y - r.h / 2 - 4, '#ff7a45', 46 * k * (0.85 + power * 0.22));
  if (power >= 2) ps.burst(r.x, r.y, 26, { colors: ['#ff6a3d', '#ffd23f', '#fff'], speed: [150 * k, 520 * k], g: 700, drag: 2, life: [0.4, 0.8], size: [2, 4], pri: true });
  if (power >= 3) {
    shake(st, 11, 400, 0.5);
    vignette(st);
  }
}

/** Cards spray from the pile or deck to the victim; the chip reacts when the first one lands. */
function penalty(fx: Fx, victimId: string, n: number, view: RoomView, from: 'deck' | 'pile', power: number, label?: string): void {
  const { stage: st, ps } = fx;
  const dst = spot(st, victimId, view);
  ps.spray(from === 'deck' ? deckRect(st) : pileRect(st), dst, n);
  st.later(() => hit(fx, spot(st, victimId, view), n, power, label), reduced() ? 0 : 560);
}

function reverseFx({ stage: st }: Fx): void {
  const pr = pileRect(st);
  const k = st.scale;
  const swirl = document.getElementById('swirl');
  if (reduced()) {
    disc(st, pr.x, pr.y, 90, '#c4b5fd', 500, 0.4);
    return;
  }
  if (swirl) {
    st.animate(swirl, [
      { rotate: '0deg', filter: 'brightness(2.4) drop-shadow(0 0 24px #fff)' },
      { rotate: '360deg', filter: 'brightness(1.5) drop-shadow(0 0 14px #c4b5fd)', offset: 0.7 },
      { rotate: '360deg' },
    ], { duration: 760, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'none' });
  }
  ring(st, pr.x, pr.y, '#c4b5fd', { r0: 40, r1: 260 * k + 40, ms: 700 });
  ring(st, pr.x, pr.y, '#67e8f9', { r0: 30, r1: 200 * k + 30, ms: 640, delay: 120, a: 0.7 });
  const e = st.mk('fx-word', `left:${pr.x}px;top:${pr.y - pr.h * 0.75}px;--c:#a78bfa;--fs:${34 * k}px`, '⇄ REVERSE');
  st.animate(e, [
    { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
    { transform: 'translate(-50%,-60%) scale(1.15)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: 0.65 },
    { transform: 'translate(-50%,-110%) scale(1)', opacity: 0 },
  ], { duration: 1000, easing: 'ease-out' });
  st.expire(e, 1100);
}

// ---------- skip ----------

function skipFx(fx: Fx, m: Of<'play'>, view: RoomView): void {
  const { stage: st, ps } = fx;
  if (!m.target) return;
  const r = spot(st, m.target, view);
  const k = st.scale;
  const size = Math.round(clamp(150 * k, 96, 190));
  const x = clamp(r.x, size / 2, st.W - size / 2);
  const y = clamp(r.y, size / 2 + 6, st.H - size / 2);
  const svg = `<svg viewBox="0 0 160 160" width="${size}" height="${size}"><circle cx="80" cy="80" r="68" fill="rgba(22,10,45,.62)" stroke="#ff3b52" stroke-width="14"/><line x1="33" y1="127" x2="127" y2="33" stroke="#ff3b52" stroke-width="14" stroke-linecap="round"/></svg>`
    + `<span class="fx-skip-word" style="font-size:${size * 0.3}px">SKIP</span>`;
  const e = st.mk('fx-stamp', `left:${x}px;top:${y}px;width:${size}px;height:${size}px;--c:#ff3b52`, svg);
  if (reduced()) {
    chipFlash(st, r, '#ff3b52');
    still(st, e, 1300);
    return;
  }
  slam(st, e, { from: 3, r0: -26, r1: -9, ms: 620, hold: 900, peel: 420 });
  st.later(() => {
    ring(st, x, y, '#ff3b52', { r0: size * 0.3, r1: size * 1.1, ms: 520 });
    ps.burst(x, y, 16, { colors: ['#ff3b52', '#fff', '#ffb0b8'], speed: [120 * k, 420 * k], g: 500, drag: 2.2, life: [0.3, 0.6], size: [2, 3.6], pri: true });
    jolt(st, r.el, 1.1);
    if (r.el) st.animate(r.el, [{ filter: 'grayscale(1) brightness(.7)' }, { filter: 'grayscale(1) brightness(.7)', offset: 0.7 }, {}], { duration: 1500, fill: 'none' });
  }, 215);
}

/** A card was played: impact first, then whatever its value does. */
export function playFx(fx: Fx, m: Of<'play'>, view: RoomView): void {
  impact(fx, m);
  if (m.value === 'wild' || m.value === 'wild4') colorWave(fx, m);
  if (m.value === 'reverse') reverseFx(fx);
  if (m.value === 'skip') skipFx(fx, m, view);
  if ((m.value === 'draw2' || m.value === 'wild4') && m.target) {
    const n = m.count || (m.value === 'wild4' ? 4 : 2);
    penalty(fx, m.target, n, view, 'pile', m.value === 'wild4' || n >= 4 ? 3 : 1.4);
  }
}

// ---------- take, challenge ----------

export function takeFx(fx: Fx, m: Of<'take'>, view: RoomView): void {
  penalty(fx, m.by, m.count, view, 'deck', m.count >= 4 ? 3 : 1.4);
}

export function challengeFx(fx: Fx, m: Of<'challenge'>, view: RoomView): void {
  const { stage: st } = fx;
  const n = m.count || 0;
  const victim = m.right ? m.target : m.by;
  const r = spot(st, m.by, view);
  floatText(st, m.right ? 'BUSTED!' : 'WRONG CALL!', r.x, r.y - r.h / 2 - 30, m.right ? '#ffd23f' : '#ff7a45', 36 * st.scale);
  if (n >= 1) penalty(fx, victim, n, view, 'pile', n >= 4 ? 3 : 1.4);
}

// ---------- UNO, gotcha, out ----------

export function unoFx({ stage: st, ps }: Fx, m: Of<'uno'>, view: RoomView): void {
  const r = spot(st, m.by, view);
  const k = st.scale * (m.mine ? 1.35 : 1);
  const size = 70 * k;
  const x = clamp(r.x, 90, st.W - 90);
  const y = clamp(r.y - r.h / 2 - size * 0.45, size * 0.7, st.H - 60);
  if (reduced()) {
    chipFlash(st, r, '#ffd23f');
    floatText(st, 'UNO!', x, y, '#ffd23f', size * 0.8);
    return;
  }
  const rays = st.mk('fx-rays', `left:${x}px;top:${y}px;width:${size * 5}px;height:${size * 5}px;--c:${m.mine ? '#fff3a0' : '#ffd23f'}`);
  st.animate(rays, [
    { transform: 'translate(-50%,-50%) scale(.2) rotate(0deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1) rotate(40deg)', opacity: 0.95, offset: 0.25 },
    { transform: 'translate(-50%,-50%) scale(1.15) rotate(90deg)', opacity: 0 },
  ], { duration: 1200, easing: 'ease-out' });
  st.expire(rays, 1300);
  const e = st.mk('fx-word fx-uno', `left:${x}px;top:${y}px;--c:${m.mine ? '#ffe27a' : '#ff4d5e'};--fs:${size}px`, 'UNO!');
  st.animate(e, [
    { transform: 'translate(-50%,-50%) scale(0) rotate(-14deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.5) rotate(6deg)', opacity: 1, offset: 0.2 },
    { transform: 'translate(-50%,-50%) scale(.9) rotate(-3deg)', offset: 0.38 },
    { transform: 'translate(-50%,-50%) scale(1.08) rotate(1deg)', offset: 0.55 },
    { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.78 },
    { transform: 'translate(-50%,-90%) scale(1)', opacity: 0 },
  ], { duration: 1500, easing: 'cubic-bezier(.3,.1,.4,1)' });
  st.expire(e, 1600);
  ring(st, r.x, r.y, '#ffd23f', { r0: 20, r1: Math.max(r.w, r.h) * 0.8 + 40 * k, ms: 650 });
  pulse(st, r.el, m.mine ? 1.22 : 1.14, 2, 360);
  glowChip(st, r.el, '#ffd23f', 1100, m.mine ? 30 : 20);
  ps.burst(x, y, m.mine ? 44 : 24, { colors: ['#ffd23f', '#fff', '#ff7ac8', '#67e8f9'], speed: [90 * k, 460 * k], g: 260, drag: 1.8, life: [0.5, 1.1], size: [2.2, 4.2], kind: 'star', pri: true });
  ps.burst(x, y, m.mine ? 28 : 14, { colors: ['#ffd23f', '#fff'], speed: [150 * k, 560 * k], g: 500, drag: 2.2, life: [0.3, 0.7], size: [1.8, 3], pri: true });
  if (m.mine) ring(st, r.x, r.y, '#fff', { r0: 30, r1: Math.max(r.w, r.h) + 120, ms: 850, delay: 120, a: 0.6 });
}

export function caughtFx(fx: Fx, m: Of<'caught'>, view: RoomView): void {
  const { stage: st, ps } = fx;
  const victim = spot(st, m.target, view);
  const k = st.scale;
  const forgot = !m.by;
  const text = forgot ? 'FORGOT UNO!' : 'GOTCHA!';
  const size = (forgot ? 52 : 66) * k;
  const x = clamp(victim.x, size * 2.2, st.W - size * 2.2);
  const y = clamp(victim.y - victim.h / 2 - size * 0.9, size, st.H - size * 1.5);
  if (!forgot) {
    if (!reduced()) flash(st, 420, 0.96);
    else flash(st, 300, 0.2);
  }
  const e = st.mk('fx-gotcha', `left:${x}px;top:${y}px;--fs:${size}px`,
    `<span class="fx-word fx-gotcha-word" style="--c:#ff3b52">${text}</span><span class="fx-busted" style="font-size:${size * 0.34}px">BUSTED</span>`);
  if (reduced()) still(st, e, 1500);
  else {
    slam(st, e, { from: 2.7, r0: 10, r1: -5, ms: 560, hold: 1000, peel: 420 });
    st.later(() => {
      ring(st, x, y, '#ff3b52', { r0: size * 0.5, r1: size * 3, ms: 560 });
      ps.burst(x, y, 22, { colors: ['#ff3b52', '#fff', '#ffd23f'], speed: [150 * k, 520 * k], g: 600, drag: 2, life: [0.3, 0.7], size: [2, 3.6], pri: true });
      shake(st, 9, 380, 0.5);
    }, 190);
  }
  if (m.by) {
    const c = spot(st, m.by, view);
    if (reduced()) chipFlash(st, c, '#ffd23f');
    else {
      pulse(st, c.el, 1.18, 2, 340);
      glowChip(st, c.el, '#ffd23f', 1000, 22);
      ring(st, c.x, c.y, '#ffd23f', { r0: 20, r1: Math.max(c.w, c.h) * 0.8 + 40, ms: 650 });
      ps.burst(c.x, c.y, 18, { colors: GOLD, speed: [100 * k, 380 * k], g: 400, drag: 2, life: [0.5, 1], size: [2, 3.6], kind: 'star', pri: true });
    }
  }
  st.later(() => penalty(fx, m.target, m.count || 2, view, 'deck', 1.4), reduced() ? 0 : 650);
}

/** A player went out: their place ("1ST", "2ND"...) floats up and a pop of confetti. */
export function outFx({ stage: st, ps }: Fx, m: Of<'out'>, view: RoomView): void {
  const r = spot(st, m.by, view);
  const k = st.scale;
  const label = PLACES[m.place] ?? `${m.place}TH`;
  const gold = m.place === 1;
  const e = st.mk('fx-place', `left:${clamp(r.x, 50, st.W - 50)}px;top:${clamp(r.y - r.h / 2, 40, st.H - 40)}px;--fs:${34 * k}px;--g:${gold ? '#ffd23f,#ff9f1c' : '#f3f4f6,#9ca3af'}`, label);
  if (reduced()) {
    chipFlash(st, r, '#ffd23f');
    still(st, e, 1800);
    return;
  }
  st.animate(e, [
    { transform: 'translate(-50%,-30%) scale(.3)', opacity: 0 },
    { transform: 'translate(-50%,-90%) scale(1.3)', opacity: 1, offset: 0.2 },
    { transform: 'translate(-50%,-120%) scale(1)', opacity: 1, offset: 0.4 },
    { transform: 'translate(-50%,-190%) scale(1)', opacity: 1, offset: 0.8 },
    { transform: 'translate(-50%,-230%) scale(1)', opacity: 0 },
  ], { duration: 2200, easing: 'ease-out' });
  st.expire(e, 2300);
  pulse(st, r.el, 1.15, 1, 450);
  for (let i = 0; i < 46; i++) {
    const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05);
    const s = rnd(250, 780) * k;
    ps.spawn({ x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 800, drag: 1.9, life: rnd(1.6, 2.6), size: rnd(6, 10) * Math.max(0.75, k), color: pick(CONFETTI), kind: 'conf', rot: rnd(0, 6), vr: rnd(-12, 12), flut: rnd(6, 14), sway: rnd(10, 40) });
  }
}
