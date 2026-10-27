'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UnoGame, buildDeck, cardPoints } = require('../src/game');

let nextId = 1000;
const card = (color, value) => ({ id: `t${nextId++}`, color, value });

function makeGame(count = 2, options = {}) {
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const game = new UnoGame({ players, ...options });
  game.start();
  // Make the setup deterministic: a known top card and a deck that can always be drawn from.
  game.currentIndex = 0;
  game.drawPile = Array.from({ length: 40 }, () => card('red', '0'));
  return game;
}

function setup(game, { top, color, hands, turn = 0 }) {
  game.discardPile = [card(top[0], top[1])];
  game.currentColor = color ?? top[0];
  game.currentIndex = turn;
  for (const [index, cards] of Object.entries(hands)) {
    const player = game.players[Number(index)];
    player.hand = cards.map(([c, v]) => card(c, v));
    // A player holding one card has already called UNO, unless a test says otherwise.
    player.calledUno = cards.length === 1;
  }
}

test('the deck has the standard 108 cards', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    assert.equal(deck.filter((c) => c.color === color).length, 25);
  }
  assert.equal(deck.filter((c) => c.value === 'wild').length, 4);
  assert.equal(deck.filter((c) => c.value === 'wild4').length, 4);
  assert.equal(deck.filter((c) => c.value === '0').length, 4);
});

test('a round deals 7 cards each and starts on a number card', () => {
  for (let i = 0; i < 20; i++) {
    const game = new UnoGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] });
    game.start();
    assert.ok(game.players.every((p) => p.hand.length === 7));
    assert.match(game.topCard().value, /^\d$/);
    assert.equal(game.drawPile.length + 3 * 7 + 1, 108);
  }
});

test('a card must match color, number or symbol', () => {
  const game = makeGame();
  setup(game, { top: ['yellow', '5'], hands: { 0: [['red', '3']] } });
  assert.throws(() => game.play('p0', game.players[0].hand[0].id), /cannot be played/);
});

test('playing a matching card passes the turn and sets the color', () => {
  const game = makeGame();
  setup(game, { top: ['yellow', '5'], hands: { 0: [['yellow', '9'], ['red', '2']] } });
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.currentPlayer.id, 'p1');
  assert.equal(game.currentColor, 'yellow');
});

test('only the current player may act', () => {
  const game = makeGame();
  setup(game, { top: ['red', '5'], hands: { 0: [['red', '1']], 1: [['red', '2']] } });
  assert.throws(() => game.draw('p1'), /not your turn/);
});

test('Reverse works like Skip in a two-player game', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '5'], hands: { 0: [['red', 'reverse'], ['red', '3']] } });
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.currentPlayer.id, 'p0');
});

test('Skip passes over the next player', () => {
  const game = makeGame(3);
  setup(game, { top: ['red', '5'], hands: { 0: [['red', 'skip'], ['red', '3']] } });
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.currentPlayer.id, 'p2');
});

test('Draw Two makes the next player take 2 cards and lose the turn', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '5'], hands: { 0: [['red', 'draw2'], ['red', '3']], 1: [['blue', '1']] } });
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.pending.count, 2);
  game.draw('p1');
  assert.equal(game.players[1].hand.length, 3);
  assert.equal(game.currentPlayer.id, 'p0');
});

test('with stacking on, a Draw Two can be stacked', () => {
  const game = makeGame(2, { stacking: true });
  setup(game, { top: ['red', '5'], hands: { 0: [['red', 'draw2'], ['red', '3']], 1: [['red', 'draw2'], ['blue', '1']] } });
  game.play('p0', game.players[0].hand[0].id);
  game.play('p1', game.players[1].hand[0].id);
  assert.equal(game.pending.count, 4);
  game.draw('p0');
  assert.equal(game.players[0].hand.length, 1 + 4);
});

test('without stacking, a Draw Two cannot be answered with another Draw Two', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '5'], hands: { 0: [['red', 'draw2'], ['red', '3']], 1: [['red', 'draw2']] } });
  game.play('p0', game.players[0].hand[0].id);
  assert.throws(() => game.play('p1', game.players[1].hand[0].id), /cannot be played/);
});

