import { Avatar, Card, GamePlayer } from '../core/models';
import { compareCards } from '../core/cards';

// The game table's geometry (a port of renderStage / renderColumnStage / renderOpponents in the old app.js).

export const SIDE_PANEL_W = 360;
export const SIDE_PANEL_MIN_WIDTH = 1000;
const COLUMN_MIN_WIDTH = 900;
const COLUMN_MIN_HEIGHT = 520;
const RAILS_MIN_WIDTH = 900;

export interface Point {
  x: number;
  y: number;
}

/** Everything about the table that follows from the size of the stage. */
export interface Layout {
  width: number;
  height: number;
  /** Width of the docked log/chat panel (0 when closed, or not docked on a narrow screen). */
  panelW: number;
  /** The width left for the game once a docked panel has taken its share. */
  areaW: number;
  /** Wide screens: name chips round the table with their cards fanned above. */
  columns: boolean;
  /** In the video call on a wide screen: a column of videos on each side. */
  rails: boolean;
  railW: number;
  /** The middle of the table. */
  center: Point;
  /** Phone layout only: badges with a small fan instead of the big fans. */
  compact: boolean;
  /** Phone layout only: the half-ellipse the opponents sit on. */
  radius: { x: number; y: number };
  /** Column layout only: the glass table. */
  table: { rx: number; ry: number };
  handW: number;
  /** The colour ring around the deck and discard (column layout). */
  ring: number;
  /** Size of the direction swirl. */
  swirl: number;
}

/** Column width: tiles are 4:3, and up to three stack in a column between the top bar and your badge. */
function railWidthFor(W: number, H: number): number {
  const tileH = Math.min(180, (H - 64 - 150 - 2 * 10) / 3);
  return Math.round(Math.min(W >= 1500 ? 260 : 220, Math.max(160, (tileH * 4) / 3 + 16)));
}

export function computeLayout(W: number, H: number, panelOpen: boolean, callActive: boolean, opponentCount: number): Layout {
  // An open Log or Chat panel docks on the right; on a wide screen the game moves over to make room
  // (on a narrow one the panel covers the table instead).
  const panelW = panelOpen && W >= SIDE_PANEL_MIN_WIDTH ? SIDE_PANEL_W : 0;
  const areaW = W - panelW;
  const columns = areaW >= COLUMN_MIN_WIDTH && H >= COLUMN_MIN_HEIGHT;
  const rails = callActive && areaW >= RAILS_MIN_WIDTH;
  const railW = rails ? railWidthFor(areaW, H) : 0;
  const tableW = areaW - 2 * railW;
  const base = { width: W, height: H, panelW, areaW, columns, rails, railW };

  if (columns) {
    // Halfway between the seat across the table and the top of your hand.
    const center = { x: areaW / 2, y: Math.round((210 + H - 170) / 2) };
    const table = { rx: Math.min(tableW * (railW ? 0.4 : 0.34), 640), ry: Math.min(H * 0.25, 260) };
    const ring = Math.round(Math.min(table.ry * 1.4, table.rx * 0.85, 270));
    return {
      ...base, center, table, ring, compact: false, radius: { x: 0, y: 0 },
      handW: Math.max(320, Math.min(960, tableW - 360)),
      swirl: ring * 0.86,
    };
  }
  const compact = opponentCount > 4 || tableW < 700;
  return {
    ...base,
    compact,
    center: { x: areaW / 2, y: H * (compact ? 0.45 : 0.44) },
    radius: {
      x: Math.min(tableW * 0.38, tableW / 2 - (compact ? 60 : 120)),
      y: H * (compact ? 0.28 : 0.31),
    },
    table: { rx: 0, ry: 0 },
    ring: 0,
    handW: 0,
    // Wide, because tilting it flat onto the table squashes it to about half its height.
    swirl: Math.min(tableW * 0.4, H * 0.72),
  };
}

/** What the table shows about one player. */
export interface PlayerInfo {
  id: string;
  name: string;
  avatar: Avatar | null;
  cardCount: number;
  place: number | null;
  connected: boolean;
  turn: boolean;
  uno: boolean;
  catchable: boolean;
  isMe: boolean;
  isHost: boolean;
  /** In the video call with the microphone off. */
  muted: boolean;
}

/** The backs of an opponent's cards, fanned. */
export interface Fan {
  count: number;
  cardWidth: number;
  rots: number[];
  /** Overlap step in px for the packed fans (column layout). */
  step: number | null;
}

function fanOf(count: number, cardWidth: number, maxShown: number): Fan {
  const shown = Math.min(count, maxShown);
  const step = shown > 1 ? Math.min(6, 44 / shown) : 0;
  return { count, cardWidth, rots: Array.from({ length: shown }, (_, i) => (i - (shown - 1) / 2) * step), step: null };
}

/** A fan with one back per card in the hand, squeezed to stay within maxWidth however many there are. */
function packedFanOf(count: number, cardWidth: number, maxWidth: number): Fan {
  const step = count > 1 ? Math.min(cardWidth * 0.4, (maxWidth - cardWidth) / (count - 1)) : 0;
  const rot = Math.min(4, 40 / count);
  return { count, cardWidth, step, rots: Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * rot) };
}

