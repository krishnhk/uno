import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { RoomPlayer } from '../core/models';
import { RoomStore } from '../core/room.store';
import { UiService } from '../core/ui.service';
import { CallButtonsComponent } from '../call/call-buttons';
import { AvatarComponent } from '../shared/avatar';
import { ChatFormComponent } from '../shared/chat-form';
import { ChatLogComponent } from '../shared/chat-log';
import { UtilButtonsComponent } from '../shared/util-buttons';

/** The waiting lobby: room code, the six seats, game settings, chat and the room's actions. */
@Component({
  selector: 'app-lobby',
  imports: [AvatarComponent, CallButtonsComponent, ChatFormComponent, ChatLogComponent, UtilButtonsComponent],
  templateUrl: './lobby.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class LobbyComponent {
  protected readonly store = inject(RoomStore);
  private readonly ui = inject(UiService);

  protected readonly host = computed(() => this.store.players().find((p) => p.id === this.store.view()?.hostId));
  protected readonly canStart = computed(() => this.store.players().length >= 2);
  protected readonly emptySeats = computed(() => {
    const v = this.store.view();
    return v ? Array.from({ length: Math.max(0, v.settings.maxPlayers - v.players.length) }, (_, i) => v.players.length + i + 1) : [];
  });
  protected readonly canReorder = computed(() => this.store.isHost() && this.store.players().length > 1);

  protected readonly hint = computed(() => {
    const isHost = this.store.isHost();
    if (!this.canStart()) return isHost ? 'You need at least 2 players. Share the room code!' : 'Waiting for more players to join…';
    if (isHost) return 'Drag players to change the turn order. Right-click a player to remove them or make them host.';
    return `Waiting for ${this.host()?.name ?? 'the host'} to start the game…`;
  });

  // Turn order drag and drop: drop a seat onto another to take its place.
  protected readonly draggedId = signal<string | null>(null);
  protected readonly dropTargetId = signal<string | null>(null);
  private pressTimer: ReturnType<typeof setTimeout> | undefined;

  protected seatStatus(p: RoomPlayer): string {
    if (!p.connected) return 'Away';
    return p.id === this.store.view()?.hostId ? 'Host' : 'Ready';
  }

  protected seatTip(p: RoomPlayer, seatNo: number): string {
    return `Seat ${seatNo}${this.canReorder() ? ' · drag to change the turn order' : ''}${this.hasMenu(p) ? ' · right-click for options' : ''}`;
  }

  /** The host can right-click (or long-press) another player's seat for Remove / Make host. */
  protected hasMenu(p: RoomPlayer): boolean {
    return this.store.isHost() && p.id !== this.store.youId();
  }

  protected async copyCode(): Promise<void> {
    const code = this.store.view()?.code ?? '';
    try {
      await navigator.clipboard.writeText(code);
      this.ui.toast('Room code copied');
    } catch {
      this.ui.toast(`Room code: ${code}`);
    }
  }

  protected showResults(): void {
    this.ui.results.set(this.store.view()?.lastResult ?? null);
  }

  protected start(): void {
    void this.store.action('start_game');
  }

  /** The host's setting changes save straight away; nobody else can change them. */
  protected saveSettings(form: HTMLFormElement): void {
    if (!this.store.isHost()) return;
    const mode = form.querySelector<HTMLInputElement>('[name=mode]:checked')?.value;
    const stacking = form.querySelector<HTMLInputElement>('[name=stacking]')!.checked;
    void this.store.action('update_settings', { settings: { mode, stacking } });
  }

  // ---------- seat menu ----------

  protected openMenu(player: RoomPlayer, x: number, y: number): void {
    this.ui.seatMenu.set({ player, x, y });
  }

  protected contextMenu(event: MouseEvent, player: RoomPlayer): void {
    if (!this.hasMenu(player)) return;
    event.preventDefault();
    this.openMenu(player, event.clientX, event.clientY);
  }

  /** Touch screens: holding a finger on a seat for half a second acts like a right-click. */
  protected pressStart(event: TouchEvent, player: RoomPlayer): void {
    if (!this.hasMenu(player)) return;
    const touch = event.touches[0];
    this.pressTimer = setTimeout(() => this.openMenu(player, touch.clientX, touch.clientY), 500);
  }

  protected pressEnd(): void {
    clearTimeout(this.pressTimer);
  }

  // ---------- turn order ----------

  protected dragStart(event: DragEvent, id: string): void {
    this.draggedId.set(id);
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('text/plain', id);
  }

  protected dragOver(event: DragEvent, id: string): void {
    if (!this.draggedId()) return;
    event.preventDefault();
    this.dropTargetId.set(id === this.draggedId() ? null : id);
  }

  protected drop(event: DragEvent, id: string): void {
    const dragged = this.draggedId();
    if (!dragged) return;
    event.preventDefault();
    const toIndex = this.store.players().findIndex((p) => p.id === id);
    if (id !== dragged && toIndex >= 0) this.movePlayer(dragged, toIndex);
  }

  protected dragEnd(): void {
    this.draggedId.set(null);
    this.dropTargetId.set(null);
  }

  /** Moves a player to a new position in the turn order (host only). */
  private movePlayer(playerId: string, toIndex: number): void {
    const ids = this.store.players().map((p) => p.id).filter((id) => id !== playerId);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, playerId);
    void this.store.action('reorder_players', { playerIds: ids });
  }
}
