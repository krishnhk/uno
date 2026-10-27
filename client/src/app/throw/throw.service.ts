import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { RoomStore } from '../core/room.store';
import { SocketService } from '../core/socket.service';
import { StageLayoutService } from '../core/stage-layout.service';
import { UiService } from '../core/ui.service';
import { burstTomato, crackEgg, floatHearts, html } from './splat-art';

// During a game you can click another player and throw a tomato or an egg at them, or send a heart.
// The server tells everyone in the room, and each screen shows it flying from seat to seat and splatting.

export type ThrowItem = 'tomato' | 'egg' | 'heart';

export const THROWABLES: Record<ThrowItem, { emoji: string; label: string; love?: boolean }> = {
  tomato: { emoji: '🍅', label: 'Tomato' },
  egg: { emoji: '🥚', label: 'Egg' },
  heart: { emoji: '❤️', label: 'Heart', love: true },
};

const THROW_FLIGHT_MS = 650;
const SPLAT_STAY_MS = 1800;
// Rapid fire is fine; clicks closer together than the server allows are just skipped.
const THROW_GAP_MS = 130;
const MAX_SPLATS = 12;

interface Spot {
  x: number;
  y: number;
  size: number;
}

/** The open throw menu: who it is for and where the click was (the fallback anchor). */
export interface ThrowMenuState {
  playerId: string;
  name: string;
  x: number;
  y: number;
}

@Injectable({ providedIn: 'root' })
export class ThrowService {
  private readonly store = inject(RoomStore);
  private readonly sockets = inject(SocketService);
  private readonly layout = inject(StageLayoutService);
  private readonly ui = inject(UiService);

  /** The menu next to a player (null when closed). */
  readonly menu = signal<ThrowMenuState | null>(null);

