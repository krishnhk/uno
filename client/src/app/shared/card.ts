import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import { Card } from '../core/models';
import { cardFace, describe } from '../core/cards';

/**
 * A card face. Use it as an attribute on the element that IS the card, so the shared CSS (which uses
 * selectors like `.hand .card:first-child`) sees no wrapper element:
 *   <div app-card [card]="c" [playable]="true"></div>
 *   <button type="button" app-card [card]="c" (click)="..."></button>
 */
@Component({
  selector: '[app-card]',
  template: `<span class="corner">{{ face() }}</span><span class="center">{{ face() }}</span><span class="corner br">{{ face() }}</span>`,
  host: {
    '[class]': 'classes()',
    '[attr.data-tip]': 'tip()',
    '[attr.data-card]': 'card().id',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class CardComponent {
  readonly card = input.required<Card>();
  readonly playable = input(false);
  readonly drawn = input(false);

  protected readonly face = computed(() => cardFace(this.card()));
  protected readonly tip = computed(() => describe(this.card()));
  protected readonly classes = computed(
    () => `card c-${this.card().color}${this.playable() ? ' playable' : ''}${this.drawn() ? ' drawn' : ''}`,
  );
}

/**
 * The back of a card, with the UNO logo drawn in a 100 x 150 box: an oval, and "UNO" squeezed to a fixed width
 * so it always sits inside the oval, with a solid shadow copy just behind it.
 *   <div app-card-back class="d1"></div>   (extra classes such as deck-card d1 go on the element)
 */
@Component({
  selector: '[app-card-back]',
  template: `
    <svg class="back-logo" viewBox="0 0 100 150" aria-hidden="true">
      <g class="back-logo-turn">
        <ellipse class="back-oval" cx="50" cy="75" rx="45" ry="27" />
        <text class="back-word back-word-shadow" x="51.6" y="77.2" text-anchor="middle" dominant-baseline="central" textLength="64" lengthAdjust="spacingAndGlyphs">UNO</text>
        <text class="back-word" x="50" y="75" text-anchor="middle" dominant-baseline="central" textLength="64" lengthAdjust="spacingAndGlyphs">UNO</text>
      </g>
    </svg>`,
  host: { class: 'card back' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class CardBackComponent {}
