import { RoomView } from '../core/models';
import { clamp, pick, reduced, rnd } from './fx-stage';
import { nameOf, spot } from './geometry';
import { CONFETTI, Fx, GOLD, MomentOf as Of, RAINBOW, flash, glowChip, ring, shake } from './visuals';

const TROPHY = '<svg viewBox="0 0 120 140" class="fx-trophy-svg"><defs><linearGradient id="fx-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a86a05"/><stop offset=".3" stop-color="#ffe27a"/><stop offset=".6" stop-color="#ffc22e"/><stop offset="1" stop-color="#9a5f04"/></linearGradient></defs>'
  + '<path d="M30 22H12c0 22 8 36 25 41" fill="none" stroke="url(#fx-gold)" stroke-width="8" stroke-linecap="round"/><path d="M90 22h18c0 22-8 36-25 41" fill="none" stroke="url(#fx-gold)" stroke-width="8" stroke-linecap="round"/>'
  + '<path d="M28 10h64v38c0 24-14 38-32 38S28 72 28 48z" fill="url(#fx-gold)" stroke="#fff3b0" stroke-width="2"/><path d="M38 16h8v34c0 14 5 22 12 28-14-3-20-14-20-30z" fill="#fff" opacity=".35"/>'
  + '<polygon points="60,26 65,40 80,40 68,49 72,63 60,54 48,63 52,49 40,40 55,40" fill="#fff8d0" opacity=".9"/>'
  + '<rect x="53" y="84" width="14" height="20" fill="url(#fx-gold)"/><path d="M36 104h48l6 14H30z" fill="url(#fx-gold)" stroke="#fff3b0" stroke-width="1.5"/><rect x="26" y="118" width="68" height="16" rx="5" fill="#7a4a05" stroke="#ffd23f" stroke-width="2"/></svg>';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);

type Tier = 1 | 2 | 3 | 4;

/** Pops an element in with overshoot (or just fades it in for reduced motion). */
function enter(fx: Fx, el: HTMLElement | null, delay: number, ms: number, rm: boolean, r = -6): void {
  if (!el) return;
  if (rm) {
    fx.stage.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay });
    return;
  }
  fx.stage.animate(el, [
    { transform: `scale(0) rotate(${r}deg)`, opacity: 0 },
    { transform: 'scale(1.3) rotate(2deg)', opacity: 1, offset: 0.4 },
    { transform: 'scale(.92) rotate(-1deg)', offset: 0.62 },
    { transform: 'scale(1.04) rotate(0deg)', offset: 0.82 },
    { transform: 'scale(1) rotate(0deg)', opacity: 1 },
  ], { duration: ms, delay, easing: 'cubic-bezier(.3,.1,.4,1)' });
}

/** The score counts up with little pops. */
function countScore(fx: Fx, el: HTMLElement, score: number, start: number): void {
  const { stage: st } = fx;
  const steps = 22;
  for (let i = 1; i <= steps; i++) {
    st.later(() => {
      el.textContent = `+${Math.round(score * (1 - Math.pow(1 - i / steps, 2)))} pts`;
      if (i % 5 === 0 || i === steps) st.animate(el, [{ scale: '1' }, { scale: i === steps ? '1.35' : '1.14' }, { scale: '1' }], { duration: i === steps ? 450 : 200, fill: 'none' });
    }, start + i * 60);
  }
}

/** Tier 4: the drumroll before the reveal (dim, pulse, shake, converging rings), then a white flash. */
function drumroll(fx: Fx, root: HTMLElement, t0: number): void {
  const { stage: st } = fx;
  const dim = st.mk('fx-dim', null, null, root);
  st.animate(dim, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0.6, offset: 0.5 }, { opacity: 1, offset: 0.75 }, { opacity: 1, offset: 0.95 }, { opacity: 0 }], { duration: t0 + 450, easing: 'ease-in-out' });
  const vg = st.mk('fx-vignette', null, null, root);
  st.animate(vg, [{ opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }], { duration: 260, iterations: Math.ceil(t0 / 260), easing: 'ease-in-out' });
  for (let i = 0; i < 5; i++) {
    st.later(() => {
      ring(st, st.W / 2, st.H * 0.45, '#ffd23f', { r0: Math.min(st.W, st.H) * 0.7, r1: 30, ms: 420, a: 0.7 });
      shake(st, 3 + i, 260, 0.2);
    }, i * 240);
  }
  st.later(() => {
    flash(st, 700, 1);
    shake(st, 18, 520, 1.2);
  }, t0);
}

