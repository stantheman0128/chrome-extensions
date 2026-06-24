'use strict';

// Opponent hands were showing phantom "?" for cards that came from PUBLIC production.
// Root cause: a dev-card buy is SILENT in colonist's game log (no event), so its cost
// (1 wool + 1 grain + 1 ore) was never deducted from the reconstructed hand. The raw
// recon over-counted, and projectRecon trimmed the excess to "unknown". colonist's
// mechanicDevelopmentCardsState carries each player's dev cards (held + played = bought),
// so the cost is now deducted exactly — keeping known cards known.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

test('a silent dev-card buy is deducted from the WS dev count, not trimmed to phantom "?"', () => {
  const b = B.createBoard();
  b.hands[2] = { cards: new Array(5).fill(0) };                       // opponent: 5 cards (masked)
  B.__setRecon(b, 2, { 1: 0, 2: 2, 3: 6, 4: 3, 5: 0, unknown: 0 });   // log-accrued: brick2 wool6 grain3 = 11
  b.devBought = { 2: 3 };                                             // colonist reports 3 dev cards bought
  const r = B.reconBreakdownOf(b, 2);
  assert.equal(B.reconSumOf(b, 2), 5, 'reconciles to the authoritative hand count');
  assert.equal(r.unknown, 0, 'the 3 buy costs are deducted exactly → no phantom unknowns');
  assert.deepEqual({ brick: r[2], wool: r[3] }, { brick: 2, wool: 3 }, 'leaving the genuinely-known cards');
});

test('without a dev count, an over-count still clamps to the hand count (inference fallback)', () => {
  const b = B.createBoard();
  b.hands[2] = { cards: new Array(5).fill(0) };
  B.__setRecon(b, 2, { 1: 0, 2: 2, 3: 6, 4: 3, 5: 0, unknown: 0 });   // same raw, but devBought empty
  assert.equal(B.reconSumOf(b, 2), 5, 'falls back to the excess-based inference, still clamped');
});

test('dev-bought = held + played, tracked across full state and diffs', () => {
  const b = B.createBoard();
  B.applyFullState(b, { gameState: {
    playerColor: 1,
    mapState: { tileHexStates: {}, tileCornerStates: {} },
    playerStates: { 1: { resourceCards: { cards: [] } }, 2: { resourceCards: { cards: [0, 0, 0] } } },
    mechanicDevelopmentCardsState: { players: {
      2: { developmentCards: { cards: [10, 10] }, developmentCardsUsed: [11] },   // 2 held + 1 used = 3
    } },
  }, playerUserStates: [{ selectedColor: 1, username: 'Me' }, { selectedColor: 2, username: 'Opp' }] });
  assert.equal(b.devBought[2], 3, 'held(2) + used(1) = 3');

  // a PLAY: held drops to 1, used rises to 2 → bought unchanged
  B.applyDiff(b, { mechanicDevelopmentCardsState: { players: { 2: { developmentCards: { cards: [10] }, developmentCardsUsed: [11, 15] } } } });
  assert.equal(b.devBought[2], 3, 'a play moves held→used; bought stays 3');

  // a BUY diff that carries ONLY the held array → used must be preserved, bought rises
  B.applyDiff(b, { mechanicDevelopmentCardsState: { players: { 2: { developmentCards: { cards: [10, 10] } } } } });
  assert.equal(b.devBought[2], 4, 'a buy bumps held → bought 4 (used preserved)');
});

test('a new game resets the dev-bought tally', () => {
  const b = B.createBoard();
  b.devBought = { 2: 3 }; b.devHeld = { 2: 1 }; b.devUsed = { 2: 2 };
  B.applyFullState(b, { gameSettings: { id: 'new' }, gameState: {
    playerColor: 1, mapState: { tileHexStates: {}, tileCornerStates: {} },
    playerStates: { 1: { resourceCards: { cards: [] } } },
  }, playerUserStates: [{ selectedColor: 1, username: 'Me' }] });
  assert.deepEqual(b.devBought, {}, 'a different gameId clears the previous game dev counts');
});
