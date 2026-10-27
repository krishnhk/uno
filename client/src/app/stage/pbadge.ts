import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { placeLabel } from '../core/cards';
import { ClockService } from '../core/clock.service';
import { AvatarComponent } from '../shared/avatar';
import { PlayerInfo } from './layout';

/**
 * A player's badge: avatar ring (which sweeps down while it is their turn), name, and card count.
 * An attribute component so the `.pbadge` element itself sits where the shared CSS expects it:
 *   <div app-pbadge [info]="info" [large]="true"></div>
 */
@Component({
  selector: '[app-pbadge]',
  imports: [AvatarComponent],
  template: `
    <div class="pb-ring" [style.--p]="info().turn ? clock.fraction() : null">
      @if (large() && info().isMe) {
        <button type="button" app-avatar class="pb-avatar" [name]="info().name" [avatar]="info().avatar" [editable]="true"></button>
      } @else {
        <div app-avatar class="pb-avatar" [name]="info().name" [avatar]="info().avatar" [playerId]="video() ? info().id : null"></div>
      }
      @if (info().isHost) {<span class="host-tag" data-tip="Host">★</span>}
    </div>
    <div class="pb-body">
      <div class="pb-name" [attr.data-tip]="info().name">{{ info().name }}@if (info().isMe) {<span class="pb-you">you</span>}</div>
      <div class="pb-stats">
        @if (finished()) {
          <span class="pb-place" data-tip="Finished">{{ place() }}</span>
        } @else {
          <span class="pb-count" data-tip="Cards in hand" [attr.aria-label]="info().cardCount + ' cards in hand'"><span class="pb-count-card" aria-hidden="true"></span><b>{{ info().cardCount }}</b><span class="pb-count-word">{{ info().cardCount === 1 ? 'card' : 'cards' }}</span></span>
        }
        @if (!info().connected) {<span class="pb-away">away</span>}
      </div>
    </div>
    @if (info().uno) {<span class="bubble">UNO!</span>}
  `,
  host: { '[class]': 'classes()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class PlayerBadgeComponent {
  readonly info = input.required<PlayerInfo>();
  readonly large = input(false);
  readonly vertical = input(false);
  /** Show the player's live video in the avatar (only when the videos are not in the side columns). */
  readonly video = input(false);

  protected readonly clock = inject(ClockService);
  protected readonly finished = computed(() => this.info().place !== null);
  protected readonly place = computed(() => placeLabel(this.info().place ?? 0));
  protected readonly classes = computed(() => {
    const info = this.info();
    return ['pbadge', this.large() ? 'large' : '', this.vertical() ? 'vertical' : '', info.turn ? 'turn' : '',
      this.finished() ? 'finished' : '', info.connected ? '' : 'away'].filter(Boolean).join(' ');
  });
}
