import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { aroundMe, momentsBetween } from './cards';
import { AVATAR_IMAGES } from './avatars';
import { Avatar, GamePlayer, GameView, Moment, RoomPlayer, RoomSettings, RoomView, Session } from './models';
import { SocketService } from './socket.service';
import { UiService } from './ui.service';

/** Emitted after every state push from the server, once the new view is in place. */
export interface StateUpdate {
  prev: RoomView | null;
  view: RoomView;
  moments: Moment[];
}

/**
 * The one place that knows where the game stands: the latest room view from the server, this tab's session,
 * your name and avatar, and the actions that talk to the server. (The Angular version of the old app.js core.)
 */
@Injectable({ providedIn: 'root' })
export class RoomStore {
  private readonly sockets = inject(SocketService);
  private readonly ui = inject(UiService);

  /** The latest room view pushed by the server (null when you are not in a room). */
  readonly view = signal<RoomView | null>(null);
  /** { code, name, token } for this tab, so a refresh or a reconnect rejoins the same seat. */
  readonly session = signal<Session | null>(loadSession());
  readonly connected = this.sockets.connected;

  /** What you typed in the name box on the home screen (remembered between visits). */
  readonly name = signal<string>(readStorage(localStorage, 'uno.name') ?? '');
  readonly avatar = signal<Avatar>(loadAvatar());

  /** Fires after every state push, for effects that need the previous and the new view (animations). */
  readonly updates = new Subject<StateUpdate>();

  // ---- derived ----
  readonly inRoom = computed(() => Boolean(this.view() && this.session()));
  readonly youId = computed(() => this.view()?.youId ?? '');
  readonly game = computed<GameView | null>(() => this.view()?.game ?? null);
  readonly players = computed<RoomPlayer[]>(() => this.view()?.players ?? []);
  readonly me = computed<RoomPlayer | undefined>(() => this.players().find((p) => p.id === this.youId()));
  readonly isHost = computed(() => !!this.view() && this.view()!.hostId === this.view()!.youId);
  /** A game is on and its table is showing. */
  readonly playing = computed(() => {
    const v = this.view();
    return !!v && !!this.session() && v.status === 'playing' && !!v.game;
  });
  readonly gamePlayers = computed<GamePlayer[]>(() => this.game()?.players ?? []);
  /** The other players in turn order, starting after you. */
  readonly opponents = computed(() => aroundMe(this.gamePlayers(), this.youId()).slice(1));
  readonly myTurn = computed(() => {
    const g = this.game();
    return !!g && g.roundActive && g.currentPlayerId === this.youId();
  });
  /** Your name as others see it: from the room once you have joined, otherwise from the name box. */
  readonly currentName = computed(() => this.me()?.name ?? this.name().trim());

  private serverVersion: string | null = null;

  constructor() {
    this.sockets.on('connect', () => {
      // Re-join the room after a reconnect, using the token from this tab.
      const s = this.session();
      if (s) {
        void this.enterRoom(s.code, s.name, s.token).then((ok) => {
          if (!ok) this.leaveLocal('Could not rejoin the room.');
        });
      }
    });
    // The server was restarted with new code: reload so this page runs the matching client.
    this.sockets.on<string>('server_version', (version) => {
      if (this.serverVersion && this.serverVersion !== version) window.location.reload();
      this.serverVersion = version;
    });
    this.sockets.on<RoomView>('state', (next) => this.onState(next));
    this.sockets.on<{ reason: string }>('room_closed', ({ reason }) => {
      this.leaveLocal(reason === 'idle' ? 'The room was closed after being idle.' : 'The room was closed.');
    });
    this.sockets.on('kicked', () => this.leaveLocal('The host removed you from the room.'));
  }