/** Confetti cannons from the bottom corners, with the tier's rings. */
function cannons(fx: Fx, tier: Tier, t0: number): void {
  const { stage: st, ps } = fx;
  const waves = tier === 1 ? [0, 1200] : tier === 2 ? [0, 1500] : tier === 3 ? [0, 1800] : [0, 1500, 3000];
  const perSide = tier === 1 ? 32 : tier === 2 ? 34 : tier === 3 ? 36 : 40;
  waves.forEach((w, i) => st.later(() => {
    const cols = i % 2 ? GOLD.concat(CONFETTI) : CONFETTI;
    ps.cannon(-1, perSide, cols);
    ps.cannon(1, perSide, cols);
    if (i === 0 || tier === 4) shake(st, tier >= 3 ? 7 : 4, 260, 0.3);
  }, t0 + w));
  if (tier === 4) {
    const far = Math.hypot(st.W, st.H);
    st.later(() => RAINBOW.forEach((c, i) => ring(st, st.W / 2, st.H * 0.45, c, { r0: 30, r1: far * 0.8, ms: 1300, delay: i * 70, a: 0.8, inner: 70 })), t0);
  } else if (tier === 3) {
    st.later(() => ring(st, st.W / 2, st.H * 0.45, '#ffd23f', { r0: 30, r1: Math.max(st.W, st.H) * 0.7, ms: 1000, a: 0.7, inner: 70 }), 650);
  }
}

/** Fireworks and star sparkles. */
function fireworks(fx: Fx, tier: Tier, t0: number): void {
  const { stage: st, ps } = fx;
  const k = st.scale;
  const shellCount = tier === 1 ? 0 : tier === 2 ? 4 : tier === 3 ? 7 : 18;
  const salvoAt = [0, 1200, 2600];
  for (let i = 0; i < shellCount; i++) {
    const at = tier === 4 ? t0 + salvoAt[Math.floor(i / 6)] + (i % 6) * 110 : 350 + i * (tier === 2 ? 480 : 420);
    st.later(() => ps.shell(rnd(st.W * 0.12, st.W * 0.88), rnd(st.H * 0.14, st.H * 0.46), Math.random() < 0.5 ? [pick(RAINBOW), pick(RAINBOW)] : GOLD, tier === 4 ? 52 : 44), at);
  }
  if (tier >= 2) {
    for (let j = 0; j < 9; j++) {
      st.later(() => {
        for (let i = 0; i < 6; i++) ps.spawn({ x: rnd(st.W * 0.15, st.W * 0.85), y: rnd(st.H * 0.12, st.H * 0.6), vx: rnd(-10, 10), vy: rnd(-20, 10), drag: 0.5, life: rnd(0.9, 1.8), size: rnd(5, 11) * k, color: pick(GOLD.concat(['#ffffff'])), kind: 'star', flut: rnd(5, 10), vr: rnd(-1, 1) });
      }, t0 + j * 450);
    }
  }
}

/** Spotlight beams sweeping from the top. */
function beams(fx: Fx, root: HTMLElement, tier: Tier, t0: number): void {
  const { stage: st } = fx;
  const count = tier === 4 ? 4 : 3;
  for (let i = 0; i < count; i++) {
    const bw = Math.max(st.W, st.H) * 0.34;
    const b = st.mk('fx-beam', `left:${st.W * ((i + 0.5) / count) - bw / 2}px;width:${bw}px;height:${st.H * 1.25}px;--c:${tier === 4 ? pick(RAINBOW) : '#fff3b0'}`, null, root);
    const d = i % 2 ? -1 : 1;
    st.animate(b, [
      { transform: `rotate(${-28 * d}deg)`, opacity: 0 },
      { transform: `rotate(${-20 * d}deg)`, opacity: 0.9, offset: 0.12 },
      { transform: `rotate(${24 * d}deg)`, opacity: 0.9, offset: 0.55 },
      { transform: `rotate(${-22 * d}deg)`, opacity: 0.9, offset: 0.9 },
      { transform: `rotate(${-22 * d}deg)`, opacity: 0.8 },
    ], { duration: 4800, delay: t0 + i * 120, easing: 'ease-in-out' });
  }
}

