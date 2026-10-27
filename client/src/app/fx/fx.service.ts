import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Moment, RoomView } from '../core/models';
import { RoomStore } from '../core/room.store';
import { caughtFx, challengeFx, outFx, playFx, takeFx, unoFx } from './effects';
import { FX_STYLES } from './fx-styles';
import { FxStage, safe } from './fx-stage';
import { ParticleSystem } from './particles';
import { Fx } from './visuals';
import { winFx } from './win';

/**
 * Table animations and the win celebration (the Angular version of public/fx.js).
 * Physical feel: gravity, bounce, friction, spin, squash, impact shake. Everything lives in #fx-layer (DOM) and
 * #fx-canvas (particles) and is removed by clear(). Any failure is swallowed so the game never breaks.
 */
@Injectable({ providedIn: 'root' })
export class FxService {
  private readonly store = inject(RoomStore);
  private fx: Fx | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private readonly pending = new Set<() => void>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.store.updates.pipe(takeUntilDestroyed(destroyRef)).subscribe(({ view, moments }) => {
      if (moments.length) this.afterRender(() => this.react(moments, view));
    });
    destroyRef.onDestroy(() => this.destroy());
  }

  /** Plays the effects for the moments of one update. Delays follow the legacy timings (the play lands first, penalties after it). */
  react(moments: Moment[], view: RoomView): void {
    safe(() => {
      const fx = this.ensure();
      if (!moments.length || !fx) return;
      const { stage: st } = fx;
      let afterPlay = 0;
      const hasOut = moments.some((m) => m.type === 'out');
      for (const m of moments) {
        switch (m.type) {
          case 'play':
            st.later(() => playFx(fx, m, view), 750);
            afterPlay = 820;
            break;
          case 'take':
            if (m.count >= 1) st.later(() => takeFx(fx, m, view), afterPlay);
            break;
          case 'challenge':
            st.later(() => challengeFx(fx, m, view), afterPlay);
            break;
          case 'caught':
            st.later(() => caughtFx(fx, m, view), afterPlay);
            break;
          case 'uno':
            st.later(() => unoFx(fx, m, view), afterPlay);
            break;
          case 'out':
            st.later(() => outFx(fx, m, view), afterPlay + 60);
            break;
          case 'gameover':
            st.later(() => winFx(fx, m, view), (hasOut ? 1100 : 300) + afterPlay);
            break;
          default:
            break;
        }
      }
    });
  }

  /** Removes every effect still on screen: the canvas, the overlay and running timers (called when the scorecard opens). */
  clear(): void {
    this.pending.forEach((cancel) => cancel());
    this.pending.clear();
    if (!this.fx) return;
    safe(() => {
      this.fx?.stage.clear();
      this.fx?.ps.clear();
    });
  }

  /** What is alive right now, for checking that clear() leaves nothing behind. */
  stats(): { parts: number; bodies: number; layer: number; anims: number; timers: number } {
    const stage = this.fx?.stage.stats() ?? { layer: 0, anims: 0, timers: 0 };
    return { ...(this.fx?.ps.alive ?? { parts: 0, bodies: 0 }), ...stage };
  }

  /** Waits until the new view is in the DOM (chips and piles are measured), like the legacy call after render(). */
  private afterRender(run: () => void): void {
    let frame = 0;
    let timer = 0;
    const cancel = (): void => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      this.pending.delete(cancel);
    };
    const go = (): void => {
      cancel();
      run();
    };
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(go);
    });
    // Background tabs do not run animation frames.
    timer = window.setTimeout(go, 100);
    this.pending.add(cancel);
  }

  private ensure(): Fx | null {
    if (this.fx) return this.fx;
    if (!document.body) return null;
    this.styleEl = document.createElement('style');
    this.styleEl.id = 'fx-styles';
    this.styleEl.textContent = FX_STYLES;
    document.head.append(this.styleEl);
    const stage = new FxStage();
    const ps = new ParticleSystem(stage);
    this.fx = { stage, ps, clearAll: () => this.clear() };
    return this.fx;
  }

  private destroy(): void {
    this.clear();
    this.fx?.stage.destroy();
    this.fx = null;
    this.styleEl?.remove();
    this.styleEl = null;
  }
}