  private onState(next: RoomView): void {
    const prev = this.view();
    // Let everyone know when the host changes (for example because the host left).
    const previousHostId = prev?.code === next.code ? prev.hostId : null;
    if (previousHostId && previousHostId !== next.hostId) {
      const host = next.players.find((p) => p.id === next.hostId);
      this.ui.toast(next.hostId === next.youId ? '👑 You are now the host' : `👑 ${host?.name ?? 'Someone'} is now the host`);
    }
    const moments = momentsBetween(prev, next, next.youId);
    // Count down on this device's own clock from the time left the server reported.
    next.turnDeadline = typeof next.turnRemainingMs === 'number' ? Date.now() + next.turnRemainingMs : null;
    this.view.set(next);
    this.updates.next({ prev, view: next, moments });
  }

  // ---------- talking to the server ----------

  /** Sends a request; on an error shows the message in a toast and resolves null. */
  async request<T extends Record<string, unknown> = Record<string, unknown>>(event: string, payload: unknown = {}): Promise<T | null> {
    const res = await this.sockets.request(event, payload);
    if (!res.ok) {
      this.ui.toast(res.error ?? 'No response from the server');
      return null;
    }
    return res as unknown as T;
  }

  /** Same as request(): the game actions (play_card, draw_card, ...) all go through here. */
  action(event: string, payload?: unknown): Promise<Record<string, unknown> | null> {
    return this.request(event, payload);
  }

  /** Reads your name from the box; asks for one if it is empty. */
  requireName(): string | null {
    const name = this.name().trim();
    if (!name) {
      this.ui.toast('Enter your name first');
      return null;
    }
    writeStorage(localStorage, 'uno.name', name);
    return name;
  }

  async enterRoom(code: string, name: string, token?: string): Promise<boolean> {
    const res = await this.request<{ code: string; token: string }>('join_room', { code, name, token, avatar: this.avatar() });
    if (!res) return false;
    this.saveSession({ code: res.code, name, token: res.token });
    return true;
  }

  async createRoom(settings: Partial<RoomSettings> = {}): Promise<void> {
    const name = this.requireName();
    if (!name) return;
    const res = await this.request<{ code: string; token: string }>('create_room', { name, settings, avatar: this.avatar() });
    if (res) this.saveSession({ code: res.code, name, token: res.token });
  }

  async joinRoom(code: string): Promise<void> {
    const name = this.requireName();
    if (!name) return;
    await this.enterRoom(code.trim().toUpperCase(), name);
  }

  async leaveRoom(): Promise<void> {
    await this.request('leave_room');
    this.leaveLocal('You left the room.');
  }

  /** Forget the room on this device (you left, were removed, or it closed). */
  leaveLocal(message?: string): void {
    this.clearSession();
    this.view.set(null);
    this.ui.reset();
    if (message) this.ui.toast(message);
  }

  // ---------- your name and avatar ----------

  setName(value: string): void {
    this.name.set(value);
  }

  setAvatar(change: Partial<Avatar>): void {
    const next: Avatar = { image: null, ...change };
    this.avatar.set(next);
    writeStorage(localStorage, 'uno.avatar', JSON.stringify(next));
  }

  /** Already in a room: let everyone else see the new avatar. */
  publishAvatar(): void {
    if (this.inRoom()) void this.action('set_avatar', { avatar: this.avatar() });
  }

  // ---------- session ----------

  private saveSession(next: Session): void {
    this.session.set(next);
    writeStorage(sessionStorage, 'uno.session', JSON.stringify(next));
  }

  private clearSession(): void {
    this.session.set(null);
    try {
      sessionStorage.removeItem('uno.session');
    } catch {
      // Nothing to clean up.
    }
  }

  /** The avatar picture a player chose, for drawing their chip. */
  avatarOf(playerId: string): Avatar | null {
    return this.players().find((p) => p.id === playerId)?.avatar ?? null;
  }
}

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the game still works in this tab.
  }
}

function loadSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem('uno.session') ?? 'null');
  } catch {
    return null;
  }
}

function loadAvatar(): Avatar {
  try {
    const saved = JSON.parse(localStorage.getItem('uno.avatar') ?? 'null');
    return { image: AVATAR_IMAGES.includes(saved?.image) ? saved.image : null };
  } catch {
    return { image: null };
  }
}
