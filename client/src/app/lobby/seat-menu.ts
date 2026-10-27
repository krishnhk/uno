import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterRenderEffect, inject, viewChild } from '@angular/core';
import { RoomStore } from '../core/room.store';
import { UiService } from '../core/ui.service';
import { AvatarComponent } from '../shared/avatar';

/** The host's right-click (or long-press) menu on another player's seat: Make host / Remove from room. */
@Component({
  selector: 'app-seat-menu',
  imports: [AvatarComponent],
  template: `
    <div #menu id="seat-menu" class="seat-menu" role="menu" [hidden]="!ui.seatMenu()">
      @if (ui.seatMenu(); as m) {
        <div class="seat-menu-head">
          <div app-avatar class="chat-avatar" [name]="m.player.name" [avatar]="m.player.avatar"></div>
          <strong>{{ m.player.name }}</strong>
        </div>
        <button type="button" role="menuitem" class="seat-menu-item" (click)="run('transfer_host')">👑 Make host</button>
        <button type="button" role="menuitem" class="seat-menu-item danger" (click)="run('kick_player')">✕ Remove from room</button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class SeatMenuComponent {
  protected readonly ui = inject(UiService);
  private readonly store = inject(RoomStore);
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');

  constructor() {
    // Once the menu is drawn, keep it on screen and focus its first item.
    afterRenderEffect(() => {
      const open = this.ui.seatMenu();
      if (!open) return;
      const menu = this.menu().nativeElement;
      const left = Math.min(open.x, window.innerWidth - menu.offsetWidth - 8);
      const top = Math.min(open.y, window.innerHeight - menu.offsetHeight - 8);
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${Math.max(8, top)}px`;
      menu.querySelector<HTMLElement>('.seat-menu-item')?.focus();
    });

    const close = () => this.ui.seatMenu.set(null);
    const onPointerDown = (event: Event) => {
      if (this.ui.seatMenu() && !(event.target as Element).closest?.('#seat-menu')) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    });
  }

  protected run(event: 'transfer_host' | 'kick_player'): void {
    const player = this.ui.seatMenu()?.player;
    this.ui.seatMenu.set(null);
    if (player) void this.store.action(event, { playerId: player.id });
  }
}
