import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterRenderEffect, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { CardBackComponent, CardComponent } from '../shared/card';
import { ChatFormComponent } from '../shared/chat-form';
import { ChatLogComponent } from '../shared/chat-log';
import { LogEntry } from '../core/models';
import { RoomStore } from '../core/room.store';
import { GamePanel, UiService } from '../core/ui.service';

/** Panels slide in and out over this long; the table, videos and hand move over at the same pace. */
const SLIDE_MS = 260;
const PANELS: GamePanel[] = ['log', 'chat'];
const CHOSEN_COLOR = /chose (red|yellow|green|blue)/;

/** The Log and Chat panels docked on the right of the table; one is open at a time (UiService.openPanel). */
@Component({
  selector: 'app-game-panels',
  imports: [CardComponent, CardBackComponent, ChatLogComponent, ChatFormComponent],
  template: `
    <section id="game-log-panel" class="game-panel" aria-labelledby="game-log-title" [hidden]="!visible().log" [class.closing]="closing().log">
      <header class="game-panel-head">
        <span class="game-panel-icon" aria-hidden="true">📜</span>
        <h2 id="game-log-title">Game log</h2>
        <button type="button" class="game-panel-close" data-close-panel aria-label="Close the game log" (click)="close()">✕</button>
      </header>
      <ol id="game-log" class="game-log" #gameLog>
        @for (entry of entries(); track entry.n) {
          @let chosen = chosenColor(entry);
          <li [class.has-pic]="!!entry.card || entry.drew > 0">
            @if (entry.card; as card) {
              <span class="log-pic" [class.chosen]="!!chosen"><div app-card [card]="card" [style.--chosen]="chosen ? 'var(--' + chosen + ')' : null"></div></span>
            } @else if (entry.drew) {
              <span class="log-pic drew"><div app-card-back></div>@if (entry.drew > 1) {<b class="log-count">+{{ entry.drew }}</b>}</span>
            }
            <span class="log-text">{{ entry.text }}</span>
          </li>
        }
      </ol>
    </section>

    <section id="game-chat-panel" class="game-panel" aria-labelledby="game-chat-title" [hidden]="!visible().chat" [class.closing]="closing().chat">
      <header class="game-panel-head">
        <span class="game-panel-icon" aria-hidden="true">💬</span>
        <h2 id="game-chat-title">Chat</h2>
        <button type="button" class="game-panel-close" data-close-panel aria-label="Close the chat" (click)="close()">✕</button>
      </header>
      <app-chat-log logId="game-chat-log" />
      <app-chat-form formId="game-chat-form" inputId="game-chat-input" />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { '(window:keydown.escape)': 'close()' },
})
export class GamePanelsComponent {
  private readonly store = inject(RoomStore);
  private readonly ui = inject(UiService);
  private readonly gameLog = viewChild.required<ElementRef<HTMLElement>>('gameLog');
  private readonly timers: Partial<Record<GamePanel, ReturnType<typeof setTimeout>>> = {};

  /** Not hidden (this includes the panel while it slides out). */
  protected readonly visible = signal({ log: false, chat: false });
  protected readonly closing = signal({ log: false, chat: false });
  protected readonly entries = (): LogEntry[] => this.store.game()?.log ?? [];

  constructor() {
    inject(DestroyRef).onDestroy(() => PANELS.forEach((p) => clearTimeout(this.timers[p])));

    effect(() => {
      const open = this.ui.openPanel();
      untracked(() => this.sync(open));
    });
    // The game ended: the panels go away with the table.
    effect(() => {
      if (!this.store.playing()) this.ui.openPanel.set(null);
    });
    afterRenderEffect(() => {
      this.entries();
      this.visible();
      const el = this.gameLog().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
    afterRenderEffect(() => {
      // Without preventScroll the browser scrolls the whole game sideways to reach the box while the panel slides in.
      if (this.ui.openPanel() === 'chat') document.getElementById('game-chat-input')?.focus({ preventScroll: true });
    });
  }

  protected close(): void {
    this.ui.openPanel.set(null);
  }

  protected chosenColor(entry: LogEntry): string | undefined {
    return entry.card?.color === 'wild' ? entry.text.match(CHOSEN_COLOR)?.[1] : undefined;
  }

  private sync(open: GamePanel | null): void {
    for (const name of PANELS) {
      clearTimeout(this.timers[name]);
      if (name === open) {
        this.visible.update((v) => ({ ...v, [name]: true }));
        this.closing.update((c) => ({ ...c, [name]: false }));
      } else if (this.visible()[name] && !this.closing()[name]) {
        if (!this.store.playing()) {
          this.visible.update((v) => ({ ...v, [name]: false })); // nothing on screen to animate
          continue;
        }
        this.closing.update((c) => ({ ...c, [name]: true }));
        this.timers[name] = setTimeout(() => {
          this.visible.update((v) => ({ ...v, [name]: false }));
          this.closing.update((c) => ({ ...c, [name]: false }));
        }, SLIDE_MS);
      }
    }
  }
}
