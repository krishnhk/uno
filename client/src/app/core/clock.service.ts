import { Injectable, computed, inject, signal } from '@angular/core';
import { RoomStore } from './room.store';

/** The turn countdown, shared by everything that shows it (the timer chip, the chip rings, the colour picker). */
@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly store = inject(RoomStore);
  /** Ticks while a game is on, so computed values below refresh. */
  private readonly now = signal(Date.now());

  /** A turn is being timed. */
  readonly live = computed(() => !!this.store.view()?.turnDeadline && !!this.store.game()?.roundActive);

  /**
   * Time left in this turn. While drawn cards are still flying to a hand the deadline is further away than a
   * full turn: the clock then shows the full time and only starts counting once they have landed.
   */
  readonly remainingMs = computed(() => {
    const view = this.store.view();
    if (!this.live() || !view) return 0;
    return Math.min(view.settings.turnSeconds * 1000, Math.max(0, (view.turnDeadline ?? 0) - this.now()));
  });
  readonly seconds = computed(() => Math.ceil(this.remainingMs() / 1000));
  /** 1 at the start of the turn down to 0 at the end. */
  readonly fraction = computed(() => {
    const view = this.store.view();
    return this.live() && view ? this.remainingMs() / (view.settings.turnSeconds * 1000) : 1;
  });

  constructor() {
    setInterval(() => this.now.set(Date.now()), 200);
  }
}