test('a successful challenge makes the offender draw 4 and the challenger keeps the turn', () => {
  const game = makeGame(2);
  // p0 holds a blue card, so a Wild Draw Four is illegal.
  setup(game, { top: ['red', '5'], color: 'blue', hands: { 0: [['wild', 'wild4'], ['blue', '3'], ['red', '7']], 1: [['green', '1']] } });
  game.play('p0', game.players[0].hand[0].id, 'green');
  game.challenge('p1');
  assert.equal(game.players[0].hand.length, 2 + 4);
  assert.equal(game.currentPlayer.id, 'p1');
});

test('a failed challenge makes the challenger draw 6 and lose the turn', () => {
  const game = makeGame(2);
  // p0 has no blue card, so the Wild Draw Four was legal.
  setup(game, { top: ['red', '5'], color: 'blue', hands: { 0: [['wild', 'wild4'], ['red', '7']], 1: [['green', '1']] } });
  game.play('p0', game.players[0].hand[0].id, 'green');
  game.challenge('p1');
  assert.equal(game.players[1].hand.length, 1 + 6);
  assert.equal(game.currentPlayer.id, 'p0');
});

test('forgetting UNO lets another player catch you for 2 cards', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1'], ['red', '2']], 1: [['green', '4']] } });
  game.play('p0', game.players[0].hand[0].id);
  game.catchUno('p1', 'p0');
  assert.equal(game.players[0].hand.length, 1 + 2);
});

test('calling UNO in time prevents the catch', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1'], ['red', '2']], 1: [['green', '4']] } });
  game.play('p0', game.players[0].hand[0].id);
  game.callUno('p0');
  assert.throws(() => game.catchUno('p1', 'p0'), /called UNO in time/);
});

test('the catch window closes once the next player acts', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1'], ['red', '2']], 1: [['green', '4'], ['green', '6']] } });
  game.play('p0', game.players[0].hand[0].id);
  game.draw('p1');
  assert.throws(() => game.catchUno('p1', 'p0'), /Nobody can be caught/);
});

test('a drawn card that can be played lets you choose: keep it, and the turn moves on', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '5'], hands: { 0: [['green', '1'], ['green', '2']] } });
  game.drawPile = [card('red', '9')];
  game.draw('p0');
  assert.equal(game.currentPlayer.id, 'p0'); // waiting for the choice
  assert.ok(game.drawnCardId);
  assert.throws(() => game.draw('p0'), /already drew/);
  game.pass('p0'); // keep it
  assert.equal(game.currentPlayer.id, 'p1');
  assert.equal(game.players[0].hand.length, 3);
});

test('a drawn card that can be played can be played straight away', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '5'], hands: { 0: [['green', '1'], ['green', '2']] } });
  game.drawPile = [card('red', '9')];
  game.draw('p0');
  game.play('p0', game.drawnCardId);
  assert.equal(game.topCard().value, '9');
  assert.equal(game.currentPlayer.id, 'p1');
});

test('a drawn card that cannot be played is kept and the turn moves on by itself', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '5'], hands: { 0: [['green', '1'], ['green', '2']] } });
  game.drawPile = [card('blue', '7')];
  game.draw('p0');
  assert.equal(game.currentPlayer.id, 'p1');
  assert.equal(game.drawnCardId, null);
  assert.equal(game.players[0].hand.length, 3);
  assert.match(game.log.at(-1).text, /drew a card and keeps it/);
});

test('keeping is only possible after drawing', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '5'], hands: { 0: [['green', '1']] } });
  assert.throws(() => game.pass('p0'), /Draw a card first/);
});

const places = (game) => game.results.map((r) => `${r.id}:${r.place}`);

test('with two players, going out ends the game and scores the other hand', () => {
  for (const mode of ['last', 'first']) {
    const game = makeGame(2, { mode });
    setup(game, { top: ['red', '2'], hands: { 0: [['red', '4']], 1: [['blue', '9'], ['green', 'skip']] } });
    game.play('p0', game.players[0].hand[0].id);
    assert.equal(game.players[0].score, 9 + 20);
    assert.equal(game.gameOver, true);
    assert.deepEqual(places(game), ['p0:1', 'p1:2']);
  }
});