  private lastThrowAt = 0;
  private justOpened = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    // Anywhere else you click, or Escape, closes the menu.
    const onClick = (event: MouseEvent) => {
      // The click that opened the menu is still travelling up to the document.
      if (this.justOpened) return;
      if (this.menu() && !(event.target instanceof Element && event.target.closest('#throw-menu'))) this.closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.closeMenu();
    };
    const onThrown = (payload: { from: string; to: string; item: ThrowItem }) => this.onThrown(payload);
    document.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    this.sockets.socket.on('thrown', onThrown);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      this.sockets.socket.off('thrown', onThrown);
      this.timers.forEach(clearTimeout);
      document.querySelectorAll('.projectile, .splat, .love').forEach((el) => el.remove());
    });
  }

  /** Opens the small menu next to a player's chip (the stage calls this when another player is clicked). */
  openMenu(playerId: string, x: number, y: number): void {
    const player = this.store.players().find((p) => p.id === playerId);
    if (!player || playerId === this.store.youId() || !this.store.game()) return;
    this.menu.set({ playerId, name: player.name, x, y });
    this.justOpened = true;
    this.later(() => (this.justOpened = false), 0);
  }

  closeMenu(): void {
    this.menu.set(null);
  }

  /** Throws one and closes the menu; click the player again to throw another (no waiting in between). */
  throwAt(item: ThrowItem): void {
    const targetId = this.menu()?.playerId;
    this.closeMenu();
    if (!targetId || Date.now() - this.lastThrowAt < THROW_GAP_MS) return;
    this.lastThrowAt = Date.now();
    this.sockets.emit('throw_item', { targetId, item });
  }

  /** Where a player sits on this screen: their video tile if the videos are beside the table, else their avatar. */
  seatSpot(playerId: string): HTMLElement | null {
    const tile = (this.layout.rails() || this.layout.columns())
      && document.querySelector<HTMLElement>(`.video-rail .vtile[data-player="${playerId}"], #self-video .vtile[data-player="${playerId}"]`);
    if (tile) return tile;
    if (playerId === this.store.youId()) return document.querySelector<HTMLElement>('#my-badge .pb-avatar');
    return document.querySelector<HTMLElement>(`#opponents [data-player="${playerId}"] .pb-avatar`);
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private onThrown({ from, to, item }: { from: string; to: string; item: ThrowItem }): void {
    const throwable = THROWABLES[item];
    if (!throwable || !this.store.game() || !this.store.playing()) return;
    const start = this.seatSpot(from);
    const target = this.seatSpot(to);
    if (!target) return;
    const end = centre(target);
    const begin: Spot = start ? centre(start) : { x: end.x, y: -40, size: 0 };
    const projectile = html('div', { class: 'projectile', 'aria-hidden': 'true' }, throwable.emoji);
    document.body.append(projectile);
    // A lob: straight across, up and over in an arc, spinning.
    const lift = Math.min(260, 80 + Math.hypot(end.x - begin.x, end.y - begin.y) * 0.35);
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = begin.x + (end.x - begin.x) * t;
      const y = begin.y + (end.y - begin.y) * t - lift * 4 * t * (1 - t);
      frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${t * 600}deg) scale(${1 + 0.35 * Math.sin(Math.PI * t)})` });
    }
    const sender = this.store.players().find((p) => p.id === from)?.name ?? 'Someone';
    projectile.animate(frames, { duration: THROW_FLIGHT_MS, easing: 'linear' }).finished.then(() => {
      // Squash flat against the target for a split second.
      const at = `translate(${end.x}px, ${end.y}px) translate(-50%, -50%)`;
      return projectile.animate([
        { transform: `${at} scale(1.2, 0.8)` },
        { transform: `${at} scale(1.7, 0.35)`, opacity: 0.6 },
      ], { duration: 90, easing: 'ease-in', fill: 'forwards' }).finished;
    }).then(() => {
      projectile.remove();
      const onMe = to === this.store.youId();
      if (throwable.love) this.sendLove(target, end, onMe, sender);
      else this.splatOn(target, end, item, onMe);
    }).catch((err) => {
      projectile.remove();
      console.warn('Throw animation failed', err);
    });
  }

  /**
   * The hit. A tomato bursts: a spiky juice splatter shoots out, bits of skin and the stalk fly off,
   * seeds and pulp sit on top. An egg cracks: the shell halves tumble away, the white spreads out
   * like liquid and the yolk drops in with a wobble. The target shakes; then the mess slides down and fades.
   */
  private splatOn(target: HTMLElement, at: Spot, item: ThrowItem, onMe: boolean): void {
    const size = Math.max(130, at.size * 1.2, Math.min(at.size * 2, 210));
    const box = html('div', { class: `splat splat-${item}`, 'aria-hidden': 'true', style: `left:${at.x}px;top:${at.y}px;width:${size}px;height:${size}px` });
    document.body.append(box);
    // Rapid fire piles splats up; keep the newest few.
    const all = document.querySelectorAll('.splat');
    for (let i = 0; i < all.length - MAX_SPLATS; i++) all[i].remove();
    if (item === 'egg') crackEgg(box, size);
    else burstTomato(box, size);

    if (target.isConnected) {
      target.animate([
        { translate: '0 0', rotate: '0deg' }, { translate: '-7px 3px', rotate: '-4deg' }, { translate: '6px -2px', rotate: '3deg' },
        { translate: '-4px 1px', rotate: '-2deg' }, { translate: '2px 0', rotate: '1deg' }, { translate: '0 0', rotate: '0deg' },
      ], { duration: 460, easing: 'ease-out' });
    }
    if (onMe) this.ui.toast(`${THROWABLES[item].emoji} Splat! You got hit.`);

    // Gravity wins in the end: the whole mess sags downward, stretches and fades.
    this.later(() => {
      box.animate([
        { translate: '-50% -50%', scale: '1 1', opacity: 1 },
        { translate: '-50% calc(-50% + 26px)', scale: '0.97 1.18', opacity: 0 },
      ], { duration: 900, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' })
        .finished.then(() => box.remove(), () => box.remove());
    }, SPLAT_STAY_MS);
  }

  /** A heart: a pink glow pulses round the player, little hearts float up, and they do a happy bounce. */
  private sendLove(target: HTMLElement, at: Spot, onMe: boolean, sender: string): void {
    const size = Math.max(110, at.size * 1.1);
    const box = html('div', { class: 'love', 'aria-hidden': 'true', style: `left:${at.x}px;top:${at.y}px;width:${size}px;height:${size}px` });
    document.body.append(box);
    floatHearts(box, size);
    if (target.isConnected) {
      target.animate([
        { scale: '1' }, { scale: '1.18' }, { scale: '0.94' }, { scale: '1.06' }, { scale: '1' },
      ], { duration: 650, easing: 'ease-out' });
    }
    if (onMe) this.ui.toast(`💖 ${sender} sent you love!`);
    this.later(() => box.remove(), 2600);
  }
}

function centre(el: HTMLElement): Spot {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(r.width, r.height) };
}
