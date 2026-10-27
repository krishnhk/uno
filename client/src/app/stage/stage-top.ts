import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, signal } from '@angular/core';
import { MODE_LABEL } from '../core/cards';
import { RoomStore } from '../core/room.store';
import { GamePanel, UiService } from '../core/ui.service';
import { CallButtonsComponent } from '../call/call-buttons';

/** The bar across the top of the table: room code, who is still playing, and the call / log / chat / leave buttons. */
@Component({
  selector: 'app-stage-top',
  imports: [CallButtonsComponent],
  template: `
    <div class="stage-top">
      <div class="stage-info">
        <span class="logo small">UNO</span>
        <span class="stage-room"><span class="stage-room-label">Room</span><strong id="stage-code">{{ store.view()?.code }}</strong></span>
        <span id="stage-status">{{ status() }}</span>
      </div>
      <div class="stage-buttons">
        <div id="stage-call" class="call-controls"><app-call-buttons /></div>
        <button id="log-toggle" type="button" aria-controls="game-log-panel" [class.active]="ui.openPanel() === 'log'"
          [attr.aria-pressed]="ui.openPanel() === 'log'" (click)="toggle('log')">📜 Log</button>
        <button id="chat-toggle" type="button" aria-controls="game-chat-panel" [class.active]="ui.openPanel() === 'chat'"
          [attr.aria-pressed]="ui.openPanel() === 'chat'" (click)="toggle('chat')">💬 Chat <span id="chat-unread" class="unread" [hidden]="unread() === 0">{{ unread() }}</span></button>
        <button id="stage-leave" type="button" class="danger" (click)="leave()">Leave</button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class StageTopComponent {
  protected readonly store = inject(RoomStore);
  protected readonly ui = inject(UiService);

  /** Chat messages after this time count as unread while the chat panel is closed. */
  private readonly chatSeenAt = signal(Date.now());

  protected readonly status = computed(() => {
    const game = this.store.game();
    if (!game) return '';
    const label = MODE_LABEL[game.mode];
    const stillIn = game.players.filter((p) => p.place == null).length;
    return label ? `${label} · ${stillIn} of ${game.players.length} still playing` : `${game.players.length} players`;
  });

  protected readonly unread = computed(() => {
    const seenAt = this.chatSeenAt();
    return this.store.view()?.chat.filter((m) => m.at > seenAt).length ?? 0;
  });

  constructor() {
    // Messages count as read when you can see them: in the lobby, or with the in-game chat open.
    effect(() => {
      this.store.view();
      if (!this.store.playing() || this.ui.openPanel() === 'chat') this.chatSeenAt.set(Date.now());
    });
  }

  protected toggle(panel: GamePanel): void {
    this.ui.openPanel.update((open) => (open === panel ? null : panel));
  }

  protected leave(): void {
    if (window.confirm('Leave this game? Your seat stays and the timer plays your turns.')) void this.store.leaveRoom();
  }
}