/** The trophy drops from the top with bounces and squash; landing shakes the table and sprays gold. */
function dropTrophy(fx: Fx, trophy: HTMLElement, rays: HTMLElement | null, tier: Tier, t0: number, trophySize: number): void {
  const { stage: st, ps } = fx;
  const k = st.scale;
  const dly = t0 + 250;
  const dur = 1300;
  st.animate(trophy, [
    { transform: `translateY(${-st.H * 0.9}px) rotate(-18deg) scale(1)`, opacity: 1, easing: 'cubic-bezier(.5,0,.9,.6)' },
    { transform: 'translateY(0) rotate(0deg) scale(1.18,.8)', opacity: 1, offset: 0.46, easing: 'ease-out' },
    { transform: 'translateY(-70px) rotate(5deg) scale(.95,1.08)', offset: 0.62, easing: 'ease-in' },
    { transform: 'translateY(0) rotate(0) scale(1.08,.92)', offset: 0.76, easing: 'ease-out' },
    { transform: 'translateY(-22px) rotate(-2deg) scale(1)', offset: 0.87, easing: 'ease-in' },
    { transform: 'translateY(0) rotate(0) scale(1)', opacity: 1 },
  ], { duration: dur, delay: dly });
  const landing = (n: number, amp: number): void => {
    const r = st.rectOf(trophy);
    if (!r) return;
    shake(st, amp, 420, 1);
    ps.burst(r.x, r.y + r.h * 0.45, n, { colors: GOLD, speed: [150 * k, 650 * k], angle: [-Math.PI, 0], g: 900, drag: 1.8, life: [0.5, 1.1], size: [2, 4], pri: true });
    ps.dust(r.x, r.y + r.h * 0.45, 8, r.w * 0.4, k);
    ring(st, r.x, r.y + r.h * 0.45, '#ffd23f', { r0: 20, r1: trophySize * 2.2, ms: 700 });
  };
  st.later(() => landing(34, tier === 4 ? 16 : 11), dly + dur * 0.46);
  st.later(() => landing(18, 6), dly + dur * 0.76);
  if (rays) {
    st.animate(rays, [
      { transform: 'translate(-50%,-50%) scale(.2) rotate(0deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(60deg)', opacity: 0.9, offset: 0.2 },
      { transform: 'translate(-50%,-50%) scale(1.1) rotate(300deg)', opacity: 0.85 },
    ], { duration: 4400, delay: dly + 450, easing: 'linear' });
    st.later(() => {
      const r = st.rectOf(trophy);
      if (r) {
        rays.style.left = `${r.x}px`;
        rays.style.top = `${r.y}px`;
      }
    }, dly + dur);
  }
  // Golden rain.
  for (let t = t0 + 700; t < t0 + 3600; t += 90) {
    st.later(() => {
      for (let i = 0; i < (tier === 4 ? 4 : 3); i++) ps.spawn({ x: rnd(0, st.W), y: -10, vx: rnd(-30, 30), vy: rnd(80, 220), g: 380, drag: 1.4, life: rnd(2.6, 4), size: rnd(5, 9) * Math.max(0.75, k), color: pick(GOLD), kind: 'conf', rot: rnd(0, 6), vr: rnd(-9, 9), flut: rnd(8, 16), sway: rnd(8, 28) });
    }, t);
  }
}

