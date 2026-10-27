import { Injectable, signal } from '@angular/core';
import { LastResult, RoomPlayer } from './models';

export type GamePanel = 'log' | 'chat';

/** UI state that several components share: the toast, which dialogs and panels are open, and so on. */
@Injectable({ providedIn: 'root' })
export class UiService {
  // ---- toast ----
  readonly toastMessage = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  toast(message: string): void {
    this.toastMessage.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  // ---- dialogs ----
  readonly avatarPickerOpen = signal(false);
  readonly howtoOpen = signal(false);
  /** The scorecard: the result being shown, or null when it is closed. */
  readonly results = signal<LastResult | null>(null);
  /** The Wild card waiting for a colour choice, or null. */
  readonly pendingWildId = signal<string | null>(null);

  // ---- in the game ----
  /** Which side panel is open (log and chat are separate; opening one closes the other). */
  readonly openPanel = signal<GamePanel | null>(null);

  // ---- lobby ----
  /** The host's right-click menu on another player's seat. */
  readonly seatMenu = signal<{ player: RoomPlayer; x: number; y: number } | null>(null);

  /** Back to a clean slate when you leave the room. */
  reset(): void {
    this.avatarPickerOpen.set(false);
    this.results.set(null);
    this.pendingWildId.set(null);
    this.openPanel.set(null);
    this.seatMenu.set(null);
  }
}
