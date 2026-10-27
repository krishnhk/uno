const test = require('node:test');
const assert = require('node:assert/strict');
const { between, winTier } = require('../public/moments.js');

const snap = (log, players = [{ id: 'a', score: 0 }, { id: 'b', score: 0 }], roundNumber = 1) => ({
  code: 'ABCD',
  game: { roundNumber, log, players },
});

test('only log entries newer than the last one seen become moments', () => {
  const before = snap([{ n: 1, meta: { kind: 'uno', by: 'a' } }]);
  const after = snap([
    { n: 1, meta: { kind: 'uno', by: 'a' } },
    { n: 2, card: { id: 'c1' }, meta: { kind: 'play', by: 'b', value: 'draw2', color: 'red', target: 'a', count: 2 } },
    { n: 3, text: 'plain line with no meta' },
  ]);
  const moments = between(before, after, 'a');
  assert.equal(moments.length, 1);
  assert.deepEqual(
    { type: moments[0].type, by: moments[0].by, value: moments[0].value, target: moments[0].target, count: moments[0].count, cardId: moments[0].cardId },
    { type: 'play', by: 'b', value: 'draw2', target: 'a', count: 2, cardId: 'c1' },
  );
  assert.equal(moments[0].mine, false);
  assert.equal(moments[0].toMe, true);
});

test('a first snapshot, another room or a new round gives no moments', () => {
  const after = snap([{ n: 1, meta: { kind: 'uno', by: 'a' } }]);
  assert.deepEqual(between(null, after, 'a'), []);
  assert.deepEqual(between({ ...after, code: 'ZZZZ' }, after, 'a'), []);
  assert.deepEqual(between(snap([], undefined, 1), snap([{ n: 1, meta: { kind: 'uno', by: 'a' } }], undefined, 2), 'a'), []);
});

test('catching someone is a "caught" moment with who and who', () => {
  const [m] = between(snap([]), snap([{ n: 1, meta: { kind: 'caught', by: 'a', target: 'b', count: 2 } }]), 'a');
  assert.equal(m.type, 'caught');
  assert.equal(m.mine, true);
  assert.equal(m.toMe, false);
});

test('game over carries the winner, their score and how big the win is', () => {
  const players = [{ id: 'a', score: 120 }, { id: 'b', score: 0 }];
  const [m] = between(snap([]), snap([{ n: 1, meta: { kind: 'gameover', winnerId: 'a', mode: 'last' } }], players), 'a');
  assert.equal(m.type, 'gameover');
  assert.equal(m.winnerScore, 120);
  assert.equal(m.tier, 3);
  assert.deepEqual(m.scores.map((s) => s.id), ['a', 'b']);
});

test('win tiers grow with the score', () => {
  assert.deepEqual([0, 39, 40, 89, 90, 149, 150, 400].map(winTier), [1, 1, 2, 2, 3, 3, 4, 4]);
});