/** The end of the game: banner, score, trophy, confetti, fireworks. The bigger the win (tier 1 to 4), the bigger the show. */
export function winFx(fx: Fx, m: Of<'gameover'>, view: RoomView): void {
  const { stage: st } = fx;
  const tier = clamp(m.tier || 1, 1, 4) as Tier;
  const you = m.winnerId === view.youId;
  const name = nameOf(m.winnerId, view);
  const k = st.scale;
  const rm = reduced();
  const winner = spot(st, m.winnerId, view);
  const score = Math.max(0, Math.round(m.winnerScore || 0));
  const t0 = tier === 4 && !rm ? 1200 : 0;

  const root = st.mk('fx-win');
  const bs = Math.round((tier === 4 ? 96 : tier === 3 ? 88 : 80) * k);
  const trophySize = Math.round((tier === 4 ? 210 : 150) * k);
  const stack = st.mk('fx-stack', null, null, root);
  const banner = st.mk('fx-banner' + (you ? '' : ' fx-other'), `--bs:${bs}px`, you ? 'YOU WIN!' : `<span class="fx-who">${esc(name.toUpperCase())}</span><span>WINS!</span>`, stack);
  const tag = tier === 4 ? st.mk('fx-tag', `--ts:${Math.round(bs * 0.6)}px`, 'LEGENDARY!', stack) : null;
  let trophy: HTMLElement | null = null;
  let rays: HTMLElement | null = null;
  if (tier >= 3) {
    if (tier === 4) rays = st.mk('fx-rays fx-trophy-rays', `--c:#ffe27a;width:${trophySize * 4.4}px;height:${trophySize * 4.4}px;left:50%;top:50%`, null, root);
    trophy = st.mk('fx-trophy', `width:${trophySize}px;height:${Math.round(trophySize * 1.17)}px`, TROPHY, stack);
  }
  const scoreEl = tier >= 2 ? st.mk('fx-score', `--ss:${Math.round(44 * k * (tier >= 3 ? 1.1 : 0.9))}px`, '+0 pts', stack) : null;

  // The winner's chip: a gold glow with a crown.
  const glow = st.mk('fx-chipglow fx-win-glow', `left:${winner.x - winner.w / 2 - 6}px;top:${winner.y - winner.h / 2 - 6}px;width:${winner.w + 12}px;height:${winner.h + 12}px;--c:${tier >= 3 ? '#ffd23f' : '#ffe27a'}`, null, root);
  const crown = st.mk('fx-crown', `left:${winner.x}px;top:${winner.y - winner.h / 2 - 6}px;--fs:${26 * k}px`, '👑', root);
  st.animate(glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: t0 });
  st.animate(crown, [
    { opacity: 0, transform: 'translate(-50%,-250%) rotate(-30deg)' },
    { opacity: 1, transform: 'translate(-50%,-100%) rotate(8deg)', offset: 0.7 },
    { opacity: 1, transform: 'translate(-50%,-100%) rotate(0deg)' },
  ], { duration: rm ? 1 : 700, delay: t0 + 200, easing: 'cubic-bezier(.3,1.5,.5,1)' });

  enter(fx, banner, t0 + 30, 850, rm);
  enter(fx, tag, t0 + 410, 800, rm, 4);
  enter(fx, scoreEl, t0 + (tier >= 3 ? 900 : 500), 500, rm);

  if (scoreEl) {
    if (rm) scoreEl.textContent = `+${score} pts`;
    else countScore(fx, scoreEl, score, t0 + (tier >= 3 ? 1000 : 600));
  }

  if (rm) {
    if (tier >= 3) st.later(() => flash(st, 400, 0.25), 100);
    return;
  }

  if (tier === 4) drumroll(fx, root, t0);
  cannons(fx, tier, t0);
  fireworks(fx, tier, t0);
  if (tier >= 3) beams(fx, root, tier, t0);
  if (trophy) dropTrophy(fx, trophy, rays, tier, t0, trophySize);
  if (tier === 4) st.later(() => glowChip(st, winner.el, '#ffd23f', 3600, 34), t0);
  // Failsafe in case clear() is never called.
  st.later(() => fx.clearAll(), 20000);
}

