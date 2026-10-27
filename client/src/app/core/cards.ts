import { Card, CardValue, LogEntry, Moment, PlayColor, RoomView } from './models';

export const COLOR_LABEL: Record<PlayColor, string> = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
export const VALUE_LABEL: Partial<Record<CardValue, string>> = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };
/** What is printed on the card for the action cards. */
export const FACE: Partial<Record<CardValue, string>> = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };
export const COLOR_ORDER = ['red', 'yellow', 'green', 'blue', 'wild'];
export const VALUE_ORDER = ['skip', 'reverse', 'draw2', 'wild', 'wild4'];
export const MODE_LABEL = { last: 'Play till the end', first: 'First out wins' } as const;
export const MEDALS = ['🥇', '🥈', '🥉'];
export const TRAIL_LENGTH = 5;

const rank = (card: Card): number => (/^\d$/.test(card.value) ? Number(card.value) : 10 + VALUE_ORDER.indexOf(card.value));

/** The order a hand is shown in: by colour, then number, then action cards. */
export const compareCards = (a: Card, b: Card): number =>
  COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color) || rank(a) - rank(b);

export function describe(card: Card): string {
  return card.color === 'wild'
    ? (VALUE_LABEL[card.value] ?? card.value)
    : `${COLOR_LABEL[card.color as PlayColor]} ${VALUE_LABEL[card.value] ?? card.value}`;
}

/** The text on a card's face. */
export const cardFace = (card: Card): string => FACE[card.value] ?? card.value;

export function hashString(text: string): number {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return hash;
}

export function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

export const placeLabel = (place: number): string => `${MEDALS[place - 1] ?? ''} ${ordinal(place)}`.trim();

export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Other players in turn order, starting with you (the first item is you). */
export function aroundMe<T extends { id: string }>(list: T[], youId: string): T[] {
  const i = list.findIndex((p) => p.id === youId);
  return i <= 0 ? list : [...list.slice(i), ...list.slice(0, i)];
}

/** How big a win is, from the points the winner scored: 1 (nice) to 4 (legendary). */
export function winTier(score: number): 1 | 2 | 3 | 4 {
  if (score >= 150) return 4;
  if (score >= 90) return 3;
  if (score >= 40) return 2;
  return 1;
}

/**
 * The moments between two snapshots of the same room, read from the new game-log entries
 * (a port of public/moments.js). Empty when there is nothing to compare, so a first join or a reconnect is silent.
 */
export function momentsBetween(prev: RoomView | null, next: RoomView | null, youId: string): Moment[] {
  const pg = prev?.game;
  const ng = next?.game;
  if (!prev || !next || !pg || !ng || prev.code !== next.code || pg.roundNumber !== ng.roundNumber) return [];
  const lastSeen = pg.log.length ? (pg.log[pg.log.length - 1].n ?? 0) : 0;
  const moments: Moment[] = [];
  for (const entry of ng.log as LogEntry[]) {
    if (!entry.meta || (entry.n ?? 0) <= lastSeen) continue;
    const { kind, ...rest } = entry.meta;
    const m: Record<string, unknown> = { ...rest, type: kind };
    if (kind === 'play') m['cardId'] = entry.card?.id ?? null;
    if (kind === 'gameover') {
      const scores = ng.players.map((p) => ({ id: p.id, score: p.score })).sort((a, b) => b.score - a.score);
      const winnerScore = ng.players.find((p) => p.id === entry.meta?.winnerId)?.score ?? scores[0]?.score ?? 0;
      m['scores'] = scores;
      m['winnerScore'] = winnerScore;
      m['tier'] = winTier(winnerScore);
    }
    m['mine'] = entry.meta.by === youId;
    m['toMe'] = entry.meta.target === youId || (kind === 'take' && entry.meta.by === youId);
    moments.push(m as unknown as Moment);
  }
  return moments;
}

/** The colour you hold the most of, not counting the Wild being played. Ties go red, yellow, green, blue. */
export function mostHeldColor(hand: Card[], wildCardId: string | null): PlayColor {
  const colors = Object.keys(COLOR_LABEL) as PlayColor[];
  const counts = new Map<PlayColor, number>(colors.map((c) => [c, 0]));
  for (const card of hand) {
    if (card.id !== wildCardId && card.color !== 'wild') counts.set(card.color, (counts.get(card.color) ?? 0) + 1);
  }
  return colors.reduce((best, c) => ((counts.get(c) ?? 0) > (counts.get(best) ?? 0) ? c : best));
}
