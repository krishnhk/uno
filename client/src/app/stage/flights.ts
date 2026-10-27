import { ComponentRef, EnvironmentInjector, createComponent, signal } from '@angular/core';
import { Card, GameView } from '../core/models';
import { CardBackComponent, CardComponent } from '../shared/card';

// Drawn cards travel slowly enough to read: lift and flip, a pause to show the card, then into the hand.
const DRAW_FLIGHT_MS = 1500;
const DRAW_STAGGER_MS = 700; // one card after another when a couple are drawn
// Many at once (the opening deal, taking +4 or a stack): quicker and overlapping, so it doesn't drag.
const BULK_DRAW = { flight: 950, stagger: 220 };
const OPPONENT_DRAW_MS = 900;
const DISCARD_FLIGHT_MS = 750; // a played card travelling to the discard pile
const OPPONENT_FLIGHT_MAX = 3; // cards shown flying to an opponent at once, however many they draw

/** One card on the discard pile with its tossed look. */
export interface TrailEntry {
  card: Card;
  rot: number;
  dx: number;
  dy: number;
  fresh: boolean;
}

const byId = (id: string): HTMLElement | null => document.getElementById(id);
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function div(className: string, ...children: Element[]): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.append(...children);
  return el;
}

/**
 * The card flights: new cards from the deck to your hand and to the opponents, and the played card to the
 * discard pile. They are overlays on the page, so they are built imperatively (the one place the stage does
 * not use templates). It also remembers what the animations need from the previous update.
 */
export class StageFlights {
  /** Your cards still in the air: they stay hidden in the hand until they land. */
  readonly flyingIds = signal<ReadonlySet<string>>(new Set());
  /** The played card on its way to the discard pile (the real top card stays hidden until it arrives). */
  readonly discardFlightId = signal<string | null>(null);

  private seenHand: Set<string> | null = null; // card ids in your hand at the last update; null before the first one
  private readonly seenCounts = new Map<string, number>(); // opponent id -> card count at the last update
  private readonly playedFrom = new Map<string, DOMRect>(); // card id -> where it was in your hand when you played it
  private readonly lastHandRects = new Map<string, DOMRect>(); // card id -> where it sat in your hand before the latest update
  private readonly overlays = new Set<() => void>();
  /** Card components made for the overlay being built; mount() takes them over. */
  private pendingRefs: ComponentRef<unknown>[] = [];

  constructor(private readonly env: EnvironmentInjector) {}

  /** The next game starts from an empty hand, so its deal animates too. */
  reset(): void {
    this.seenHand = null;
    this.seenCounts.clear();
  }

  destroy(): void {
    for (const remove of [...this.overlays]) remove();
  }

  /** Where each of your cards is now, so a card played for you (time ran out) can still fly from your hand to the pile. */
  rememberHandRects(): void {
    this.lastHandRects.clear();
    for (const el of byId('hand')?.querySelectorAll<HTMLElement>('[data-card]') ?? []) {
      this.lastHandRects.set(el.dataset['card'] ?? '', el.getBoundingClientRect());
    }
  }

  rememberPlayedFrom(cardId: string): void {
    const el = byId('hand')?.querySelector(`[data-card="${cardId}"]`) ?? byId('drawn-card')?.firstElementChild;
    if (el) this.playedFrom.set(cardId, el.getBoundingClientRect());
  }

  private mountCard(card: Card): HTMLElement {
    const host = document.createElement('div');
    const ref = createComponent(CardComponent, { environmentInjector: this.env, hostElement: host });
    ref.setInput('card', card);
    ref.changeDetectorRef.detectChanges();
    this.pendingRefs.push(ref);
    return host;
  }

  private mountBack(className = ''): HTMLElement {
    const host = document.createElement('div');
    host.className = className;
    const ref = createComponent(CardBackComponent, { environmentInjector: this.env, hostElement: host });
    ref.changeDetectorRef.detectChanges();
    this.pendingRefs.push(ref);
    return host;
  }

  /** Puts an overlay on the page; the returned function removes it (and the cards in it). */
  private mount(el: HTMLElement): () => void {
    document.body.append(el);
    const refs = this.pendingRefs.splice(0);
    const remove = (): void => {
      el.remove();
      for (const ref of refs) ref.destroy();
      this.overlays.delete(remove);
    };
    this.overlays.add(remove);
    return remove;
  }