/** A player's leftover cards laid face up in a row (at most 14, in hand order). */
export function revealCards(cards: Card[]): Card[] {
  return [...cards].sort(compareCards).slice(0, 14);
}

export interface ColumnSeat {
  info: PlayerInfo;
  x: number;
  y: number;
  fanY: number;
  /** Face-up cards once the game is over. */
  reveal: Card[] | null;
  cardWidth: number;
  fan: Fan | null;
}

export function columnSeats(layout: Layout, opponents: GamePlayer[], info: (p: GamePlayer) => PlayerInfo): ColumnSeat[] {
  const { center, table, railW, areaW } = layout;
  const count = opponents.length;
  const cw = count > 4 ? 40 : 52;
  return opponents.map((p, k) => {
    let x: number;
    let y: number;
    if (railW) {
      const left = center.x - table.rx * 0.95;
      const span = table.rx * 1.9;
      x = count === 1 ? center.x : left + (k * span) / (count - 1);
      y = Math.max(150, center.y - table.ry - 30);
    } else {
      const [from, to] = count > 3 ? [175, 365] : [180, 360];
      const deg = count === 1 ? 270 : from + (k * (to - from)) / (count - 1);
      const t = (deg * Math.PI) / 180;
      x = center.x + table.rx * 1.02 * Math.cos(t);
      y = center.y + table.ry * 1.1 * Math.sin(t);
    }
    x = Math.min(Math.max(x, railW + 100), areaW - railW - 100);
    y = Math.max(y, 190);
    // Their cards, upright above their name: every card shown, packed tighter as the hand grows.
    const revealed = p.revealedHand;
    return {
      info: info(p),
      x,
      y,
      fanY: y - 36,
      cardWidth: cw,
      reveal: revealed?.length ? revealCards(revealed) : null,
      fan: !revealed && p.cardCount > 0 ? packedFanOf(p.cardCount, cw, cw * 3.4) : null,
    };
  });
}

// Card width and most cards shown in an opponent's fan, by number of opponents (cards are a little
// larger than flat, since tilting the fan back shortens them).
const FAN_SIZES = [
  { cw: 52, maxShown: 12 },
  { cw: 52, maxShown: 12 }, // 1 opponent
  { cw: 50, maxShown: 10 }, // 2
  { cw: 46, maxShown: 7 }, // 3
  { cw: 42, maxShown: 5 }, // 4
];

/** The phone layout with up to 4 opponents: a full fan turned toward the middle, and a badge past its end. */
export interface RingSeat {
  info: PlayerInfo;
  x: number;
  y: number;
  deg: number;
  reveal: Card[] | null;
  fan: Fan | null;
  badge: Point;
}

export function ringSeats(layout: Layout, opponents: GamePlayer[], info: (p: GamePlayer) => PlayerInfo): RingSeat[] {
  const count = opponents.length;
  const { center, radius } = layout;
  return opponents.map((p, k) => {
    const deg = count === 1 ? 270 : 180 + (k * 180) / (count - 1);
    const t = (deg * Math.PI) / 180;
    const x = center.x + radius.x * Math.cos(t);
    const y = center.y + radius.y * Math.sin(t);
    const { cw, maxShown } = FAN_SIZES[Math.min(count, FAN_SIZES.length - 1)];
    const shown = Math.min(p.cardCount, maxShown);
    const fanLength = cw + Math.max(0, shown - 1) * cw * 0.4;
    // The badge sits just past the end of the fan, following the direction of play.
    const tx = -Math.sin(t);
    const ty = Math.cos(t);
    const offset = fanLength / 2 + Math.abs(tx) * 90 + Math.abs(ty) * 36 + 14;
    const revealed = p.revealedHand;
    return {
      info: info(p),
      x,
      y,
      deg,
      reveal: revealed?.length ? revealCards(revealed) : null,
      fan: !revealed && shown > 0 ? fanOf(p.cardCount, cw, maxShown) : null,
      badge: { x: x + tx * offset, y: y + ty * offset },
    };
  });
}

/** Phones (or more than 4 opponents): compact badges with a small fan. */
export interface CompactSeat {
  info: PlayerInfo;
  x: number;
  y: number;
  reveal: Card[] | null;
  revealWidth: number;
  fan: Fan | null;
}

export function compactSeats(layout: Layout, opponents: GamePlayer[], info: (p: GamePlayer) => PlayerInfo): CompactSeat[] {
  const count = opponents.length;
  const { center, radius } = layout;
  // A full table on a wide screen has room for bigger cards; a phone keeps them small.
  const roomy = layout.width >= 1000;
  return opponents.map((p, k) => {
    const deg = count === 1 ? 270 : 165 + (k * (375 - 165)) / (count - 1);
    const t = (deg * Math.PI) / 180;
    const revealed = p.revealedHand;
    return {
      info: info(p),
      x: center.x + radius.x * Math.cos(t),
      y: center.y + radius.y * Math.sin(t),
      reveal: revealed?.length ? revealCards(revealed) : null,
      revealWidth: roomy ? 30 : 22,
      fan: !revealed && p.cardCount > 0 ? (roomy ? fanOf(p.cardCount, 28, 7) : fanOf(p.cardCount, 16, 8)) : null,
    };
  });
}
