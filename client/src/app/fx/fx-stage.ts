/** The overlay the effects draw on: a canvas for particles, a DOM layer for words, rings and flying cards, plus tracked timers and animations. */

export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The element the spot was measured from (null when we had to guess a position). */
  el: HTMLElement | null;
}

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(items: readonly T[]): T => items[(Math.random() * items.length) | 0];
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export function reduced(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Runs an effect and swallows any failure, so a broken effect never breaks the game. */
export function safe(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    try {
      console.warn('fx', e);
    } catch {
      // Nothing more to do.
    }
  }
}

export class FxStage {
  readonly canvas: HTMLCanvasElement;
  readonly layer: HTMLDivElement;
  readonly ctx: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  dpr = 1;
  /** True while the table shake plays (one shake at a time). */
  shaking = false;

  private epoch = 0;
  private readonly timers = new Set<number>();
  private readonly anims = new Set<Animation>();
  private readonly onResize = (): void => this.resize();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fx-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.layer = document.createElement('div');
    this.layer.id = 'fx-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    document.body.append(this.canvas, this.layer);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  /** Scale for sizes: phones get smaller effects. */
  get scale(): number {
    return clamp(Math.min(window.innerWidth, window.innerHeight * 1.4) / 900, 0.55, 1.25);
  }

  private resize(): void {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.layer.style.setProperty('--fx-s', String(this.scale));
  }

  /** setTimeout that is forgotten by clear() and skipped if clear() ran in between. */
  later(fn: () => void, ms: number): number {
    const ep = this.epoch;
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (ep === this.epoch) safe(fn);
    }, Math.max(0, ms));
    this.timers.add(id);
    return id;
  }

  /** Web Animation that is tracked so clear() can cancel it. Pass fill:'none' for animations on the game's own elements. */
  animate(el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
    if (!el || !el.animate) return null;
    try {
      const a = el.animate(keyframes, { fill: 'both', ...options });
      this.anims.add(a);
      const done = (): void => {
        this.anims.delete(a);
      };
      a.finished.then(done, done);
      return a;
    } catch {
      return null;
    }
  }

  /** Creates an element in the overlay (or in `parent`). */
  mk(cls: string, css?: string | null, html?: string | null, parent?: HTMLElement): HTMLDivElement {
    const e = document.createElement('div');
    e.className = cls;
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    (parent ?? this.layer).append(e);
    return e;
  }

  expire(e: Element, ms: number): void {
    this.later(() => e.remove(), ms);
  }

  rectOf(e: Element | null): Spot | null {
    if (!(e instanceof HTMLElement)) return null;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, el: e };
  }

  /** Cancels everything running: timers, animations and the overlay contents (the canvas is wiped by the particle system). */
  clear(): void {
    this.epoch++;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    for (const a of [...this.anims]) {
      try {
        a.cancel();
      } catch {
        // Already gone.
      }
    }
    this.anims.clear();
    this.shaking = false;
    this.layer.replaceChildren();
  }

  destroy(): void {
    this.clear();
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
    this.layer.remove();
  }

  /** Counts of what is alive, for checking that clear() leaves nothing behind. */
  stats(): { layer: number; anims: number; timers: number } {
    return { layer: this.layer.childElementCount, anims: this.anims.size, timers: this.timers.size };
  }
}
