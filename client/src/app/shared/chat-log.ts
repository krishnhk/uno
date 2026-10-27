import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, inject, input, viewChild } from '@angular/core';
import { RoomPlayer } from '../core/models';
import { RoomStore } from '../core/room.store';
import { AvatarComponent } from './avatar';

/** The chat bubbles: other people's on the left with their avatar, yours on the right in yellow. */
@Component({
  selector: 'app-chat-log',
  imports: [AvatarComponent],
  template: `
    <div #log [id]="logId()" class="game-chat chat">
      @let v = store.view();
      @if (v && v.chat.length) {
        @for (m of v.chat; track $index) {
          @let from = sender(m.from);
          @let mine = from?.id === v.youId;
          <div class="chat-msg" [class.mine]="mine">
            @if (!mine) {
              <div app-avatar class="chat-avatar" [name]="m.from" [avatar]="from?.avatar ?? null"></div>
            }
            <div class="chat-bubble">
              @if (!mine) {
                <span class="chat-name">{{ m.from }}</span>
              }
              <span class="chat-text">{{ m.text }}</span>
              <time class="chat-time">{{ time(m.at) }}</time>
            </div>
          </div>
        }
      } @else {
        <p class="chat-empty">No messages yet. Say hi! 👋</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ChatLogComponent {
  protected readonly store = inject(RoomStore);
  readonly logId = input.required<string>();
  private readonly log = viewChild.required<ElementRef<HTMLElement>>('log');

  constructor() {
    // Stay scrolled to the newest message after every update.
    afterRenderEffect(() => {
      this.store.view();
      const el = this.log().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  protected sender(name: string): RoomPlayer | undefined {
    return this.store.players().find((p) => p.name === name);
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
