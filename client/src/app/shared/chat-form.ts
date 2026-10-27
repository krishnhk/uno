import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { RoomStore } from '../core/room.store';

/** The chat input and send button; used by the lobby chat and the in-game chat panel. */
@Component({
  selector: 'app-chat-form',
  template: `
    <form [id]="formId()" class="game-chat-form" (submit)="send($event, box)">
      <input
        #box
        [id]="inputId()"
        aria-label="Chat message"
        maxlength="200"
        [placeholder]="placeholder()"
        autocomplete="off"
      />
      <button type="submit" class="send-btn" aria-label="Send">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12l18-8-7 17-3-7z"></path></svg>
      </button>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ChatFormComponent {
  private readonly store = inject(RoomStore);
  readonly formId = input.required<string>();
  readonly inputId = input.required<string>();
  /** The lobby and the game chat word their hint differently; by default it follows the form id. */
  readonly placeholderText = input<string | undefined>(undefined, { alias: 'placeholder' });
  protected readonly placeholder = computed(
    () => this.placeholderText() ?? (this.formId() === 'chat-form' ? 'Say something nice' : 'Type a message…'),
  );

  protected async send(event: Event, box: HTMLInputElement): Promise<void> {
    event.preventDefault();
    const text = box.value.trim();
    if (!text) return;
    box.value = '';
    await this.store.action('chat', { text });
  }
}
