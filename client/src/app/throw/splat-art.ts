// The imperative art of the throw effects: the tomato splatter, the cracked egg and the hearts.
// Built with plain DOM and the Web Animations API, like the flying cards: it is all short-lived overlay.

const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number>;

/** A small HTML element builder. */
export function html<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Node[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

/** Plays a Web Animation on a new element inside `parent`, removing it when done. */
export function burstBit(parent: HTMLElement, cls: string, content: string, frames: Keyframe[], options: KeyframeAnimationOptions, style = ''): void {
  const el = html('span', { class: cls, style }, content);
  parent.append(el);
  el.animate(frames, { fill: 'forwards', ...options }).finished.then(() => el.remove(), () => el.remove());
}

/** Something flying off the hit: out and up, then falling and spinning as it fades. */
function flyOff(box: HTMLElement, el: HTMLElement, size: number, { angle, reach = 0.6, spin = 360, duration = 800 }: { angle: number; reach?: number; spin?: number; duration?: number }): void {
  const dx = Math.cos(angle) * size * reach;
  const up = Math.sin(angle) * size * reach;
  box.append(el);
  el.animate([
    { transform: 'translate(-50%, -50%) rotate(0deg) scale(0.6)', opacity: 1 },
    { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${up * 0.6 - size * 0.18}px)) rotate(${spin * 0.4}deg) scale(1)`, opacity: 1, offset: 0.35 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${up + size * 0.55}px)) rotate(${spin}deg) scale(0.85)`, opacity: 0 },
  ], { duration, easing: 'cubic-bezier(0.25, 0.6, 0.5, 1)', fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
}

type Point = [number, number];

/** Smooth closed outline through points around the centre of a 100×100 box. */
function blobPath(points: Point[]): string {
  const n = points.length;
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(points[n - 1], points[0]);
  let d = `M ${start[0].toFixed(1)} ${start[1].toFixed(1)}`;
  points.forEach((p, i) => {
    const m = mid(p, points[(i + 1) % n]);
    d += ` Q ${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  });
  return `${d} Z`;
}

/** A blob of random radius around (cx, cy). */
function blobAround(cx: number, cy: number, count: number, minR: number, maxR: number, squash = 1): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = rand(minR, maxR);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash];
  });
}

export function burstTomato(box: HTMLElement, size: number): void {
  // The splatter: a lumpy core, tapered streaks of very different lengths (each ending in a drop),
  // and a few small separate splats thrown further out.
  const parts: SVGElement[] = [];
  const core = blobAround(50, 50, 16, 17, 28);
  const streaks: SVGElement[] = [];
  const count = 7 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const long = Math.random() < 0.45;
    const len = long ? rand(34, 46) : rand(24, 32);
    const base = rand(3, 6.5);
    const from = 16;
    const px = -Math.sin(a);
    const py = Math.cos(a);
    const bx = 50 + Math.cos(a) * from;
    const by = 50 + Math.sin(a) * from;
    const tx = 50 + Math.cos(a) * len;
    const ty = 50 + Math.sin(a) * len;
    // A narrow wedge: wide where it leaves the core, a thin neck before the drop at the end.
    const d = `M ${(bx + px * base).toFixed(1)} ${(by + py * base).toFixed(1)}`
      + ` Q ${(tx - Math.cos(a) * 6 + px * 0.9).toFixed(1)} ${(ty - Math.sin(a) * 6 + py * 0.9).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`
      + ` Q ${(tx - Math.cos(a) * 6 - px * 0.9).toFixed(1)} ${(ty - Math.sin(a) * 6 - py * 0.9).toFixed(1)} ${(bx - px * base).toFixed(1)} ${(by - py * base).toFixed(1)} Z`;
    streaks.push(svg('path', { d, fill: '#d8231f', class: 'streak' }));
    parts.push(svg('circle', { cx: tx + Math.cos(a) * 1.5, cy: ty + Math.sin(a) * 1.5, r: rand(1.6, long ? 3.8 : 3), fill: '#d8231f', class: 'streak' }));
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(40, 48);
    parts.push(svg('path', { d: blobPath(blobAround(50 + Math.cos(a) * r, 50 + Math.sin(a) * r, 7, 2, 4.5)), fill: '#d8231f', class: 'streak' }));
  }
  const seeds = Array.from({ length: 10 }, () => {
    const a = Math.random() * Math.PI * 2;
    const r = rand(4, 15);
    const cx = 50 + Math.cos(a) * r;
    const cy = 50 + Math.sin(a) * r;
    return svg('ellipse', { cx, cy, rx: 1.9, ry: 1.1, fill: '#ffe08a', transform: `rotate(${(a * 180) / Math.PI} ${cx} ${cy})` });
  });
  const splash = svg('svg', { viewBox: '0 0 100 100', class: 'splat-art' },
    ...streaks,
    ...parts,
    svg('path', { d: blobPath(core), fill: '#e0291f', stroke: '#8f0f12', 'stroke-width': '1' }),
    // Pulp: lighter, wetter patches; then the seeds in it.
    svg('path', { d: blobPath(core.map(([x, y]): Point => [50 + (x - 50) * 0.62, 50 + (y - 50) * 0.62])), fill: '#ff5a43', opacity: '0.75' }),
    ...seeds,
    svg('ellipse', { cx: 42, cy: 41, rx: 8, ry: 3.5, fill: 'rgba(255,255,255,0.45)', transform: 'rotate(-30 42 41)' }));
  const art = html('div', { class: 'splat-art-wrap', style: `rotate:${Math.round(Math.random() * 360)}deg` });
  art.append(splash);
  box.append(art);
  art.animate([
    { scale: '0.2', opacity: 0.6 },
    { scale: '1.15', opacity: 1, offset: 0.45 },
    { scale: '0.95', offset: 0.75 },
    { scale: '1' },
  ], { duration: 420, easing: 'ease-out' });
  // Streaks and outer drops shoot out from the middle.
  for (const el of [...streaks, ...parts]) {
    el.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: rand(160, 300), easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'both' });
  }

  // Skin pieces and the stalk fly off; juice drops spray.
  const skin = (w: number, hgt: number) => html('span', { class: 'tomato-skin', style: `width:${w}px;height:${hgt}px` });
  for (let i = 0; i < 5; i++) {
    flyOff(box, skin(size * rand(0.13, 0.2), size * rand(0.08, 0.13)), size, {
      angle: -Math.PI / 2 + (i - 2) * 0.75 + Math.random() * 0.3, reach: rand(0.55, 0.8), spin: rand(300, 660), duration: rand(750, 1000),
    });
  }
  flyOff(box, html('span', { class: 'tomato-stalk' }, '🌿'), size, { angle: -Math.PI / 2 - 0.4, reach: 0.7, spin: 540, duration: 950 });
  for (let i = 0; i < 12; i++) {
    const d = rand(4, 10);
    flyOff(box, html('span', { class: 'splat-drop', style: `width:${d}px;height:${d}px;background:${i % 3 ? '#e0291f' : '#ff6b55'}` }), size, {
      angle: Math.random() * Math.PI * 2, reach: rand(0.5, 0.9), spin: 0, duration: rand(550, 850),
    });
  }
}

export function crackEgg(box: HTMLElement, size: number): void {
  // The white spreads slowly, like liquid finding its shape.
  const white = blobAround(50, 50, 12, 26, 40, 0.92);
  const whiteSvg = svg('svg', { viewBox: '0 0 100 100', class: 'splat-art' },
    svg('path', { d: blobPath(white), fill: '#fffdf7', stroke: '#e6dcc4', 'stroke-width': '1.2' }),
    svg('path', { d: blobPath(white.map(([x, y]): Point => [50 + (x - 50) * 0.8, 50 + (y - 50) * 0.8])), fill: '#ffffff', opacity: '0.7' }),
    svg('ellipse', { cx: 36, cy: 34, rx: 10, ry: 4, fill: 'rgba(255,255,255,0.9)', transform: 'rotate(-25 36 34)' }));
  const whiteWrap = html('div', { class: 'splat-art-wrap', style: `rotate:${Math.round(Math.random() * 360)}deg` });
  whiteWrap.append(whiteSvg);
  box.append(whiteWrap);
  whiteWrap.animate([
    { scale: '0.25 0.25', opacity: 0.8 },
    { scale: '0.85 0.8', opacity: 1, offset: 0.4 },
    { scale: '1.04 0.98', offset: 0.75 },
    { scale: '1 1' },
  ], { duration: 700, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });

  // The yolk lands a beat later and jiggles.
  const yolk = svg('svg', { viewBox: '0 0 40 40', class: 'egg-yolk' },
    svg('circle', { cx: 20, cy: 20, r: 17, fill: '#ffb800', stroke: '#e08a00', 'stroke-width': '1.5' }),
    svg('circle', { cx: 20, cy: 21, r: 13, fill: '#ffc93c' }),
    svg('ellipse', { cx: 14, cy: 13, rx: 5, ry: 3, fill: 'rgba(255,255,255,0.85)', transform: 'rotate(-30 14 13)' }));
  const yolkWrap = html('div', { class: 'egg-yolk-wrap', style: `width:${size * 0.34}px;height:${size * 0.34}px` });
  yolkWrap.append(yolk);
  box.append(yolkWrap);
  yolkWrap.animate([
    { scale: '0 0', offset: 0 },
    { scale: '0 0', offset: 0.15 },
    { scale: '1.25 0.8', offset: 0.4 },
    { scale: '0.88 1.12', offset: 0.6 },
    { scale: '1.06 0.95', offset: 0.8 },
    { scale: '1 1' },
  ], { duration: 800, easing: 'ease-out', fill: 'backwards' });

  // The shell breaks in two and the halves tumble away; a few small shell bits too.
  const shell = (cls: string, w: number) => html('span', { class: `egg-shell ${cls}`, style: `width:${w}px;height:${w * 0.62}px` });
  flyOff(box, shell('left', size * 0.3), size, { angle: Math.PI + 0.5, reach: 0.55, spin: -260, duration: 900 });
  flyOff(box, shell('right', size * 0.3), size, { angle: -0.5, reach: 0.55, spin: 260, duration: 900 });
  for (let i = 0; i < 4; i++) {
    flyOff(box, shell('bit', size * rand(0.07, 0.12)), size, {
      angle: -Math.PI / 2 + (Math.random() - 0.5) * 2.4, reach: rand(0.4, 0.7), spin: rand(400, 700), duration: rand(650, 900),
    });
  }
  for (let i = 0; i < 7; i++) {
    const d = rand(4, 9);
    flyOff(box, html('span', { class: 'splat-drop', style: `width:${d}px;height:${d}px;background:#fffdf7` }), size, {
      angle: Math.random() * Math.PI * 2, reach: rand(0.45, 0.75), spin: 0, duration: rand(600, 850),
    });
  }
}

const HEARTS = ['❤️', '💖', '💕', '💗', '💞'];

/** A pink glow pulses round the player and little hearts float up. */
export function floatHearts(box: HTMLElement, size: number): void {
  for (let i = 0; i < 2; i++) {
    burstBit(box, 'love-ring', '', [
      { scale: '0.4', opacity: 0.9 },
      { scale: '1.5', opacity: 0 },
    ], { duration: 900, delay: i * 260, easing: 'ease-out' });
  }
  for (let i = 0; i < 14; i++) {
    const dx = (Math.random() - 0.5) * size * 1.3;
    const rise = size * rand(0.7, 1.5);
    const sway = (Math.random() - 0.5) * 40;
    burstBit(box, 'love-heart', HEARTS[i % HEARTS.length], [
      { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.4}px), calc(-50% - ${rise * 0.3}px)) scale(1.1)`, opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${dx + sway}px), calc(-50% - ${rise}px)) scale(0.8) rotate(${sway / 2}deg)`, opacity: 0 },
    ], { duration: rand(1400, 2100), delay: Math.random() * 350, easing: 'ease-out' },
    `font-size:${rand(16, 30)}px`);
  }
}
