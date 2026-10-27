import {
  ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, inject, viewChild,
} from '@angular/core';
import { Card } from '../core/models';
import { UiService } from '../core/ui.service';
import { CardComponent } from '../shared/card';

/** How to play: the rules and the special cards, opened from the top bar. */
@Component({
  selector: 'app-howto-dialog',
  imports: [CardComponent],
  template: `
    <div id="howto-dialog" class="dialog" [hidden]="!ui.howtoOpen()" (click)="onBackdrop($event)">
      <div class="dialog-box festive howto-box" role="dialog" aria-labelledby="howto-title">
        <header class="howto-head">
          <h2 id="howto-title">📖 How to play <span class="logo small">UNO</span></h2>
          <button #closeButton id="howto-close" type="button" class="game-panel-close" aria-label="Close how to play" (click)="close()">✕</button>
        </header>
        <div #body class="howto-body">
          <div class="howto-grid">
            <section class="howto-section">
              <h3>🎯 Goal</h3>
              <p>Be the first to get rid of all your cards. Everyone starts with 7.</p>
            </section>
            <section class="howto-section">
              <h3>🕹️ On your turn</h3>
              <ol class="howto-steps">
                <li>Play a card that matches the top card by <b>color</b>, <b>number</b> or <b>symbol</b>, or play a <b>Wild</b>.</li>
                <li>Can't play? A card is drawn for you. If it fits, choose <b>Play it</b> or <b>Keep it</b>; either way the turn moves on.</li>
                <li>Down to one card? Press <b>UNO!</b> before the next player moves. Miss it and it's too late: on your turn you can't play your last card and must draw instead.</li>
                <li>Every move has <b>10 seconds</b>. If time runs out, a card that fits is played for you; if none fits, a card is drawn for you and the turn passes.</li>
              </ol>
            </section>
            <section class="howto-section">
              <h3>📣 Say UNO!</h3>
              <p>When you're down to one card, press <b>UNO!</b> before the next player moves. Forget, and another player can press <b>Catch!</b> first: you draw 2 cards. If nobody catches you, you still can't go out: once the next player has moved, you must draw a card on your turn.</p>
            </section>
            <section class="howto-section">
              <h3>🏁 Game modes</h3>
              <p><b>Play till the end:</b> players finish one by one; the last one holding cards loses.</p>
              <p><b>First out wins:</b> the game ends when one player empties their hand; the rest are ranked by points left.</p>
              <p class="howto-note">The host picks the mode in the room before starting. <b>Stacking</b> (+2 on +2, +4 on +4) is an optional house rule.</p>
            </section>
            <section class="howto-section howto-scoring">
              <h3>🏆 Scoring</h3>
              <p>When you go out, you score the cards still in other players' hands.</p>
              <p class="score-chips"><span>Numbers: face value</span><span>Action: 20</span><span>Wild: 50</span></p>
            </section>
          </div>

          <div class="specials" aria-labelledby="specials-title">
            <h2 id="specials-title">Special cards</h2>
            <p class="specials-sub">Play them at the right moment to turn the game around.</p>
            <div class="specials-grid">
              <article class="special">
                <div app-card [card]="skip" aria-hidden="true"></div>
                <h3>Skip</h3>
                <p>The next player loses their turn.</p>
                <span class="points">20 points</span>
              </article>
              <article class="special">
                <div app-card [card]="reverse" aria-hidden="true"></div>
                <h3>Reverse</h3>
                <p>Changes the direction of play. With 2 players it works like Skip.</p>
                <span class="points">20 points</span>
              </article>
              <article class="special">
                <div app-card [card]="draw2" aria-hidden="true"></div>
                <h3>Draw Two</h3>
                <p>The next player draws 2 cards and loses their turn.</p>
                <span class="points">20 points</span>
              </article>
              <article class="special">
                <div app-card [card]="wild" aria-hidden="true"></div>
                <h3>Wild</h3>
                <p>Play it on any card and choose the next color.</p>
                <span class="points">50 points</span>
              </article>
              <article class="special">
                <div app-card [card]="wild4" aria-hidden="true"></div>
                <h3>Wild Draw Four</h3>
                <p>Choose the color. The next player draws 4 and loses their turn. Only allowed when you have no card of the current color, and the next player can challenge it.</p>
                <span class="points">50 points</span>
              </article>
            </div>
          </div>
        </div>
      </div>
    </div>`,
  host: { '(window:keydown.escape)': 'close()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class HowtoDialogComponent {
  protected readonly ui = inject(UiService);
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  private readonly closeButton = viewChild.required<ElementRef<HTMLElement>>('closeButton');

  protected readonly skip: Card = { id: 'howto-skip', color: 'red', value: 'skip' };
  protected readonly reverse: Card = { id: 'howto-reverse', color: 'green', value: 'reverse' };
  protected readonly draw2: Card = { id: 'howto-draw2', color: 'blue', value: 'draw2' };
  protected readonly wild: Card = { id: 'howto-wild', color: 'wild', value: 'wild' };
  protected readonly wild4: Card = { id: 'howto-wild4', color: 'wild', value: 'wild4' };

  constructor() {
    // Once the dialog is showing: start at the top and put the focus on the close button.
    afterRenderEffect(() => {
      if (!this.ui.howtoOpen()) return;
      this.body().nativeElement.scrollTop = 0;
      this.closeButton().nativeElement.focus();
    });
  }

  protected onBackdrop(event: Event): void {
    if (event.target === event.currentTarget) this.close();
  }

  protected close(): void {
    this.ui.howtoOpen.set(false);
  }
}