test('play till the end: the game goes on until one player is left holding cards', () => {
  const game = makeGame(3, { mode: 'last' });
  setup(game, { top: ['red', '2'], hands: { 0: [['red', '4']], 1: [['red', '6']], 2: [['green', '1'], ['green', '2']] } });

  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.players[0].place, 1);
  assert.equal(game.players[0].score, 6 + 1 + 2); // cards still held by p1 and p2
  assert.equal(game.gameOver, false);
  assert.equal(game.currentPlayer.id, 'p1');

  game.play('p1', game.players[1].hand[0].id);
  assert.equal(game.players[1].score, 1 + 2);
  assert.equal(game.gameOver, true);
  assert.deepEqual(places(game), ['p0:1', 'p1:2', 'p2:3']);
  assert.equal(game.results[2].handPoints, 3);
});

test('play till the end: finished players are skipped in turn order', () => {
  const game = makeGame(3, { mode: 'last' });
  setup(game, { top: ['red', '2'], hands: { 0: [['red', '4']], 1: [['red', '6'], ['red', '7']], 2: [['red', '8'], ['red', '9']] } });
  game.play('p0', game.players[0].hand[0].id);
  game.play('p1', game.players[1].hand[0].id);
  game.play('p2', game.players[2].hand[0].id);
  assert.equal(game.currentPlayer.id, 'p1');
});

test('play till the end: a draw card played as the last card makes the next player draw and lose the turn', () => {
  const game = makeGame(3, { mode: 'last' });
  setup(game, { top: ['red', '2'], hands: { 0: [['red', 'draw2']], 1: [['green', '1']], 2: [['green', '2']] } });
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.players[1].hand.length, 3);
  assert.equal(game.pending, null);
  assert.equal(game.currentPlayer.id, 'p2');
  assert.equal(game.gameOver, false);
});

test('first out wins: the game ends and the rest are ranked by points left in hand', () => {
  const game = makeGame(3, { mode: 'first' });
  setup(game, { top: ['red', '2'], hands: { 0: [['red', '4']], 1: [['blue', '9'], ['green', 'skip']], 2: [['green', '1']] } });
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.gameOver, true);
  assert.equal(game.players[0].score, 29 + 1);
  assert.deepEqual(places(game), ['p0:1', 'p2:2', 'p1:3']);
});

test('first out wins: equal points in hand share a place', () => {
  const game = makeGame(3, { mode: 'first' });
  setup(game, { top: ['red', '2'], hands: { 0: [['red', '4']], 1: [['blue', '5']], 2: [['green', '5']] } });
  game.play('p0', game.players[0].hand[0].id);
  assert.deepEqual(places(game), ['p0:1', 'p1:2', 'p2:2']);
});

test('an unknown game mode is rejected', () => {
  assert.throws(() => makeGame(2, { mode: 'sudden-death' }), /Unknown game mode/);
});

test('card point values match the rules', () => {
  assert.equal(cardPoints(card('red', '7')), 7);
  assert.equal(cardPoints(card('red', 'reverse')), 20);
  assert.equal(cardPoints(card('wild', 'wild4')), 50);
});

test('playing the last card without calling UNO draws a penalty instead of finishing', () => {
  const game = makeGame(3);
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1']], 1: [['green', '4']], 2: [['blue', '4']] } });
  game.players[0].calledUno = false;
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.players[0].hand.length, 2);
  assert.equal(game.players[0].place, null);
  assert.equal(game.roundActive, true);
  assert.equal(game.currentPlayer.id, 'p1');
});

test('playing the last card after calling UNO finishes the player', () => {
  const game = makeGame(2, { mode: 'first' });
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1'], ['red', '2']], 1: [['green', '4']] } });
  game.play('p0', game.players[0].hand[0].id);
  game.callUno('p0');
  game.draw('p1');
  game.pass('p1');
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.gameOver, true);
  assert.equal(game.players[0].place, 1);
});

test('drawing cards cancels an earlier UNO call', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1']], 1: [['green', '4']] } });
  game.drawCards(game.players[0], 1);
  assert.equal(game.players[0].calledUno, false);
});

test('missing UNO before the next player moves means you must draw, not call UNO or go out', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1'], ['red', '2']], 1: [['red', '4'], ['green', '6']] } });
  game.play('p0', game.players[0].hand[0].id); // down to one card, no UNO
  game.play('p1', game.players[1].hand[0].id); // the next player moves: too late now
  const p0 = game.players[0];
  assert.equal(p0.missedUno, true);
  assert.equal(game.currentPlayer.id, 'p0');
  assert.throws(() => game.callUno('p0'), /Too late to call UNO/);
  assert.deepEqual(game.playableCardIds('p0'), []); // the red 2 would match, but cannot be played
  assert.throws(() => game.play('p0', p0.hand[0].id), /must draw a card/);
  assert.match(game.log.at(-2).text, /missed calling UNO/);

  game.draw('p0');
  assert.equal(p0.hand.length, 2);
  assert.equal(p0.missedUno, false);
  assert.equal(game.roundActive, true);
});

