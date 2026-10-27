import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, untracked } from '@angular/core';
import { MODE_LABEL, compareCards, ordinal } from '../core/cards';
import { Card, ResultRow } from '../core/models';
import { RoomStore } from '../core/room.store';
import { UiService } from '../core/ui.service';
import { FxService } from '../fx/fx.service';
import { AvatarComponent } from '../shared/avatar';
import { CardComponent } from '../shared/card';

const cardsText = (n: number): string => `${n} card${n === 1 ? '' : 's'}`;

/** The final scorecard: podium, standings with the leftover cards, and what to do next. */
@Component({
  selector: 'app-results-dialog',
  imports: [AvatarComponent, CardComponent],
  template: `
    <div id="results-dialog" class="dialog" [hidden]="!result()" (click)="onBackdrop($event)">
      @if (result(); as r) {
        <div class="dialog-box festive results-box" role="dialog" aria-labelledby="results-title">
          <header class="results-bar">
            <span class="logo" aria-hidden="true">UNO</span>
            <div class="results-bar-text"><strong>Game over</strong><small>Final scorecard for this round</small></div>
            <span class="results-mode-chip"><small>Game end</small><b id="results-mode" class="results-mode">{{ modeLabel() }}</b></span>
            <button id="results-close" type="button" class="game-panel-close results-close" aria-label="Close the scorecard" data-tip="Back to the room" (click)="close()">✕</button>
          </header>
          <div class="results-body">
            <section class="results-podium-panel">
              <h2 id="results-title">{{ title() }}</h2>
              <div class="results-trophy" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M18 8h28v16a14 14 0 0 1-28 0z" fill="#f4c20d"></path><path d="M18 12H8c0 9 4 14 11 15M46 12h10c0 9-4 14-11 15" stroke="#f4c20d" stroke-width="3.5" stroke-linecap="round"></path><path d="M32 38v10M22 56h20M25 48h14v8H25z" stroke="#f4c20d" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="#f4c20d"></path><path d="M24 12v10" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"></path></svg></div>
              <div id="results-podium" class="podium">
                @for (row of podium(); track row.id) {
                  <div class="podium-spot" [class]="'podium-spot place-' + row.place">
                    <div app-avatar class="podium-avatar" [name]="row.name" [avatar]="store.avatarOf(row.id)"></div>
                    <div class="podium-block">
                      <span class="podium-name">{{ row.name }}</span>
                      <span class="podium-pts">+{{ row.score }} pts</span>
                      <span class="podium-place">{{ row.place }}</span>
                    </div>
                  </div>
                }
              </div>
            </section>
            <section class="results-standings" aria-labelledby="standings-title">
              <h3 id="standings-title">Final standings</h3>
              <ol id="results-list" class="results-list">
                @for (row of r.ranking; track row.id) {
                  @let isMe = row.id === store.youId();
                  @let isLoser = r.mode === 'last' && row.cardsLeft > 0;
                  <li class="result-row" [class]="'result-row place-' + row.place + (isMe ? ' me' : '') + (isLoser ? ' loser' : '')">
                    <span class="result-place">{{ row.place }}</span>
                    <!-- Their current avatar (initials if they have left the room since). -->
                    <div app-avatar class="result-avatar" [name]="row.name" [avatar]="store.avatarOf(row.id)"></div>
                    <span class="result-who">
                      <span class="result-name">{{ isMe ? row.name + ' (you)' : row.name }}</span>
                      <span class="result-detail">{{ detail(r.mode, row) }}</span>
                      @if (row.hand.length) {
                        <div class="reveal-row" style="--reveal-cw:24px">
                          @for (card of revealed(row.hand); track card.id; let i = $index) {
                            <div app-card [card]="card" [style.--i]="i"></div>
                          }
                        </div>
                      }
                    </span>
                    @if (isLoser) {
                      <span class="result-tag">Loser</span>
                    }
                    <span class="result-score">+{{ row.score }}</span>
                  </li>
                }
              </ol>
            </section>
          </div>
          <!-- Leave on the left; the host starts the next game, everyone else waits -->
          <div id="results-actions" class="results-actions">
            <button type="button" class="btn-chunky results-leave" (click)="leave()">Leave room</button>
            @if (store.isHost()) {
              @if (!enoughPlayers()) {
                <p class="results-wait">Waiting for at least one more player to join.</p>
              }
              <button type="button" class="btn-chunky yellow" [disabled]="!enoughPlayers()" (click)="playAgain()">Start new game</button>
            } @else {
              <p class="results-wait">
                <span class="wait-dots" aria-hidden="true"><i></i><i></i><i></i></span>Waiting for {{ hostName() }} to start a new game…
              </p>
            }
          </div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { '(window:keydown.escape)': 'close()' },
})
export class ResultsDialogComponent {
  protected readonly store = inject(RoomStore);
  private readonly ui = inject(UiService);
  private readonly fx = inject(FxService);

  protected readonly result = this.ui.results;
  protected readonly modeLabel = computed(() => MODE_LABEL[this.result()?.mode ?? 'last']);
  /** The podium: 2nd, 1st, 3rd from left to right, each on a block as tall as their place. */
  protected readonly podium = computed(() => {
    const ranking = this.result()?.ranking ?? [];
    return [ranking[1], ranking[0], ranking[2]].filter((row): row is ResultRow => !!row);
  });
  protected readonly title = computed(() => {
    const result = this.result();
    if (!result) return '';
    const me = result.ranking.find((r) => r.id === this.store.youId());
    if (!me) return `${result.winnerName} wins!`;
    if (me.place === 1) return 'You win! 🎉';
    if (result.mode === 'last' && me.cardsLeft > 0) return 'Left holding cards!';
    return `You finished ${ordinal(me.place)}`;
  });
  protected readonly enoughPlayers = computed(() => this.store.players().length >= 2);
  protected readonly hostName = computed(() => this.store.players().find((p) => p.id === this.store.view()?.hostId)?.name ?? 'the host');

  private wasPlaying = false;

  constructor() {
    effect(() => {
      const playing = this.store.playing();
      const inRoom = this.store.inRoom();
      const lastResult = this.store.view()?.lastResult ?? null;
      untracked(() => {
        // The game just ended: show the final ranking over the lobby.
        if (this.wasPlaying && !playing && lastResult) this.ui.results.set(lastResult);
        // The scorecard closes when you leave or when the host starts the next game.
        if (!inRoom || playing) this.ui.results.set(null);
        this.wasPlaying = playing;
      });
    });
    // The "You win!" banner and confetti are done by now: clear them so they never sit over the scorecard.
    effect(() => {
      if (this.ui.results()) untracked(() => this.fx.clear());
    });
  }

  protected detail(mode: string, row: ResultRow): string {
    if (row.cardsLeft === 0) return mode === 'first' ? 'Went out first' : `Finished ${ordinal(row.place)}`;
    if (mode === 'last') return `Left holding ${cardsText(row.cardsLeft)} (${row.handPoints} pts)`;
    return `${cardsText(row.cardsLeft)} left · ${row.handPoints} pts in hand`;
  }

  protected revealed(hand: Card[]): Card[] {
    return [...hand].sort(compareCards).slice(0, 14);
  }

  /** Closing the scorecard leaves you in the room to wait for players; "View results" brings it back. */
  protected close(): void {
    this.ui.results.set(null);
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  protected leave(): void {
    void this.store.leaveRoom();
  }

  protected playAgain(): void {
    void this.store.action('play_again');
  }
}