  private setFlying(id: string, flying: boolean): void {
    this.flyingIds.update((ids) => {
      const next = new Set(ids);
      if (flying) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Compares with the last update and flies newly drawn cards from the deck. */
  animateDraws(game: GameView, youId: string): void {
    const newCards = game.hand.filter((c) => !this.seenHand?.has(c.id));
    this.seenHand = new Set(game.hand.map((c) => c.id));
    const grew = game.players
      .filter((p) => p.id !== youId)
      .map((p) => ({ id: p.id, more: p.cardCount - (this.seenCounts.get(p.id) ?? 0) }))
      .filter((p) => p.more > 0);
    for (const p of game.players) this.seenCounts.set(p.id, p.cardCount);

    const deck = document.querySelector('#stage-center .deck');
    if (!deck || reducedMotion()) return;
    const from = deck.getBoundingClientRect();

    const bulk = newCards.length > 2;
    newCards.forEach((card, i) => {
      const target = byId('hand')?.querySelector<HTMLElement>(`[data-card="${card.id}"]`);
      if (target) this.flyToHand(from, target, card, i * (bulk ? BULK_DRAW.stagger : DRAW_STAGGER_MS), bulk ? BULK_DRAW.flight : DRAW_FLIGHT_MS);
    });
    const opponents = byId('opponents');
    grew.forEach(({ id, more }, k) => {
      const target = opponents?.querySelector<HTMLElement>(`.opp-fan[data-player="${id}"]`)
        ?? opponents?.querySelector<HTMLElement>(`[data-player="${id}"]`);
      if (!target) return;
      for (let i = 0; i < Math.min(more, OPPONENT_FLIGHT_MAX); i++) {
        this.flyToOpponent(from, target, (k + i) * DRAW_STAGGER_MS);
      }
    });
  }

  /** A card leaves the deck face down, arcs up, flips over and lands in its place in your hand. */
  private flyToHand(from: DOMRect, target: HTMLElement, card: Card, delay: number, duration: number): void {
    const width = target.offsetWidth;
    const height = target.offsetHeight;
    const box = target.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const rot = Number.parseFloat(target.style.getPropertyValue('--rot')) || 0;
    const dx = from.left + from.width / 2 - cx;
    const dy = from.top + from.height / 2 - cy;
    const scale = from.width / width;

    this.setFlying(card.id, true);
    target.classList.add('incoming');

    const front = this.mountCard(card);
    const back = this.mountBack();
    for (const face of [front, back]) {
      face.classList.add('fly-face');
      face.style.setProperty('--cw', `${width}px`);
    }
    back.classList.add('fly-back');
    const inner = div('fly-inner', front, back);
    const fly = div('fly', inner);
    fly.style.cssText = `left:${cx - width / 2}px;top:${cy - height / 2}px;width:${width}px;height:${height}px`;
    const remove = this.mount(fly);

    // Where it pauses to be seen: above the hand, between the deck and its slot, a little bigger.
    const handBox = byId('hand')?.getBoundingClientRect() ?? box;
    const showX = (handBox.left + handBox.width / 2 + (from.left + from.width / 2)) / 2 - cx;
    const showY = handBox.top - height * 0.75 - cy;
    const timing = { duration, delay, fill: 'both' as const };
    fly.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
      { transform: `translate(${dx}px, ${dy - 26}px) scale(${scale * 1.06})`, offset: 0.1, easing: 'cubic-bezier(0.25, 0.7, 0.3, 1)' },
      { transform: `translate(${showX}px, ${showY}px) scale(1.45)`, offset: 0.42 },
      { transform: `translate(${showX}px, ${showY - 6}px) scale(1.5)`, offset: 0.66, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
      { transform: `rotate(${rot}deg)` },
    ], timing);
    // Face down off the deck, turning over on the way up so it's face up while it's shown.
    void inner.animate([
      { transform: 'rotateY(180deg)' },
      { transform: 'rotateY(180deg)', offset: 0.12 },
      { transform: 'rotateY(0deg)', offset: 0.4 },
      { transform: 'rotateY(0deg)' },
    ], { ...timing, easing: 'ease-in-out' }).finished.then(() => {
      remove();
      this.setFlying(card.id, false);
      const landed = byId('hand')?.querySelector<HTMLElement>(`[data-card="${card.id}"]`);
      landed?.classList.remove('incoming');
      // A short glow so the new card stands out in the hand.
      landed?.animate([
        { boxShadow: '0 0 0 4px rgba(255, 220, 80, 0.95), 0 0 26px rgba(255, 220, 80, 0.9)', translate: '0 -14px' },
        { boxShadow: '0 0 0 0 rgba(255, 220, 80, 0)', translate: '0 0' },
      ], { duration: 900, easing: 'ease-out' });
    });
  }

  /** A face-down card flies from the deck to another player's seat and tucks into their hand. */
  private flyToOpponent(from: DOMRect, target: HTMLElement, delay: number): void {
    const box = target.getBoundingClientRect();
    const dx = box.left + box.width / 2 - (from.left + from.width / 2);
    const dy = box.top + box.height / 2 - (from.top + from.height / 2);
    const back = this.mountBack('fly-face');
    back.style.setProperty('--cw', `${from.width}px`);
    const fly = div('fly', back);
    fly.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px`;
    const remove = this.mount(fly);
    void fly.animate([
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.75) rotate(-12deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.4) rotate(8deg)`, opacity: 0 },
    ], { duration: OPPONENT_DRAW_MS, delay, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'both' }).finished.then(remove);
  }

  /**
   * The card just played travels to the discard pile from whoever played it (your hand, or their seat),
   * turning to its resting angle on the way. The real top card stays hidden until it arrives.
   */
  animateDiscard(entry: TrailEntry | undefined, playedBy: string | null, youId: string): void {
    if (!entry?.fresh || this.discardFlightId() === entry.card.id) return;
    const pile = document.querySelector<HTMLElement>(`#stage-center .discard [data-trail="${entry.card.id}"]`);
    if (!pile || reducedMotion()) return;
    let from: DOMRect | null | undefined = this.playedFrom.get(entry.card.id) ?? (playedBy === youId ? this.lastHandRects.get(entry.card.id) : null);
    this.playedFrom.clear();
    if (!from && playedBy && playedBy !== youId) {
      const opponents = byId('opponents');
      const seat = opponents?.querySelector(`.opp-fan[data-player="${playedBy}"]`)
        ?? opponents?.querySelector(`[data-player="${playedBy}"] .pb-avatar`)
        ?? opponents?.querySelector(`[data-player="${playedBy}"]`);
      from = seat?.getBoundingClientRect();
    }
    if (!from) return;
    const to = pile.getBoundingClientRect();
    const width = pile.offsetWidth;
    const height = pile.offsetHeight;
    const fx = from.left + from.width / 2 - (to.left + to.width / 2);
    const fy = from.top + from.height / 2 - (to.top + to.height / 2);
    const startScale = playedBy === youId ? Math.max(0.6, from.width / width) : 0.55;
    const face = this.mountCard(entry.card);
    face.classList.add('fly-face');
    face.style.setProperty('--cw', `${width}px`);
    const fly = div('fly', face);
    fly.style.cssText = `left:${to.left + to.width / 2 - width / 2}px;top:${to.top + to.height / 2 - height / 2}px;width:${width}px;height:${height}px`;
    const remove = this.mount(fly);
    const id = entry.card.id;
    this.discardFlightId.set(id);
    pile.classList.add('incoming');
    void fly.animate([
      { transform: `translate(${fx}px, ${fy}px) scale(${startScale}) rotate(0deg)` },
      { transform: `translate(${fx * 0.4}px, ${fy * 0.4 - 50}px) scale(1.25) rotate(${entry.rot / 2}deg)`, offset: 0.55 },
      { transform: `translate(${entry.dx}px, ${entry.dy}px) scale(1) rotate(${entry.rot}deg)` },
    ], { duration: DISCARD_FLIGHT_MS, easing: 'cubic-bezier(0.25, 0.7, 0.3, 1)', fill: 'both' }).finished.then(() => {
      remove();
      this.discardFlightId.set(null);
      document.querySelector(`#stage-center .discard [data-trail="${id}"]`)?.classList.remove('incoming');
    });
  }
}