test('calling UNO before the next player moves keeps the right to go out', () => {
  const game = makeGame(2, { mode: 'first' });
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1'], ['red', '2']], 1: [['red', '4'], ['green', '6']] } });
  game.play('p0', game.players[0].hand[0].id);
  game.callUno('p0');
  game.play('p1', game.players[1].hand[0].id);
  assert.equal(game.players[0].missedUno, false);
  game.play('p0', game.players[0].hand[0].id);
  assert.equal(game.gameOver, true);
});

test('your own extra turn (a Skip with two players) does not count as missing UNO', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '9'], hands: { 0: [['red', 'skip'], ['red', '2']], 1: [['green', '4'], ['green', '6']] } });
  game.play('p0', game.players[0].hand[0].id); // Skip: p0 plays again
  assert.equal(game.currentPlayer.id, 'p0');
  game.callUno('p0'); // still allowed
  assert.equal(game.players[0].missedUno, false);
});

test('a Wild Draw Four shows the next player the colour it replaced, for the challenge', () => {
  const game = makeGame(2);
  setup(game, { top: ['green', '7'], hands: { 0: [['wild', 'wild4'], ['red', '1']], 1: [['blue', '3'], ['blue', '4']] } });
  game.play('p0', game.players[0].hand[0].id, 'blue');
  const view = game.viewFor('p1');
  assert.equal(view.challengeable, true);
  assert.deepEqual(view.pending, { kind: 'wild4', count: 4, from: 'p0', prevColor: 'green' });
});

test('with no cards left anywhere to draw, drawing passes the turn and clears a missed UNO', () => {
  const game = makeGame(2);
  setup(game, { top: ['red', '9'], hands: { 0: [['red', '1']], 1: [['green', '4'], ['green', '6']] } });
  game.drawPile = [];
  game.players[0].calledUno = false;
  game.players[0].missedUno = true;
  game.draw('p0');
  assert.equal(game.players[0].hand.length, 1);
  assert.equal(game.players[0].missedUno, false);
  assert.equal(game.currentPlayer.id, 'p1');
  assert.match(game.log.at(-1).text, /No cards left to draw/);
  assert.equal(game.log.at(-1).drew, 0);
});

test('when time runs out with a card that fits, one is played for the player instead of drawing', () => {
  const game = makeGame(3);
  setup(game, { top: ['red', '5'], hands: { 0: [['blue', '2'], ['wild', 'wild'], ['red', '9'], ['green', '1']], 1: [['red', '1'], ['red', '2']], 2: [['red', '3'], ['red', '4']] } });
  game.autoTurn();
  assert.equal(game.topCard().color, 'red');
  assert.equal(game.topCard().value, '9'); // a coloured card before the Wild
  assert.equal(game.players[0].hand.length, 3);
  assert.equal(game.currentPlayer.id, 'p1');
});

test('an automatic Wild picks the colour the player holds most of', () => {
  const game = makeGame(3);
  setup(game, { top: ['red', '5'], hands: { 0: [['wild', 'wild'], ['blue', '2'], ['blue', '7'], ['green', '1']], 1: [['red', '1'], ['red', '2']], 2: [['red', '3'], ['red', '4']] } });
  game.autoTurn();
  assert.equal(game.topCard().value, 'wild');
  assert.equal(game.currentColor, 'blue');
  assert.equal(game.players[0].hand.length, 3);
});

test('when time runs out with nothing that fits, a card is drawn for the player', () => {
  const game = makeGame(3);
  setup(game, { top: ['red', '5'], hands: { 0: [['blue', '2'], ['green', '1']], 1: [['red', '1'], ['red', '2']], 2: [['red', '3'], ['red', '4']] } });
  game.drawPile = [card('yellow', '8')];
  game.autoTurn();
  assert.equal(game.players[0].hand.length, 3);
  assert.equal(game.currentPlayer.id, 'p1');
});
