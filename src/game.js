'use strict';

const crypto = require('node:crypto');
const { UnoError } = require('./errors');

const COLORS = ['red', 'yellow', 'green', 'blue'];
const ACTION_VALUES = ['skip', 'reverse', 'draw2'];
// 'last': players drop out as they empty their hand; play goes on until one player is left holding cards.
// 'first': the first player to empty their hand wins and the game ends.
const MODES = ['last', 'first'];
const HAND_SIZE = 7;
const LOG_LIMIT = 200;
const UNO_PENALTY = 2;

const VALUE_LABELS = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };

function randomInt(max) {
  return crypto.randomInt(max);
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** The standard 108-card deck. Wild cards use color "wild". */
function buildDeck() {
  const deck = [];
  let nextId = 1;
  const add = (color, value) => deck.push({ id: `c${nextId++}`, color, value });

  for (const color of COLORS) {
    add(color, '0');
    for (let n = 1; n <= 9; n++) {
      add(color, String(n));
      add(color, String(n));
    }
    for (const action of ACTION_VALUES) {
      add(color, action);
      add(color, action);
    }
  }
  for (let i = 0; i < 4; i++) {
    add('wild', 'wild');
    add('wild', 'wild4');
  }
  return deck;
}

/** Points a card is worth when left in a player's hand. */
function cardPoints(card) {
  if (card.color === 'wild') return 50;
  if (ACTION_VALUES.includes(card.value)) return 20;
  return Number(card.value);
}

function handPoints(player) {
  return player.hand.reduce((sum, card) => sum + cardPoints(card), 0);
}

function describeCard(card) {
  const label = VALUE_LABELS[card.value] ?? card.value;
  return card.color === 'wild' ? label : `${card.color} ${label}`;
}

function ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

/**
 * Rules engine for one game. Pure logic: no timers, no sockets.
 * The server calls the action methods and then broadcasts viewFor() to each player.
 */
class UnoGame {
  /**
   * @param {{ players: {id: string, name: string}[], stacking?: boolean, mode?: 'last' | 'first' }} options
   */
  constructor({ players, stacking = false, mode = 'last' }) {
    if (players.length < 2 || players.length > 6) throw new UnoError('A game needs 2 to 6 players');
    if (!MODES.includes(mode)) throw new UnoError('Unknown game mode');
    // place is null while a player still has cards, then their finishing position (1 = best).
    // missedUno: went down to one card and the next player moved before they called UNO. They cannot
    // call it or go out with that card any more; they have to draw.
    this.players = players.map(({ id, name }) => ({ id, name, hand: [], calledUno: false, missedUno: false, score: 0, place: null }));
    this.stacking = stacking;
    this.mode = mode;
    this.direction = 1;
    this.currentIndex = 0;
    this.drawPile = [];
    this.discardPile = [];
    this.currentColor = null;
    // { kind: 'draw2' | 'wild4', count, from, prevColor, offenderHasMatch } while a draw is owed
    this.pending = null;
    this.drawnCardId = null;
    this.unoExposedId = null;
    this.roundNumber = 0;
    this.turnNumber = 0;
    this.roundActive = false;
    this.gameOver = false;
    this.winnerId = null;
    this.finishCount = 0;
    this.results = null;
    this.log = [];
  }

  get currentPlayer() {
    return this.players[this.currentIndex];
  }

  playerById(id) {
    return this.players.find((p) => p.id === id);
  }

  /** Players who still hold cards. */
  activePlayers() {
    return this.players.filter((p) => p.place === null);
  }

  topCard() {
    return this.discardPile[this.discardPile.length - 1];
  }

  start() {
    if (this.roundActive || this.gameOver) throw new UnoError('The game has already started');

    this.roundNumber = 1;
    this.turnNumber += 1;
    this.roundActive = true;
    this.drawPile = shuffle(buildDeck());
    this.discardPile = [];

    for (const player of this.players) {
      player.hand = this.drawPile.splice(-HAND_SIZE);
    }

    // Flip cards until a number card shows. Action and Wild cards go back into the deck (2022 rule).
    let top = this.drawPile.pop();
    while (top.color === 'wild' || ACTION_VALUES.includes(top.value)) {
      this.drawPile.splice(randomInt(this.drawPile.length + 1), 0, top);
      top = this.drawPile.pop();
    }
    this.discardPile.push(top);
    this.currentColor = top.color;
    // Players are in the seating order the host set in the lobby; seat 1 goes first.
    this.currentIndex = 0;
    this.addLog(`Game started with ${describeCard(top)}. ${this.currentPlayer.name} goes first.`, { card: top });
  }

  /** Whether a card can be played right now, ignoring whose turn it is. */
  isPlayable(card) {
    if (this.pending) return this.stacking && card.value === this.pending.kind;
    // A Wild Draw Four may be played at any time. If it was played illegally, the next player can challenge it.
    if (card.color === 'wild') return true;
    return card.color === this.currentColor || card.value === this.topCard().value;
  }

  playableCardIds(playerId) {
    if (!this.roundActive || this.currentPlayer.id !== playerId) return [];
    const player = this.playerById(playerId);
    if (player.missedUno) return [];
    return player.hand
      .filter((card) => (!this.drawnCardId || card.id === this.drawnCardId) && this.isPlayable(card))
      .map((card) => card.id);
  }

  play(playerId, cardId, chosenColor) {
    this.requireTurn(playerId);
    const player = this.currentPlayer;
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) throw new UnoError('That card is not in your hand');
    if (this.drawnCardId && this.drawnCardId !== cardId) throw new UnoError('You can only play the card you just drew');
    if (player.missedUno) throw new UnoError('You missed calling UNO, so you must draw a card');
    if (!this.isPlayable(card)) throw new UnoError('That card cannot be played now');

    const isWild = card.color === 'wild';
    if (isWild && !COLORS.includes(chosenColor)) throw new UnoError('Choose a color for the wild card');

    this.closeUnoWindow(playerId);
    const prevColor = this.currentColor;
    const offenderHasMatch = player.hand.some((c) => c.color === prevColor);
    const previous = this.pending;
    this.pending = null;

    player.hand = player.hand.filter((c) => c.id !== cardId);
    this.discardPile.push(card);
    this.drawnCardId = null;
    this.currentColor = isWild ? chosenColor : card.color;
    const playLog = this.addLog(`${player.name} played ${describeCard(card)}${isWild ? ` and chose ${chosenColor}` : ''}.`, {
      card,
      meta: { kind: 'play', by: player.id, value: card.value, color: this.currentColor },
    });

    // Playing the last card only counts after calling UNO; otherwise the player takes a penalty and plays on.
    const forgotUno = player.hand.length === 0 && !player.calledUno;
    if (forgotUno) {
      this.drawCards(player, UNO_PENALTY);
      this.addLog(`${player.name} played the last card without calling UNO and draws ${UNO_PENALTY}.`, {
        drew: UNO_PENALTY,
        meta: { kind: 'caught', by: null, target: player.id, count: UNO_PENALTY },
      });
    }
    const wentOut = player.hand.length === 0;
    player.calledUno = false;
    if (player.hand.length === 1) this.unoExposedId = player.id;

    let steps = 1;
    if (card.value === 'skip') {
      steps = 2;
      playLog.meta.target = this.players[this.nextIndex(1)].id;
    } else if (card.value === 'reverse') {
      this.direction *= -1;
      // With two players left, Reverse works like Skip.
      if (!wentOut && this.activePlayers().length === 2) steps = 2;
    } else if (card.value === 'draw2' || card.value === 'wild4') {
      const count = (previous ? previous.count : 0) + (card.value === 'draw2' ? 2 : 4);
      playLog.meta.target = this.players[this.nextIndex(1)].id;
      playLog.meta.count = count;
      playLog.meta.stacked = Boolean(previous);
      if (wentOut) {
        // A draw card played as the last card cannot be challenged: the next player takes the cards and loses the turn.
        const next = this.players[this.nextIndex(1)];
        const drawn = this.drawCards(next, count);
        this.addLog(`${next.name} takes ${drawn.length} cards and loses the turn.`, { drew: drawn.length, meta: { kind: 'take', by: next.id, count: drawn.length } });
        steps = 2;
      } else {
        this.pending = { kind: card.value, count, from: player.id, prevColor, offenderHasMatch };
      }
    }

    if (wentOut) {
      this.finishPlayer(player);
      if (this.mode === 'first' || this.activePlayers().length <= 1) {
        this.endGame();
        return;
      }
    }
    this.advance(steps);
  }

  /**
   * Draw a card on your turn. While a draw is owed, this takes the cards and
   * ends the turn (the "accept" option).
   */
  draw(playerId) {
    this.requireTurn(playerId);
    const player = this.currentPlayer;
    if (!this.pending && this.drawnCardId) throw new UnoError('You already drew a card this turn');

    this.closeUnoWindow(playerId);
    if (this.pending) {
      const { count } = this.pending;
      this.pending = null;
      const drawn = this.drawCards(player, count);
      this.addLog(`${player.name} takes ${drawn.length} cards and loses the turn.`, { drew: drawn.length, meta: { kind: 'take', by: player.id, count: drawn.length } });
      this.advance(1);
      return;
    }

    const [card] = this.drawCards(player, 1);
    if (!card) {
      // Every card is in someone's hand: nothing to draw, so the turn just passes.
      // (A missed UNO is settled too, or that player could never go out.)
      player.missedUno = false;
      this.addLog(`No cards left to draw. ${player.name} passes.`);
      this.advance(1);
      return;
    }
    if (this.isPlayable(card)) {
      // The player now chooses: play the drawn card, or keep it (see pass).
      this.drawnCardId = card.id;
      this.addLog(`${player.name} drew a card.`, { drew: 1, meta: { kind: 'draw', by: player.id, count: 1 } });
      return;
    }
    // Nothing to decide: the card can't be played, so the player keeps it and the turn moves on.
    this.addLog(`${player.name} drew a card and keeps it.`, { drew: 1, meta: { kind: 'draw', by: player.id, count: 1 } });
    this.advance(1);
  }

  /** After drawing a playable card, the player chooses to keep it instead of playing it. The turn moves on. */
  pass(playerId) {
    this.requireTurn(playerId);
    if (!this.drawnCardId) throw new UnoError('Draw a card first');
    this.closeUnoWindow(playerId);
    this.addLog(`${this.currentPlayer.name} keeps the drawn card.`);
    this.advance(1);
  }

  /**
   * The next player challenges a Wild Draw Four. If the player who played it
   * still had a card matching the previous color, the challenge succeeds.
   */
  challenge(playerId) {
    this.requireTurn(playerId);
    if (!this.pending || this.pending.kind !== 'wild4') throw new UnoError('There is no Wild Draw Four to challenge');

    this.closeUnoWindow(playerId);
    const challenger = this.currentPlayer;
    const offender = this.playerById(this.pending.from);
    const { count, offenderHasMatch } = this.pending;
    this.pending = null;

    if (offenderHasMatch) {
      this.drawCards(offender, count);
      this.addLog(`${challenger.name} challenged and was right. ${offender.name} draws ${count} cards.`, {
        drew: count,
        meta: { kind: 'challenge', by: challenger.id, target: offender.id, count, right: true },
      });
      // The challenger keeps the turn.
      this.turnNumber += 1;
    } else {
      const drawn = this.drawCards(challenger, count + 2);
      this.addLog(`${challenger.name} challenged and was wrong, so draws ${drawn.length} cards and loses the turn.`, {
        drew: drawn.length,
        meta: { kind: 'challenge', by: challenger.id, target: challenger.id, count: drawn.length, right: false },
      });
      this.advance(1);
    }
  }

  callUno(playerId) {
    if (!this.roundActive) throw new UnoError('No game is in progress');
    const player = this.playerById(playerId);
    if (!player) throw new UnoError('You are not in this game');
    if (player.hand.length !== 1) throw new UnoError('You can only call UNO with one card left');
    if (player.calledUno) throw new UnoError('You already called UNO');
    if (player.missedUno) throw new UnoError('Too late to call UNO: draw a card');
    player.calledUno = true;
    this.addLog(`${player.name} calls UNO!`, { meta: { kind: 'uno', by: player.id } });
  }

  /** Another player catches someone who has one card and did not call UNO. */
  catchUno(catcherId, targetId) {
    if (!this.roundActive || this.unoExposedId !== targetId) throw new UnoError('Nobody can be caught right now');
    const catcher = this.playerById(catcherId);
    if (!catcher) throw new UnoError('You are not in this game');
    if (catcherId === targetId) throw new UnoError('You cannot catch yourself');

    const target = this.playerById(targetId);
    if (target.calledUno || target.hand.length !== 1) throw new UnoError('That player called UNO in time');

    this.unoExposedId = null;
    this.drawCards(target, UNO_PENALTY);
    this.addLog(`${catcher.name} caught ${target.name} without UNO. ${target.name} draws ${UNO_PENALTY}.`, {
      drew: UNO_PENALTY,
      meta: { kind: 'caught', by: catcher.id, target: target.id, count: UNO_PENALTY },
    });
  }

  /** Used when a player's turn timer runs out: take the owed cards, or draw and pass. */
  autoTurn() {
    if (!this.roundActive) return;
    const player = this.currentPlayer;
    const playerId = player.id;
    // Out of time with a card that fits: it is played for them instead of drawing.
    const card = this.autoPlayCard(player);
    if (card) {
      this.addLog(`Time's up: a card is played for ${player.name}.`);
      this.play(playerId, card.id, card.color === 'wild' ? this.mostHeldColor(player, card) : undefined);
      return;
    }
    if (this.pending || !this.drawnCardId) this.draw(playerId);
    if (this.roundActive && this.currentPlayer.id === playerId && this.drawnCardId) this.pass(playerId);
  }

  /**
   * The card played for a player whose time ran out, or null if nothing fits.
   * Coloured cards go first; a Wild is kept back unless it is the only choice, and a Wild Draw Four comes last.
   */
  autoPlayCard(player) {
    const ids = this.playableCardIds(player.id);
    if (!ids.length) return null;
    const rank = (c) => (c.value === 'wild4' ? 2 : c.color === 'wild' ? 1 : 0);
    return player.hand.filter((c) => ids.includes(c.id)).sort((a, b) => rank(a) - rank(b))[0];
  }

  /** The colour the player holds most of (not counting the card being played), for an automatic Wild. */
  mostHeldColor(player, except) {
    const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
    for (const c of player.hand) if (c !== except && counts[c.color] !== undefined) counts[c.color] += 1;
    return COLORS.reduce((best, c) => (counts[c] > counts[best] ? c : best), COLORS[0]);
  }

  /** The state a given player is allowed to see. Other players' hands are only counted. */
  viewFor(viewerId) {
    const viewer = this.playerById(viewerId);
    const currentId = this.roundActive ? this.currentPlayer.id : null;
    return {
      mode: this.mode,
      roundNumber: this.roundNumber,
      roundActive: this.roundActive,
      gameOver: this.gameOver,
      winnerId: this.winnerId,
      currentPlayerId: currentId,
      direction: this.direction,
      currentColor: this.currentColor,
      topCard: this.discardPile.length ? this.topCard() : null,
      drawPileCount: this.drawPile.length,
      // prevColor: the colour in play before a Wild Draw Four (what a challenge asks about); everyone saw it.
      pending: this.pending
        ? { kind: this.pending.kind, count: this.pending.count, from: this.pending.from, prevColor: this.pending.prevColor ?? null }
        : null,
      challengeable: Boolean(this.pending && this.pending.kind === 'wild4'),
      drawnCardId: currentId === viewerId ? this.drawnCardId : null,
      unoExposedId: this.unoExposedId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        score: p.score,
        calledUno: p.calledUno,
        missedUno: p.missedUno,
        place: p.place,
        // Hands stay hidden during play; once the game is over everyone's leftover cards are shown.
        revealedHand: this.gameOver ? p.hand : null,
      })),
      hand: viewer ? viewer.hand : [],
      playableIds: this.playableCardIds(viewerId),
      results: this.results,
      log: this.log.slice(-40),
    };
  }

  /** A player emptied their hand: they score the cards still held by everyone else and take the next place. */
  finishPlayer(player) {
    const points = this.activePlayers()
      .filter((p) => p !== player)
      .reduce((sum, p) => sum + handPoints(p), 0);
    player.score += points;
    this.finishCount += 1;
    player.place = this.finishCount;
    if (player.place === 1) this.winnerId = player.id;
    this.addLog(`${player.name} is out of cards and finishes ${ordinal(player.place)} (+${points} points).`, {
      meta: { kind: 'out', by: player.id, place: player.place, points },
    });
  }

  endGame() {
    const remaining = this.activePlayers();
    if (this.mode === 'last') {
      // The one player still holding cards comes last.
      for (const player of remaining) {
        this.finishCount += 1;
        player.place = this.finishCount;
        this.addLog(`${player.name} is left holding cards and comes last.`);
      }
    } else {
      // Everyone except the winner is ranked by the points left in their hand: fewer is better. Ties share a place.
      for (const player of remaining) {
        player.place = 2 + remaining.filter((other) => handPoints(other) < handPoints(player)).length;
      }
    }

    this.roundActive = false;
    this.gameOver = true;
    this.pending = null;
    this.drawnCardId = null;
    this.unoExposedId = null;
    this.results = [...this.players]
      .sort((a, b) => a.place - b.place)
      .map((p) => ({
        id: p.id,
        name: p.name,
        place: p.place,
        score: p.score,
        cardsLeft: p.hand.length,
        handPoints: handPoints(p),
        hand: p.hand,
      }));
    this.addLog('Game over.', { meta: { kind: 'gameover', winnerId: this.winnerId, mode: this.mode } });
  }

  requireTurn(playerId) {
    if (!this.roundActive) throw new UnoError('No game is in progress');
    if (this.currentPlayer.id !== playerId) throw new UnoError('It is not your turn');
  }

  /** The catch window closes as soon as the next player acts. */
  /**
   * The catch window closes as soon as another player moves. A player still holding one card without
   * having called UNO has then missed their chance.
   */
  closeUnoWindow(actorId) {
    const exposed = this.unoExposedId ? this.playerById(this.unoExposedId) : null;
    if (exposed && exposed.id !== actorId && !exposed.calledUno && exposed.hand.length === 1) {
      exposed.missedUno = true;
      this.addLog(`${exposed.name} missed calling UNO and must draw before going out.`);
    }
    this.unoExposedId = null;
  }

  /** Index of the player `steps` turns ahead, skipping players who have already finished. */
  nextIndex(steps = 1) {
    const n = this.players.length;
    let index = this.currentIndex;
    for (let s = 0; s < steps; s++) {
      do {
        index = (index + this.direction + n) % n;
      } while (this.players[index].place !== null && index !== this.currentIndex);
    }
    return index;
  }

  advance(steps) {
    this.currentIndex = this.nextIndex(steps);
    this.drawnCardId = null;
    this.turnNumber += 1;
  }

  drawCards(player, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.drawPile.length === 0) this.reshuffleDiscard();
      if (this.drawPile.length === 0) break;
      const card = this.drawPile.pop();
      player.hand.push(card);
      drawn.push(card);
    }
    if (drawn.length) {
      player.calledUno = false;
      player.missedUno = false;
    }
    return drawn;
  }

  /** Keep the top discard and shuffle the rest back into the draw pile. */
  reshuffleDiscard() {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop();
    this.drawPile = shuffle(this.discardPile);
    this.discardPile = [top];
  }

  /** A log entry is its text plus, optionally, the card played or the number of (hidden) cards drawn. */
  /**
   * Adds a line to the game log. `meta` describes what happened in a form the screens can react to with
   * sound and animation: { kind, by, target, count, ... } (player ids, not names). `n` numbers the entries
   * so a client can tell which ones it has not seen yet.
   */
  addLog(text, { card = null, drew = 0, meta = null } = {}) {
    this.logCount = (this.logCount ?? 0) + 1;
    const entry = { n: this.logCount, text, card, drew, meta };
    this.log.push(entry);
    this.cardsDrawnTotal = (this.cardsDrawnTotal ?? 0) + drew;
    if (this.log.length > LOG_LIMIT) this.log.shift();
    return entry;
  }
}

module.exports = { UnoGame, UnoError, MODES, buildDeck, cardPoints, describeCard, COLORS };
