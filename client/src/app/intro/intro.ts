import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, inject, signal } from '@angular/core';
import { RoomStore } from '../core/room.store';

const INTRO_MS = 2900;

/** The opening animation: cards fly in, the logo pops, then the home screen slides in. */
@Component({
  selector: 'app-intro',
  template: `
    @if (shown()) {
      <div id="intro" class="intro" [class.done]="done()" aria-hidden="true">
        <div class="intro-rays"></div>
        <div class="intro-cards">
          <div class="card c-red ic1"><span class="corner">7</span><span class="center">7</span><span class="corner br">7</span></div>
          <div class="card c-yellow ic2"><span class="corner">⊘</span><span class="center">⊘</span><span class="corner br">⊘</span></div>
          <div class="card c-wild ic3"><span class="corner">+4</span><span class="center">+4</span><span class="corner br">+4</span></div>
          <div class="card c-green ic4"><span class="corner">⇄</span><span class="center">⇄</span><span class="corner br">⇄</span></div>
          <div class="card c-blue ic5"><span class="corner">+2</span><span class="center">+2</span><span class="corner br">+2</span></div>
        </div>
        <div class="intro-burst"></div>
        <div class="intro-logo">UNO</div>
        <p class="intro-tag">Get ready to play!</p>
      </div>
    }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class IntroComponent {
  private readonly store = inject(RoomStore);

  protected readonly shown = signal(false);
  protected readonly done = signal(false);

  constructor() {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const body = document.body.classList;
    inject(DestroyRef).onDestroy(() => {
      timers.forEach(clearTimeout);
      body.remove('intro-playing');
    });

    // Skipped when rejoining a room or when motion is reduced.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.store.session() || reduceMotion) return;

    this.shown.set(true);
    body.add('intro-playing');
    timers.push(setTimeout(() => {
      this.done.set(true);
      body.remove('intro-playing');
      body.add('home-enter');
      timers.push(setTimeout(() => this.shown.set(false), 600));
      // Put the cursor in the name box once it has slid in (not on touch screens, where it would pop up the keyboard).
      if (!this.store.name() && window.matchMedia('(pointer: fine)').matches) {
        timers.push(setTimeout(() => document.getElementById('name')?.focus({ preventScroll: true }), 700));
      }
    }, INTRO_MS));
  }
}
