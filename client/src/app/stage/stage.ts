import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, EnvironmentInjector, Injector, ViewEncapsulation,
  afterNextRender, afterRenderEffect, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CallService } from '../call/call.service';
import { VideoRailsComponent } from '../call/video-rails';
import { COLOR_LABEL, TRAIL_LENGTH, compareCards, describe, hashString, placeLabel } from '../core/cards';
import { ClockService } from '../core/clock.service';
import { Card, GamePlayer, GameView } from '../core/models';
import { RoomStore } from '../core/room.store';
import { StageLayoutService } from '../core/stage-layout.service';
import { UiService } from '../core/ui.service';
import { AvatarComponent } from '../shared/avatar';
import { CardBackComponent, CardComponent } from '../shared/card';
import { ThrowMenuComponent } from '../throw/throw-menu';
import { ThrowService } from '../throw/throw.service';
import { StageFlights, TrailEntry } from './flights';
import { GamePanelsComponent } from './game-panels';
import { PlayerInfo, columnSeats, compactSeats, computeLayout, ringSeats } from './layout';
import { PlayerBadgeComponent } from './pbadge';
import { StageTopComponent } from './stage-top';

// Panels slide in and out over SLIDE_MS; the seats slide to their new places at the same pace.
const SLIDE_MS = 260;
const SLIDE_EASE = 'cubic-bezier(0.22, 0.8, 0.3, 1)';
// When it's your turn and you have nothing to play, the game draws for you after a moment.
const AUTO_DRAW_MS = 900;

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** A Draw Two / Wild Draw Four aimed at you can be answered by stacking one of your own of the same kind. */
function stackCardOf(game: GameView): Card | null {
  const pending = game.pending;
  return (pending && game.hand.find((c) => game.playableIds.includes(c.id) && c.value === pending.kind)) || null;
}

/** When it's your turn and you have nothing to play, the game draws for you. (A Wild Draw Four waits, since you may challenge.) */
function needsAutoDraw(game: GameView | null, myTurn: boolean): boolean {
  return !!game && myTurn && game.playableIds.length === 0 && !game.drawnCardId && !game.challengeable;
}

