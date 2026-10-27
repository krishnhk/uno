// Types for what the Node server sends (see src/rooms.js viewFor and src/game.js viewFor).

export type CardColor = 'red' | 'yellow' | 'green' | 'blue' | 'wild';
export type PlayColor = Exclude<CardColor, 'wild'>;
export type CardValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';
export type GameMode = 'last' | 'first';

export interface Card {
  id: string;
  color: CardColor;
  value: CardValue;
}

export interface Avatar {
  /** id of a character picture under /avatars (see core/avatars.ts), or null for initials */
  image: string | null;
}

export interface Media {
  joined: boolean;
  mic: boolean;
  cam: boolean;
  /** changes every time a player (re)joins the video call, to tell old links from new ones */
  session?: string | null;
}

export interface RoomPlayer {
  id: string;
  name: string;
  avatar: Avatar | null;
  connected: boolean;
  media: Media;
}

export interface RoomSettings {
  maxPlayers: number;
  stacking: boolean;
  mode: GameMode;
  turnSeconds: number;
}

export interface ChatMessage {
  from: string;
  text: string;
  at: number;
}

export interface Pending {
  kind: 'draw2' | 'wild4';
  count: number;
  from: string;
  prevColor: PlayColor | null;
}

export interface GamePlayer {
  id: string;
  name: string;
  cardCount: number;
  score: number;
  calledUno: boolean;
  missedUno: boolean;
  place: number | null;
  /** everyone's leftover cards once the game is over, otherwise null */
  revealedHand: Card[] | null;
}

/** What happened, in a form the screens can react to (see client/src/app/core/moments.ts). */
export interface LogMeta {
  kind: 'play' | 'take' | 'draw' | 'uno' | 'caught' | 'challenge' | 'out' | 'gameover';
  by?: string | null;
  target?: string | null;
  value?: CardValue;
  color?: PlayColor;
  count?: number;
  stacked?: boolean;
  right?: boolean;
  place?: number;
  points?: number;
  winnerId?: string | null;
  mode?: GameMode;
}

export interface LogEntry {
  /** running number, so a client can tell which entries it has not seen */
  n: number;
  text: string;
  card: Card | null;
  drew: number;
  meta: LogMeta | null;
}

export interface ResultRow {
  id: string;
  name: string;
  place: number;
  score: number;
  cardsLeft: number;
  handPoints: number;
  hand: Card[];
}

export interface GameView {
  mode: GameMode;
  roundNumber: number;
  roundActive: boolean;
  gameOver: boolean;
  winnerId: string | null;
  currentPlayerId: string | null;
  direction: 1 | -1;
  currentColor: PlayColor | null;
  topCard: Card | null;
  drawPileCount: number;
  pending: Pending | null;
  challengeable: boolean;
  drawnCardId: string | null;
  unoExposedId: string | null;
  players: GamePlayer[];
  hand: Card[];
  playableIds: string[];
  results: ResultRow[] | null;
  log: LogEntry[];
}

export interface LastResult {
  mode: GameMode;
  endedAt: number;
  winnerName: string;
  ranking: ResultRow[];
}

export interface RoomView {
  code: string;
  status: 'lobby' | 'playing';
  hostId: string;
  youId: string;
  settings: RoomSettings;
  players: RoomPlayer[];
  game: GameView | null;
  lastResult: LastResult | null;
  /** time left in the current turn as the server saw it (the client counts down on its own clock) */
  turnRemainingMs: number | null;
  /** set on the client: Date.now() + turnRemainingMs */
  turnDeadline?: number | null;
  chat: ChatMessage[];
}

/** Saved in this tab so a refresh or reconnect rejoins the same seat. */
export interface Session {
  code: string;
  name: string;
  token: string;
}

export type ThrowItem = 'tomato' | 'egg' | 'heart';

/** One thing that just happened, derived from two consecutive RoomViews. */
export type Moment =
  | { type: 'play'; by: string; value: CardValue; color: PlayColor; target?: string; count?: number; stacked?: boolean; cardId: string | null; mine: boolean; toMe: boolean }
  | { type: 'take'; by: string; count: number; mine: boolean; toMe: boolean }
  | { type: 'draw'; by: string; count: number; mine: boolean; toMe: boolean }
  | { type: 'uno'; by: string; mine: boolean; toMe: boolean }
  | { type: 'caught'; by: string | null; target: string; count: number; mine: boolean; toMe: boolean }
  | { type: 'challenge'; by: string; target: string; count: number; right: boolean; mine: boolean; toMe: boolean }
  | { type: 'out'; by: string; place: number; points: number; mine: boolean; toMe: boolean }
  | { type: 'gameover'; winnerId: string | null; mode: GameMode; winnerScore: number; tier: 1 | 2 | 3 | 4; scores: { id: string; score: number }[]; mine: boolean; toMe: boolean };
