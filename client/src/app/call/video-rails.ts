import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, computed, inject, signal,
} from '@angular/core';
import { aroundMe } from '../core/cards';
import { RoomPlayer } from '../core/models';
import { RoomStore } from '../core/room.store';
import { StageLayoutService } from '../core/stage-layout.service';
import { AvatarComponent } from '../shared/avatar';
import { CallService } from './call.service';

const ORDER_KEY = 'uno.videoOrder';

function loadOrder(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/**
 * Keeps each placed player at the index of the slot it was dragged to, filling the rest in their default order.
 * (The order is yours alone and is remembered in this browser; players you have not placed keep their usual spot.)
 */
function inOrder(players: RoomPlayer[], order: string[]): RoomPlayer[] {
  const placed = order.filter((id) => players.some((p) => p.id === id));
  if (!placed.length) return players;
  const result = [...players];
  const ranked = players.filter((p) => placed.includes(p.id)).sort((a, b) => placed.indexOf(a.id) - placed.indexOf(b.id));
  const slots = players.map((p, i) => (placed.includes(p.id) ? i : -1)).filter((i) => i >= 0);
  slots.forEach((slot, k) => { result[slot] = ranked[k]; });
  return result;
}

/**
 * The video boxes of the call during a game: a column on each side of the table, and (when the columns layout is
 * not used) your own picture small above your badge. Drag a box onto another to swap their places.
 */
@Component({
  selector: 'app-video-rails',
  imports: [NgTemplateOutlet, AvatarComponent],
  template: `
    <ng-template #tile let-p>
      <div class="vtile" [class.turn]="isTurn(p.id)" [class.me]="p.id === store.youId()" [class.speaking]="call.speaking().has(p.id)"
           [attr.data-player]="p.id" draggable="true" title="Drag onto another box to swap places"
           (dragstart)="onDragStart($event, p.id)" (dragover)="onDragOver($event)" (drop)="onDrop($event, p.id)" (dragend)="onDragEnd()">
        @if (!live(p.id)) {
          <div class="vtile-placeholder">
            <div app-avatar class="vtile-avatar" [name]="p.name" [avatar]="p.avatar"></div>
          </div>
        }
        <div class="vtile-name">
          <span class="vtile-label">{{ p.id === store.youId() ? p.name + ' (you)' : p.name }}</span>
          @if (!micOn(p)) {
            <span class="vtile-mic" data-tip="Microphone off" aria-label="Microphone off">🔇</span>
          }
        </div>
      </div>
    </ng-template>

    <div id="video-rail-left" class="video-rail left">
      @for (p of boxes().left; track p.id) {
        <ng-container *ngTemplateOutlet="tile; context: { $implicit: p }" />
      }
    </div>
    <div id="video-rail-right" class="video-rail right">
      @for (p of boxes().right; track p.id) {
        <ng-container *ngTemplateOutlet="tile; context: { $implicit: p }" />
      }
    </div>
    <div id="self-video" class="self-video">
      @if (boxes().self; as me) {
        <ng-container *ngTemplateOutlet="tile; context: { $implicit: me }" />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class VideoRailsComponent {
  protected readonly store = inject(RoomStore);
  protected readonly call = inject(CallService);
  private readonly layout = inject(StageLayoutService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly order = signal<string[]>(loadOrder());
  private draggedId: string | null = null;

  /** Who sits where: the others in the side columns, and you above your badge (or in the left column). */
  protected readonly boxes = computed(() => {
    const game = this.store.game();
    const none = { left: [] as RoomPlayer[], right: [] as RoomPlayer[], self: null as RoomPlayer | null };
    const me = this.store.me();
    if (!game || !me || !this.layout.rails() || !this.call.active()) return none;
    // The others fill the side columns in turn order (the left one, which also has your picture, takes the smaller half).
    const players = this.store.players();
    const others = aroundMe(game.players, me.id).slice(1)
      .map((p) => players.find((q) => q.id === p.id))
      .filter((p): p is RoomPlayer => !!p?.connected && !!p.media?.joined);
    const order = this.order();
    if (this.layout.columns()) {
      // Wide game layout: your tile joins the others, so both columns hold the same number of boxes.
      // By default the left column is filled first with your own box last in it; you can drag boxes to reorder.
      const leftCount = Math.ceil((others.length + 1) / 2);
      const defaults = [...others.slice(0, leftCount - 1), me, ...others.slice(leftCount - 1)];
      const tiles = inOrder(defaults, order);
      return { left: tiles.slice(0, leftCount), right: tiles.slice(leftCount), self: null };
    }
    const tiles = inOrder(others, order);
    const half = Math.floor(tiles.length / 2);
    return { left: tiles.slice(0, half), right: tiles.slice(half), self: me };
  });

  constructor() {
    // The shared <video> elements are moved into the boxes after each render (a box shows a placeholder otherwise).
    afterRenderEffect(() => {
      this.call.revision();
      this.boxes();
      for (const tile of Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.vtile[data-player]'))) {
        const id = tile.dataset['player'] ?? '';
        if (!this.call.hasLiveVideo(id)) {
          tile.querySelectorAll(':scope > .av-video').forEach((v) => v.remove());
          continue;
        }
        const video = this.call.videoFor(id, tile);
        if (video.parentElement !== tile) tile.prepend(video);
        // Moving a playing video can pause it; carry on.
        this.call.keepPlaying(video);
      }
    });
  }

  protected live(id: string): boolean {
    this.call.revision();
    return this.call.hasLiveVideo(id);
  }

  protected micOn(p: RoomPlayer): boolean {
    this.call.revision();
    return this.call.micOn(p.id, p);
  }

  protected isTurn(id: string): boolean {
    const game = this.store.game();
    return !!game && game.roundActive && game.currentPlayerId === id;
  }

  // ---- your own order for the video boxes ----

  private swap(fromId: string, toId: string): void {
    const { left, right } = this.boxes();
    const current = [...left, ...right].map((p) => p.id);
    const a = current.indexOf(fromId);
    const b = current.indexOf(toId);
    if (a < 0 || b < 0 || a === b) return;
    [current[a], current[b]] = [current[b], current[a]];
    this.order.set(current);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(current));
    } catch {
      // Not remembered after a reload; the order still applies now.
    }
  }

  protected onDragStart(event: DragEvent, id: string): void {
    this.draggedId = id;
    (event.currentTarget as HTMLElement).classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  protected onDragOver(event: DragEvent): void {
    const tile = event.currentTarget as HTMLElement;
    if (!this.draggedId) return;
    event.preventDefault();
    for (const t of Array.from(document.querySelectorAll('.video-rail .vtile.drop-target'))) t.classList.remove('drop-target');
    if (tile.dataset['player'] !== this.draggedId) tile.classList.add('drop-target');
  }

  protected onDrop(event: DragEvent, id: string): void {
    if (!this.draggedId) return;
    event.preventDefault();
    this.swap(this.draggedId, id);
    this.onDragEnd();
  }

  protected onDragEnd(): void {
    this.draggedId = null;
    for (const t of Array.from(document.querySelectorAll('.video-rail .vtile.dragging, .video-rail .vtile.drop-target'))) {
      t.classList.remove('dragging', 'drop-target');
    }
  }
}