/** The game table: the other players, the deck and discard pile, your hand and the prompts. */
@Component({
  selector: 'app-stage',
  imports: [
    NgTemplateOutlet, AvatarComponent, CardComponent, CardBackComponent, PlayerBadgeComponent,
    StageTopComponent, GamePanelsComponent, VideoRailsComponent, ThrowMenuComponent,
  ],
  template: `
    <div id="stage" #stage class="stage" [hidden]="!store.playing()" [class.my-turn]="store.myTurn()"
      [class.column-layout]="layout().columns" [class.panel-docked]="layout().panelW > 0" [class.with-rails]="layout().rails"
      [attr.data-color]="color()" [style.--panel-w]="layout().panelW + 'px'" [style.--rail-w]="layout().railW + 'px'"
      [style.--table-x]="layout().columns ? layout().center.x + 'px' : null" [style.--table-y]="layout().columns ? layout().center.y + 'px' : null"
      [style.--table-w]="layout().columns ? layout().table.rx * 2 + 'px' : null" [style.--table-h]="layout().columns ? layout().table.ry * 2 + 'px' : null"
      [style.--hand-w]="layout().columns ? layout().handW + 'px' : null" [style.--ring]="layout().columns ? layout().ring + 'px' : null">
      <!-- Direction ring: lies tilted on the table, spins with the play direction, takes the current color -->
      <div id="swirl" class="swirl-wrap" aria-hidden="true" [class.ccw]="direction() === -1" [attr.data-color]="color()"
        [style.left.px]="layout().center.x" [style.top.px]="layout().center.y" [style.width.px]="layout().swirl" [style.height.px]="layout().swirl">
        <svg class="swirl" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="swirl-shade" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" class="swirl-stop-light" />
              <stop offset="0.5" class="swirl-stop-main" />
              <stop offset="1" class="swirl-stop-dark" />
            </linearGradient>
          </defs>
          <!-- Two arcs of radius 44, each ending in an arrowhead that points along the circle (clockwise) -->
          <g class="arrows" fill="none" stroke-linecap="round">
            <path d="M 7.50 38.61 A 44 44 0 0 1 88.11 28.00" stroke="url(#swirl-shade)" stroke-width="3.2" />
            <path d="M 92.50 61.39 A 44 44 0 0 1 11.89 72.00" stroke="url(#swirl-shade)" stroke-width="3.2" />
            <path class="swirl-gloss" d="M 7.50 38.61 A 44 44 0 0 1 88.11 28.00" stroke-width="0.8" />
            <path class="swirl-gloss" d="M 92.50 61.39 A 44 44 0 0 1 11.89 72.00" stroke-width="0.8" />
            <polygon points="92.44,25.50 83.78,30.50 92.61,35.79" fill="url(#swirl-shade)" stroke="url(#swirl-shade)" stroke-width="1.2" stroke-linejoin="round" />
            <polygon points="7.56,74.50 16.22,69.50 7.39,64.21" fill="url(#swirl-shade)" stroke="url(#swirl-shade)" stroke-width="1.2" stroke-linejoin="round" />
          </g>
        </svg>
      </div>

      <app-stage-top />
      <app-game-panels />
      <app-video-rails />

      <div id="opponents" (click)="onOpponentsClick($event)">
        @if (layout().columns) {
          @for (s of columnSeatList(); track s.info.id) {
            <div class="opp-tile" [class.turn]="s.info.turn" [class.finished]="s.info.place !== null" [class.away]="!s.info.connected"
              [attr.data-player]="s.info.id" [attr.data-tip]="'Throw something at ' + s.info.name"
              [style.left.px]="s.x" [style.top.px]="s.y" [style.--seat-scale]="1" [style.--p]="s.info.turn ? clock.fraction() : null">
              <div app-avatar class="pb-avatar" [name]="s.info.name" [avatar]="s.info.avatar"></div>
              <span class="tile-text"><span class="tile-name">{{ s.info.name }}@if (s.info.isHost) {<span class="tile-host" aria-label="Host"></span>}</span>@if (s.info.place !== null) {<span class="tile-count">{{ placeText(s.info.place) }}</span>}</span>
              @if (s.info.muted) {<span class="tile-muted" aria-label="Microphone off">Muted</span>}
              @if (!s.info.connected) {<span class="tile-away">Away</span>}
              @if (s.info.uno) {<span class="bubble">UNO!</span>}
              @if (s.info.catchable) {<button type="button" class="catch" (click)="catchUno(s.info.id)">Catch!</button>}
              @if (s.info.turn) {<i class="tile-timer" aria-hidden="true"></i>}
            </div>
            @if (s.reveal) {
              <div class="reveal seat-fan" [attr.data-player]="s.info.id" [style.left.px]="s.x" [style.top.px]="s.fanY">
                <ng-container [ngTemplateOutlet]="revealRow" [ngTemplateOutletContext]="{ cards: s.reveal, width: s.cardWidth }" />
              </div>
            } @else if (s.fan; as fan) {
              <div class="fan opp-fan seat-fan packed" [attr.data-player]="s.info.id" [attr.data-tip]="fan.count + ' cards'"
                [style.--fan-cw]="fan.cardWidth + 'px'" [style.--fan-step]="fan.step + 'px'" [style.left.px]="s.x" [style.top.px]="s.fanY">
                @for (rot of fan.rots; track $index) {<div app-card-back [style.--rot]="rot + 'deg'"></div>}
              </div>
            }
          }
        } @else if (layout().compact) {
          @for (s of compactSeatList(); track s.info.id) {
            <div class="opp-compact" [attr.data-player]="s.info.id" [style.left.px]="s.x" [style.top.px]="s.y">
              <div app-pbadge [info]="s.info" [vertical]="true" [video]="!layout().rails"></div>
              @if (s.reveal) {
                <ng-container [ngTemplateOutlet]="revealRow" [ngTemplateOutletContext]="{ cards: s.reveal, width: s.revealWidth }" />
              } @else if (s.fan; as fan) {
                <div class="fan" [attr.data-tip]="fan.count + ' cards'" [style.--fan-cw]="fan.cardWidth + 'px'">
                  @for (rot of fan.rots; track $index) {<div app-card-back [style.--rot]="rot + 'deg'"></div>}
                </div>
              }
              @if (s.info.catchable) {<button type="button" class="catch" (click)="catchUno(s.info.id)">Catch!</button>}
            </div>
          }
        } @else {
          @for (s of ringSeatList(); track s.info.id) {
            @if (s.reveal) {
              <div class="reveal" [attr.data-player]="s.info.id" [style.left.px]="s.x" [style.top.px]="s.y">
                <ng-container [ngTemplateOutlet]="revealRow" [ngTemplateOutletContext]="{ cards: s.reveal, width: 38 }" />
              </div>
            } @else if (s.fan; as fan) {
              <!-- Turned to face the middle of the table, then tipped back in perspective so it lies on the table;
                   each card's UNO logo is turned back by the same amount so it reads upright from your seat. -->
              <div class="fan opp-fan" [attr.data-player]="s.info.id" [attr.data-tip]="fan.count + ' cards'" [style.--fan-cw]="fan.cardWidth + 'px'"
                [style.left.px]="s.x" [style.top.px]="s.y" [style.--counter]="90 - s.deg + 'deg'"
                [style.transform]="'translate(-50%,-50%) rotate(' + (s.deg - 90) + 'deg) perspective(190px) rotateX(58deg)'">
                @for (rot of fan.rots; track $index) {<div app-card-back [style.--rot]="rot + 'deg'"></div>}
              </div>
            }
            <div class="opp-badge" [attr.data-player]="s.info.id" [style.left.px]="s.badge.x" [style.top.px]="s.badge.y">
              <div app-pbadge [info]="s.info" [video]="!layout().rails"></div>
              @if (s.info.catchable) {<button type="button" class="catch" (click)="catchUno(s.info.id)">Catch!</button>}
            </div>
          }
        }
      </div>
      <app-throw-menu />

      <div id="stage-center" class="stage-center" [style.left.px]="layout().center.x" [style.top.px]="layout().center.y">
        @if (color(); as colour) {
          <div [class]="'colour-chip c-' + colour"><span class="colour-dot" aria-hidden="true"></span>Colour: {{ colourLabel(colour) }}</div>
        }
        <div class="piles">
          <div class="pile">
            @if (canDraw()) {
              <button type="button" class="deck can-draw" [attr.data-tip]="drawLabel()" [attr.aria-label]="drawLabel()" (click)="draw()">
                <div app-card-back class="deck-card d3"></div><div app-card-back class="deck-card d2"></div><div app-card-back class="deck-card d1"></div>
                <span class="deck-count">{{ drawLabel() }}</span>
              </button>
            } @else {
              <div class="deck" [attr.data-tip]="drawPileCount() + ' cards left'" [attr.aria-label]="'Deck, ' + drawPileCount() + ' cards left'">
                <div app-card-back class="deck-card d3"></div><div app-card-back class="deck-card d2"></div><div app-card-back class="deck-card d1"></div>
                <span class="deck-count">{{ drawPileCount() }}</span>
              </div>
            }
            <span class="pile-label">Deck</span>
          </div>
          <div class="pile">
            <div class="discard" [attr.data-tip]="topCardTip()">
              @for (entry of trail(); track entry.card.id) {
                <div app-card class="trail" [card]="entry.card" [attr.data-trail]="entry.card.id"
                  [class.incoming]="entry.card.id === flights.discardFlightId()"
                  [style.--t]="'translate(' + entry.dx + 'px, ' + entry.dy + 'px) rotate(' + entry.rot + 'deg)'"></div>
              }
            </div>
            <span class="pile-label">Discard</span>
          </div>
        </div>
        @if (pendingCount(); as count) {<div class="pending-chip">+{{ count }} waiting</div>}
        @for (text of announcement(); track text) {<div class="announce pop">{{ text }}</div>}
      </div>

      <div id="turn-banner" class="turn-banner" [class.mine]="store.myTurn()">
        <span id="turn-text">{{ turnText() }}</span>
        <span id="timer" class="timer" [style.--p]="clock.fraction()">{{ clock.live() ? clock.seconds() + 's' : '' }}</span>
      </div>

      <!-- After drawing a card that can be played: play it now, or keep it (either way the turn ends) -->
      <div id="drawn-prompt" class="drawn-prompt" role="dialog" aria-labelledby="drawn-title" [hidden]="!drawnCard() || !!ui.pendingWildId()">
        <span class="prompt-pill"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M6 11l6 6 6-6M5 21h14"></path></svg>FROM THE DECK</span>
        <p id="drawn-title" class="drawn-title">You drew a card you <b>can play!</b></p>
        <div id="drawn-card" class="drawn-card">@if (drawnCard(); as card) {<div app-card [card]="card"></div>}</div>
        <p id="drawn-note" class="drawn-note">{{ drawnNote() }}</p>
        <div class="drawn-actions">
          <button id="drawn-play" type="button" class="btn-chunky green" (click)="playDrawn()"><svg class="btn-icon-fill-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"></path></svg>Play it</button>
          <button id="drawn-keep" type="button" class="btn-chunky yellow" (click)="keep()">Keep it</button>
        </div>
      </div>
      <!-- A Draw Two / Wild Draw Four aimed at you that you can answer: take the cards, challenge, or stack -->
      <div id="pending-prompt" class="drawn-prompt pending-prompt" role="dialog" aria-labelledby="pending-title" [hidden]="!pendingPrompt() || !!ui.pendingWildId()">
        <p id="pending-title" class="drawn-title">
          @if (pendingPrompt(); as p) {
            @if (p.sender) {<div app-avatar class="pending-avatar" [name]="p.sender.name" [avatar]="store.avatarOf(p.sender.id)"></div>}
            <span><b>{{ p.from }}</b> hit you with a<br><b>{{ p.isFour ? 'Wild Draw Four!' : 'Draw Two!' }}</b></span>
          }
        </p>
        <div id="pending-card" class="drawn-card">@if (topCard(); as top) {<div app-card [card]="top"></div>}</div>
        <p id="pending-hint" class="pending-hint" [hidden]="!challengeable()">
          @if (pendingPrompt(); as p) {
            @if (challengeable()) {
              <span class="pending-question">Think {{ p.from }} has a @if (p.colour; as colour) {<b [class]="'colour-word c-' + colour">{{ colourLabel(colour).toLowerCase() }}</b>} @else {matching} card?</span>
              <span class="pending-stakes">
                <span class="stake-right">Right: {{ p.from }} draws {{ p.count }}</span>
                <span class="stake-wrong">Wrong: you draw {{ p.count + 2 }}</span>
              </span>
            }
          }
        </p>
        <div id="pending-actions" class="drawn-actions">
          @if (pendingPrompt(); as p) {
            <button type="button" class="btn-chunky yellow" (click)="draw()">Draw {{ p.count }}</button>
            @if (challengeable()) {<button type="button" class="btn-chunky blue" (click)="challenge()">Challenge</button>}
            @if (p.stackCard; as stack) {<button type="button" class="btn-chunky yellow" (click)="playCard(stack)">Stack {{ p.isFour ? '+4' : '+2' }}</button>}
          }
        </div>
      </div>
      <div id="self-video" class="self-video"></div>
      <div id="my-badge" class="my-badge"><div app-pbadge [info]="myInfo()" [large]="true" [video]="!layout().rails && !layout().columns"></div></div>
      <div id="hand" class="hand">
        @for (c of hand(); track c.card.id) {
          @if (c.playable) {
            <button type="button" app-card [card]="c.card" [playable]="true" [drawn]="c.drawn" [class.incoming]="flights.flyingIds().has(c.card.id)"
              [style.--rot]="c.rot + 'deg'" [style.--drop]="c.drop + 'px'" (click)="playCard(c.card)"></button>
          } @else {
            <div app-card [card]="c.card" [drawn]="c.drawn" [class.incoming]="flights.flyingIds().has(c.card.id)"
              [style.--rot]="c.rot + 'deg'" [style.--drop]="c.drop + 'px'"></div>
          }
        }
      </div>
      <div id="actions" class="actions">
        <!-- Too late once the next player has moved (missedUno): no button, the player has to draw. Drawing is done by clicking the glowing deck. -->
        @if (showUnoButton()) {<button type="button" class="uno-btn" (click)="callUno()">UNO!</button>}
      </div>
    </div>

    <!-- A player's leftover cards laid face up in a row, flipping over one after another -->
    <ng-template #revealRow let-cards="cards" let-width="width">
      <div class="reveal-row" [style.--reveal-cw]="width + 'px'">
        @for (card of cards; track card.id; let i = $index) {<div app-card [card]="card" [style.--i]="i"></div>}
      </div>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class StageComponent {
  protected readonly store = inject(RoomStore);
  protected readonly ui = inject(UiService);
  protected readonly clock = inject(ClockService);
  private readonly call = inject(CallService);
  private readonly stageLayout = inject(StageLayoutService);
  private readonly throwing = inject(ThrowService);
  private readonly injector = inject(Injector);
  private readonly stageEl = viewChild.required<ElementRef<HTMLElement>>('stage');

  protected readonly flights = new StageFlights(inject(EnvironmentInjector));

  // ---- layout ----
  private readonly size = signal({ w: 0, h: 0 }, { equal: (a, b) => a.w === b.w && a.h === b.h });
  protected readonly layout = computed(() =>
    computeLayout(this.size().w, this.size().h, this.ui.openPanel() !== null, this.call.active(), this.store.opponents().length));

  // ---- the game ----
  private readonly game = this.store.game;
  protected readonly color = computed(() => this.game()?.currentColor ?? '');
  protected readonly direction = computed(() => this.game()?.direction ?? 1);
  protected readonly topCard = computed(() => this.game()?.topCard ?? null);
  protected readonly drawPileCount = computed(() => this.game()?.drawPileCount ?? 0);
  protected readonly pendingCount = computed(() => this.game()?.pending?.count ?? 0);
  protected readonly challengeable = computed(() => !!this.game()?.challengeable);
  protected readonly topCardTip = computed(() => (this.topCard() ? describe(this.topCard()!) : ''));
  protected readonly colourLabel = (color: string): string => COLOR_LABEL[color as keyof typeof COLOR_LABEL];
  protected readonly placeText = placeLabel;

  /** The last few discards, each with a stable, slightly random angle so the pile looks tossed. */
  protected readonly trail = signal<TrailEntry[]>([]);
  private trailRound: number | null = null;
  private lastTurnPlayerId: string | null = null; // whose turn it was at the previous update (who just played)
  private playedBy: string | null = null;
  private wasPlaying = false;
  private animationsScheduled = false;

  private info(p: GamePlayer): PlayerInfo {
    const game = this.game()!;
    const player = this.store.players().find((q) => q.id === p.id);
    const youId = this.store.youId();
    return {
      id: p.id,
      name: p.name,
      avatar: player?.avatar ?? null,
      cardCount: p.cardCount,
      place: p.place ?? null,
      connected: player?.connected ?? false,
      turn: game.roundActive && game.currentPlayerId === p.id,
      uno: p.calledUno && p.cardCount === 1,
      catchable: game.roundActive && p.id !== youId && game.unoExposedId === p.id && p.cardCount === 1 && !p.calledUno,
      isMe: p.id === youId,
      isHost: p.id === this.store.view()?.hostId,
      muted: !!player?.media?.joined && !player.media.mic,
    };
  }

  protected readonly myInfo = computed<PlayerInfo>(() => {
    const me = this.game()?.players.find((p) => p.id === this.store.youId());
    return me ? this.info(me) : { id: '', name: '', avatar: null, cardCount: 0, place: null, connected: true, turn: false, uno: false, catchable: false, isMe: true, isHost: false, muted: false };
  });
  protected readonly columnSeatList = computed(() =>
    this.game() && this.layout().columns ? columnSeats(this.layout(), this.store.opponents(), (p) => this.info(p)) : []);
  protected readonly compactSeatList = computed(() =>
    this.game() && !this.layout().columns && this.layout().compact ? compactSeats(this.layout(), this.store.opponents(), (p) => this.info(p)) : []);
  protected readonly ringSeatList = computed(() =>
    this.game() && !this.layout().columns && !this.layout().compact ? ringSeats(this.layout(), this.store.opponents(), (p) => this.info(p)) : []);

  // ---- hand ----
  protected readonly hand = computed(() => {
    const game = this.game();
    if (!game) return [];
    const playable = new Set(game.playableIds);
    const cards = [...game.hand].sort(compareCards);
    const count = cards.length;
    // Big hands get a flatter fan so the outer cards stay on screen.
    const step = count > 1 ? Math.min(5, 36 / count) : 0;
    return cards.map((card, i) => {
      const offset = i - (count - 1) / 2;
      return {
        card,
        playable: playable.has(card.id),
        drawn: card.id === game.drawnCardId,
        rot: offset * step,
        drop: Math.min(offset * offset * 0.7, 14),
      };
    });
  });

  // ---- prompts ----
  protected readonly canDraw = computed(() => {
    const game = this.game();
    return this.store.myTurn() && !!game && (!!game.pending || !game.drawnCardId);
  });
  protected readonly drawLabel = computed(() => {
    const pending = this.game()?.pending;
    return pending ? `Take ${pending.count}` : 'Draw';
  });
  protected readonly announcement = computed(() => [this.game()?.log.at(-1)?.text ?? '']);

  protected readonly drawnCard = computed(() => {
    const game = this.game();
    return (this.store.myTurn() && game?.drawnCardId && game.hand.find((c) => c.id === game.drawnCardId)) || null;
  });
  protected readonly drawnNote = computed(() => {
    const card = this.drawnCard();
    const top = this.topCard();
    return card && top ? `${describe(card)} goes on the ${describe(top).toLowerCase()}.` : '';
  });

  protected readonly pendingPrompt = computed(() => {
    const game = this.game();
    const pending = this.store.myTurn() ? game?.pending : null;
    if (!game || !pending) return null;
    const stackCard = stackCardOf(game);
    if (!game.challengeable && !stackCard) return null;
    const sender = game.players.find((p) => p.id === pending.from) ?? null;
    return {
      sender,
      from: sender?.name ?? 'Someone',
      isFour: pending.kind === 'wild4',
      count: pending.count,
      colour: pending.prevColor,
      stackCard,
    };
  });

  protected readonly showUnoButton = computed(() => {
    const game = this.game();
    const me = game?.players.find((p) => p.id === this.store.youId());
    return !!game && !!me && me.cardCount === 1 && !me.calledUno && !me.missedUno && game.roundActive;
  });

  protected readonly turnText = computed(() => {
    const game = this.game();
    if (!game) return '';
    const myTurn = this.store.myTurn();
    const current = game.players.find((p) => p.id === game.currentPlayerId);
    const me = game.players.find((p) => p.id === this.store.youId());
    if (!game.roundActive) return "Game over! Everyone's cards are revealed";
    if (me?.place) return `You finished ${placeLabel(me.place)}! Watching the others… (${current?.name ?? ''}'s turn)`;
    if (!myTurn) return `${current?.name ?? 'Next player'}'s turn`;
    if (needsAutoDraw(game, myTurn)) {
      if (game.pending) return `No way to answer: taking ${game.pending.count} cards…`;
      if (me?.missedUno) return 'You missed calling UNO: drawing a card for you…';
      return 'No card to play: drawing one for you…';
    }
    if (game.pending) {
      const options = ['draw', game.challengeable ? 'challenge' : null, stackCardOf(game) ? 'stack' : null].filter(Boolean);
      return options.length > 1 ? `Your turn! Choose: ${options.join(', ')}` : `Your turn! Click the deck to take ${game.pending.count}`;
    }
    if (game.drawnCardId) return 'Your turn! Play the card you drew, or keep it';
    if (me?.cardCount === 1 && !me.calledUno && !me.missedUno) return 'Your turn! Press UNO! before your last card, or you draw 2';
    return 'Your turn!';
  });

  private readonly autoDraw = computed(() => needsAutoDraw(this.game(), this.store.myTurn()));

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.flights.destroy());

    // Measure the stage: its size drives the whole layout.
    afterNextRender(() => {
      const el = this.stageEl().nativeElement;
      const measure = (): void => this.size.set({ w: el.clientWidth, h: el.clientHeight });
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      measure();
      destroyRef.onDestroy(() => observer.disconnect());
    });

    // The other components (video rails, throw menu, effects) read the layout from this service.
    effect(() => {
      const l = this.layout();
      this.stageLayout.columns.set(l.columns);
      this.stageLayout.rails.set(l.rails);
      this.stageLayout.railWidth.set(l.railW);
      this.stageLayout.panelWidth.set(l.panelW);
      this.stageLayout.width.set(l.width);
      this.stageLayout.height.set(l.height);
    });

    // The turn moved on while the color wheel was open: close it.
    effect(() => {
      if (this.ui.pendingWildId() && !this.store.myTurn()) this.ui.pendingWildId.set(null);
    });

    // Nothing to play: the game draws for you after a moment (the timer survives updates while it still applies).
    effect((onCleanup) => {
      if (!this.autoDraw()) return;
      const timer = setTimeout(() => {
        const game = this.store.game();
        if (needsAutoDraw(game, this.store.myTurn())) void this.store.action('draw_card');
      }, AUTO_DRAW_MS);
      onCleanup(() => clearTimeout(timer));
    });

    this.store.updates.pipe(takeUntilDestroyed()).subscribe(() => this.onUpdate());

    // Overlap the hand's cards just enough that it fits the space, so it never needs a scrollbar.
    afterRenderEffect(() => {
      this.hand();
      this.layout();
      this.fitHand();
    });

    // Seats slide to their new places instead of jumping (a panel opening, the window resizing, cards drawn).
    afterRenderEffect(() => {
      this.columnSeatList();
      this.compactSeatList();
      this.ringSeatList();
      this.slideSeats();
    });
  }

  // ---------- reacting to the server ----------

  /** Runs right after each state push, before the new state is drawn. */
  private onUpdate(): void {
    const game = this.store.game();
    if (!this.store.playing() || !game) {
      if (this.wasPlaying) {
        this.wasPlaying = false;
        this.trail.set([]);
        this.trailRound = null;
        this.flights.reset();
      }
      return;
    }
    this.wasPlaying = true;
    if (!this.animationsScheduled) this.flights.rememberHandRects();
    this.updateTrail(game);
    this.playedBy = this.lastTurnPlayerId;
    this.lastTurnPlayerId = game.currentPlayerId;
    if (this.animationsScheduled) return;
    this.animationsScheduled = true;
    afterNextRender(() => {
      this.animationsScheduled = false;
      const current = this.store.game();
      if (!current || !this.store.playing()) return;
      this.fitHand();
      this.flights.animateDraws(current, this.store.youId());
      this.flights.animateDiscard(this.trail().at(-1), this.playedBy, this.store.youId());
    }, { injector: this.injector });
  }

  private updateTrail(game: GameView): void {
    if (game.roundNumber !== this.trailRound) {
      this.trail.set([]);
      this.trailRound = game.roundNumber;
    }
    const trail = this.trail().map((entry) => ({ ...entry, fresh: false }));
    const top = game.topCard;
    if (top && trail.at(-1)?.card.id !== top.id) {
      const seed = hashString(top.id);
      trail.push({ card: top, rot: (seed % 40) - 20, dx: (seed % 13) - 6, dy: ((seed >> 4) % 11) - 5, fresh: true });
      if (trail.length > TRAIL_LENGTH) trail.shift();
    }
    this.trail.set(trail);
  }

  // ---------- geometry that needs the DOM ----------

  private fitHand(): void {
    const handEl = byId('hand');
    if (!handEl) return;
    const count = this.hand().length;
    const step = count > 1 ? Math.min(5, 36 / count) : 0;
    const cardWidth = (handEl.firstElementChild as HTMLElement | null)?.offsetWidth ?? 96;
    // The outermost cards tilt outward (they turn about a point below the card), so leave room for that swing.
    const outerTilt = ((step * Math.max(0, count - 1)) / 2) * (Math.PI / 180);
    const swing = cardWidth * 1.5 * 1.3 * Math.sin(outerTilt);
    const room = handEl.clientWidth - 24 - 2 * swing; // inside the hand's side padding
    const relaxed = -cardWidth * 0.22; // the gap for a small hand
    const fit = count > 1 ? (room - cardWidth) / (count - 1) - cardWidth : 0;
    handEl.style.setProperty('--overlap', `${Math.min(relaxed, fit)}px`);
  }

  private previousSeats = new Map<string, { x: number; y: number }>();
  private seatSlides: Animation[] = [];

  /** Each seat slides from where its previous twin (same kind and player) was to where it is now. */
  private slideSeats(): void {
    const container = byId('opponents');
    if (!container || !this.stageEl().nativeElement.clientWidth) {
      this.previousSeats.clear();
      return;
    }
    for (const slide of this.seatSlides) slide.cancel();
    this.seatSlides = [];
    const now = new Map<string, { x: number; y: number }>();
    const elements = new Map<string, Element>();
    for (const el of container.children) {
      const rect = el.getBoundingClientRect();
      const key = `${el.classList[0]}|${(el as HTMLElement).dataset['player'] ?? ''}`;
      now.set(key, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      elements.set(key, el);
    }
    for (const [key, centre] of now) {
      const was = this.previousSeats.get(key);
      if (!was) continue;
      const dx = was.x - centre.x;
      const dy = was.y - centre.y;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      this.seatSlides.push(elements.get(key)!.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: SLIDE_MS, easing: SLIDE_EASE }));
    }
    this.previousSeats = now;
  }

  // ---------- actions ----------

  /** Click (or tap) another player's name chip or cards during a game: throw something at them. */
  protected onOpponentsClick(event: MouseEvent): void {
    const target = event.target as Element;
    if (target.closest('.catch')) return;
    const seat = target.closest<HTMLElement>('[data-player]');
    if (!seat || seat.dataset['player'] === this.store.youId()) return;
    event.stopPropagation();
    this.throwing.openMenu(seat.dataset['player'] ?? '', event.clientX, event.clientY);
  }

  protected catchUno(targetId: string): void {
    void this.store.action('catch_uno', { targetId });
  }

  protected callUno(): void {
    void this.store.action('call_uno');
  }

  protected draw(): void {
    void this.store.action('draw_card');
  }

  protected challenge(): void {
    void this.store.action('challenge');
  }

  protected keep(): void {
    void this.store.action('pass_turn');
  }

  protected playDrawn(): void {
    const card = this.drawnCard();
    if (card) this.playCard(card);
  }

  protected playCard(card: Card): void {
    this.flights.rememberPlayedFrom(card.id);
    if (card.color === 'wild') {
      // The colour dialog sends the card once a colour is chosen.
      this.ui.pendingWildId.set(card.id);
      return;
    }
    void this.store.action('play_card', { cardId: card.id });
  }
}
