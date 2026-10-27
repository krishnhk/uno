import {
  ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, inject, viewChild,
} from '@angular/core';
import { THROWABLES, ThrowItem, ThrowService } from './throw.service';

/** The small menu next to a player with a tomato, an egg and a heart to throw at them. */
@Component({
  selector: 'app-throw-menu',
  template: `
    <div #menu id="throw-menu" class="throw-menu" role="dialog" [attr.aria-label]="label()" [hidden]="!throws.menu()">
      <div id="throw-options" class="throw-options">
        @for (item of items; track item.key) {
          <button type="button" class="throw-option" [attr.aria-label]="'Throw a ' + item.label.toLowerCase() + ' at ' + throws.menu()?.name"
                  [attr.data-tip]="item.label" (click)="throws.throwAt(item.key)">
            <span class="throw-emoji" aria-hidden="true">{{ item.emoji }}</span>
          </button>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ThrowMenuComponent {
  protected readonly throws = inject(ThrowService);
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');

  protected readonly items = (Object.entries(THROWABLES) as [ThrowItem, (typeof THROWABLES)[ThrowItem]][])
    .map(([key, { emoji, label }]) => ({ key, emoji, label }));

  protected label(): string {
    const state = this.throws.menu();
    return state ? `Throw something at ${state.name}` : 'Throw something';
  }

  constructor() {
    afterRenderEffect(() => {
      const state = this.throws.menu();
      if (!state) return;
      const menu = this.menu().nativeElement;
      // By the player's avatar at the table (even when you clicked their video, where the splat lands),
      // clear of it: below, or above if there's no room.
      const avatar = document.querySelector(`#opponents [data-player="${state.playerId}"] .pb-avatar`) ?? this.throws.seatSpot(state.playerId);
      const seat = avatar?.getBoundingClientRect() ?? { left: state.x, right: state.x, top: state.y, bottom: state.y };
      const cx = (seat.left + seat.right) / 2;
      const cy = (seat.top + seat.bottom) / 2;
      const clearance = Math.max(70, (seat.bottom - seat.top) * 0.75);
      const below = cy + clearance;
      const top = below + menu.offsetHeight > window.innerHeight - 8 ? cy - clearance - menu.offsetHeight : below;
      const left = Math.min(Math.max(8, cx - menu.offsetWidth / 2), window.innerWidth - menu.offsetWidth - 8);
      menu.style.left = `${left}px`;
      menu.style.top = `${Math.max(8, top)}px`;
      menu.querySelector('button')?.focus();
    });
  }
}
