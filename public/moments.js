// Turns two consecutive room snapshots into the "moments" that happened between them, in order,
// read from the game log entries the server added (each carries a `meta` description and a number `n`).
// Sounds and animations both react to these, so they always agree on what just happened.
// Works as a browser script (window.Moments) and under require() for tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Moments = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** How big a win is, from the points the winner scored: 1 (nice) to 4 (legendary). */
  function winTier(score) {
    if (score >= 150) return 4;
    if (score >= 90) return 3;
    if (score >= 40) return 2;
    return 1;
  }

  /**
   * Moments between two snapshots of the same room (empty when there is nothing to compare, so a first join
   * or a reconnect is silent). Each moment is a plain object:
   *   { type: 'play',   by, value, color, target?, count?, stacked?, cardId?, mine, toMe }
   *       value: '0'..'9' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'; color: the colour now in play;
   *       target/count: who must take how many cards (draw2, wild4) or who is skipped (skip)
   *   { type: 'take',   by, count }                 someone takes cards (a penalty, or a challenge lost)
   *   { type: 'draw',   by, count: 1 }              someone draws one card
   *   { type: 'uno',    by }                        someone called UNO
   *   { type: 'caught', by, target, count }         caught without UNO ("gotcha"); by is null if they went out without calling
   *   { type: 'challenge', by, target, count, right }
   *   { type: 'out',    by, place, points }         someone got rid of all their cards
   *   { type: 'gameover', winnerId, mode, winnerScore, tier, scores: [{ id, score }] }
   * `mine` is true when you made the move, `toMe` when you are the one it lands on.
   */
  function between(prev, next, youId) {
    const pg = prev?.game;
    const ng = next?.game;
    if (!pg || !ng || prev.code !== next.code || pg.roundNumber !== ng.roundNumber) return [];
    const lastSeen = pg.log?.length ? pg.log[pg.log.length - 1].n ?? 0 : 0;
    const moments = [];
    for (const entry of ng.log ?? []) {
      if (!entry.meta || (entry.n ?? 0) <= lastSeen) continue;
      const m = { ...entry.meta };
      if (m.kind === 'play') {
        m.type = 'play';
        m.cardId = entry.card?.id ?? null;
      } else {
        m.type = m.kind;
      }
      delete m.kind;
      if (m.type === 'gameover') {
        const scores = ng.players.map((p) => ({ id: p.id, score: p.score })).sort((a, b) => b.score - a.score);
        m.scores = scores;
        m.winnerScore = ng.players.find((p) => p.id === m.winnerId)?.score ?? scores[0]?.score ?? 0;
        m.tier = winTier(m.winnerScore);
      }
      m.mine = m.by === youId;
      m.toMe = m.target === youId || (m.type === 'take' && m.by === youId);
      moments.push(m);
    }
    return moments;
  }

  return { between, winTier };
});
