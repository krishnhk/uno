import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, untracked } from '@angular/core';
import { COLOR_LABEL, mostHeldColor } from '../core/cards';
import { ClockService } from '../core/clock.service';
import { PlayColor } from '../core/models';
import { RoomStore } from '../core/room.store';
import { UiService } from '../core/ui.service';

/** If no colour has been picked this close to the end of the turn, the wheel picks one so the Wild still gets played. */
const AUTO_PICK_MS = 700;

/** The Wild colour picker: a wheel like the oval on a Wild card, with the turn countdown and the colour it picks if time runs out. */
@Component({
  selector: 'app-color-dialog',
  template: `
    <div id="color-dialog" class="dialog" [hidden]="!choosing()">
      <div class="dialog-box festive color-box" role="dialog" aria-labelledby="color-title">
        <h2 id="color-title" class="color-title">Choose a <b>colour</b></h2>
        <p class="color-sub">Your Wild card is on the table. What colour should come next?</p>
        <div class="color-wheel">
          <button type="button" data-color="green" class="wedge wedge-green" aria-label="Green" (click)="choose('green')"><span>Green</span></button>
          <button type="button" data-color="red" class="wedge wedge-red" aria-label="Red" (click)="choose('red')"><span>Red</span></button>
          <button type="button" data-color="yellow" class="wedge wedge-yellow" aria-label="Yellow" (click)="choose('yellow')"><span>Yellow</span></button>
          <button type="button" data-color="blue" class="wedge wedge-blue" aria-label="Blue" (click)="choose('blue')"><span>Blue</span></button>
          <div class="wheel-hub" aria-hidden="true">WILD</div>
        </div>
        <p id="color-timer" class="color-timer" [class.urgent]="urgent()" aria-live="polite">{{ timerText() }}</p>
        <div class="color-bar" aria-hidden="true"><i id="color-bar-fill" [style.width.%]="barWidth()"></i></div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ColorDialogComponent {
  private readonly store = inject(RoomStore);
  private readonly ui = inject(UiService);
  private readonly clock = inject(ClockService);

  protected readonly choosing = computed(() => this.ui.pendingWildId() !== null);
  private readonly autoColor = computed(() => mostHeldColor(this.store.game()?.hand ?? [], this.ui.pendingWildId()));
  private readonly timed = computed(() => this.choosing() && this.clock.live());
  protected readonly timerText = computed(() =>
    this.timed() ? `${this.clock.seconds()}s left, else ${COLOR_LABEL[this.autoColor()]}` : '');
  protected readonly urgent = computed(() => this.timed() && this.clock.seconds() <= 3);
  protected readonly barWidth = computed(() => (this.timed() ? Math.min(100, this.clock.fraction() * 100) : 0));

  constructor() {
    // The turn moved on while the wheel was open: close it.
    effect(() => {
      if (this.ui.pendingWildId() && !this.store.myTurn()) this.ui.pendingWildId.set(null);
    });
    effect(() => {
      if (this.timed() && this.clock.remainingMs() <= AUTO_PICK_MS) untracked(() => this.choose(this.autoColor()));
    });
  }

  protected choose(color: PlayColor): void {
    const cardId = this.ui.pendingWildId();
    this.ui.pendingWildId.set(null);
    if (cardId) void this.store.action('play_card', { cardId, color });
  }
}
