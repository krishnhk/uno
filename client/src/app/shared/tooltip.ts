import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, inject, viewChild,
} from '@angular/core';

// Anything with a data-tip attribute gets the styled tooltip instead of the browser's plain one.
const TIP_DELAY_MS = 250;
const TIP_GAP = 10;
// A scrollbar shows while its area is scrolling and fades out this long after scrolling stops.
const SCROLLBAR_HIDE_MS = 500;

/** The one shared tooltip, plus the page-wide listeners that drive it and the auto-hiding scrollbars. */
@Component({
  selector: 'app-tooltip',
  template: `<div #tip id="tip" class="tip" role="tooltip" aria-hidden="true"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class TooltipComponent {
  private readonly tip = viewChild.required<ElementRef<HTMLElement>>('tip');
  private target: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly scrollTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

  constructor() {
    const off: (() => void)[] = [];
    const listen = <K extends keyof DocumentEventMap>(
      type: K, handler: (event: DocumentEventMap[K]) => void, options?: AddEventListenerOptions,
    ): void => {
      document.addEventListener(type, handler, options);
      off.push(() => document.removeEventListener(type, handler, options));
    };
    const tipTarget = (event: Event): HTMLElement | null =>
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null;

    listen('pointerover', (event) => {
      const target = tipTarget(event);
      if (target === this.target) return;
      this.hide();
      if (!target || event.pointerType === 'touch') return;
      this.target = target;
      this.timer = setTimeout(() => this.show(target), TIP_DELAY_MS);
    });
    listen('pointerout', (event) => {
      if (this.target && !this.target.contains(event.relatedTarget as Node | null)) this.hide();
    });
    // Keyboard users see the tooltip when they tab onto something.
    listen('focusin', (event) => {
      const target = tipTarget(event);
      if (!target || !target.matches(':focus-visible')) return;
      this.hide();
      this.target = target;
      this.show(target);
    });
    listen('focusout', () => this.hide());
    listen('pointerdown', () => this.hide(), { capture: true });
    listen('scroll', () => this.hide(), { capture: true });

    listen('scroll', (event) => {
      const el = event.target === document ? document.documentElement : event.target;
      if (!(el instanceof Element)) return;
      el.classList.add('is-scrolling');
      clearTimeout(this.scrollTimers.get(el));
      this.scrollTimers.set(el, setTimeout(() => el.classList.remove('is-scrolling'), SCROLLBAR_HIDE_MS));
    }, { capture: true, passive: true });

    inject(DestroyRef).onDestroy(() => {
      off.forEach((fn) => fn());
      clearTimeout(this.timer);
    });
  }

  private show(target: HTMLElement): void {
    const text = target.dataset['tip'];
    const tip = this.tip().nativeElement;
    if (!text || !target.isConnected) return;
    tip.textContent = text;

    // Measure, then place above the target, or below it when there is no room above.
    const box = target.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let side = 'top';
    let top = box.top - height - TIP_GAP;
    if (top < 8) {
      side = 'bottom';
      top = box.bottom + TIP_GAP;
    }
    const centre = box.left + box.width / 2;
    const left = Math.min(Math.max(8, centre - width / 2), window.innerWidth - width - 8);

    tip.dataset['side'] = side;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.setProperty('--arrow-x', `${centre - left}px`);
    tip.classList.add('show');
  }

  private hide(): void {
    clearTimeout(this.timer);
    this.target = null;
    this.tip().nativeElement.classList.remove('show');
  }
}
