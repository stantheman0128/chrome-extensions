'use strict';

// Opponent hands were showing phantom "?" for cards that came from PUBLIC production.
// Root cause: a dev-card buy is SILENT in colonist's game log (no event), so its cost
// (1 wool + 1 grain + 1 ore) was never deducted from the reconstructed hand. colonist's
// mechanicDevelopmentCardsState carries each player's dev cards (held + played = bought),
// so the cost is now deducted — but ONCE, at buy time (applyDevState), NOT re-deducted at
// every read: re-deducting the lifetime total would let a cost that was unaffordable
// earlier eat resources the player publicly produces LATER (Codex frame-50 regression).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// A full state where opponent (colour 2) publicly produced `cards` (resIds) and currently
// holds `holdCount` (post-silent-buy), with `bought` dev cards reported by colonist.
function opening(cards, holdCount, bought) {
  return { gameSettings: { id: 'g' }, gameState: {
    playerColor: 1,
    mapState: { tileHexStates: {}, tileCornerStates: {} },
    playerStates: { 1: { resourceCards: { cards: [] } }, 2: { resourceCards: { cards: new Array(holdCount).fill(0) } } },
    gameLogState: { 1: { text: { type: 47, playerColor: 2, cardsToBroadcast: cards, distributionType: 1 } } },
    mechanicDevelopmentCardsState: { players: { 2: { developmentCards: { cards: new Array(bought).fill(10) }, developmentCardsUsed: [] } } },
  }, playerUserStates: [{ selectedColor: 1, username: 'Me' }, { selectedColor: 2, username: 'Opp' }] };
}

test('a silent dev-card buy is charged at buy time, not trimmed to phantom "?"', () => {
  const b = B.createBoard();
  // produced wool2 grain1 ore2 (5), bought 1 dev (−wool −grain −ore) → holds wool1 ore1 (2)
  B.applyFullState(b, opening([3, 3, 4, 5, 5], 2, 1));
  const r = B.reconBreakdownOf(b, 2);
  assert.equal(B.reconSumOf(b, 2), 2, 'reconciles to the authoritative hand count');
  assert.equal(r.unknown, 0, 'the buy cost is charged exactly → no phantom unknowns');
  assert.deepEqual({ wool: r[3], grain: r[4], ore: r[5] }, { wool: 1, grain: 0, ore: 1 }, 'one of each cost gone, the rest known');
});

test('a buy charged earlier does NOT eat ore the opponent produces publicly later (frame-50 regression)', () => {
  const b = B.createBoard();
  // snapshot: our recon only saw wool1 grain1 (we missed an ore); a silent buy charges
  // wool+grain and "owes" an ore it cannot take (ore already 0) → holds nothing.
  B.applyFullState(b, opening([3, 4], 0, 1));
  assert.equal(B.reconSumOf(b, 2), 0, 'post-buy the opponent holds nothing');

  // a LATER public production of 2 ore — the already-charged buy must NOT re-eat it.
  B.applyDiff(b, {
    gameLogState: { 2: { text: { type: 47, playerColor: 2, cardsToBroadcast: [5, 5], distributionType: 1 } } },
    playerStates: { 2: { resourceCards: { cards: [0, 0] } } },                 // handCount now 2
  });
  const r = B.reconBreakdownOf(b, 2);
  assert.equal(r[5], 2, 'both publicly-produced ore stay KNOWN');
  assert.equal(r.unknown, 0, 'not re-eaten into phantom "?"');
});

test('without a dev count, an over-count still clamps to the hand count (inference fallback)', () => {
  const b = B.createBoard();
  b.hands[2] = { cards: new Array(5).fill(0) };
  B.__setRecon(b, 2, { 1: 0, 2: 2, 3: 6, 4: 3, 5: 0, unknown: 0 });            // raw over-counts, no dev state seen
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

  // a BUY diff carrying ONLY the held array → used preserved, bought rises
  B.applyDiff(b, { mechanicDevelopmentCardsState: { players: { 2: { developmentCards: { cards: [10, 10] } } } } });
  assert.equal(b.devBought[2], 4, 'a buy bumps held → bought 4 (used preserved)');
  assert.equal(b.devApplied[2], 4, 'and every buy cost has been charged once');
});

test('a new game resets the dev-bought tally', () => {
  const b = B.createBoard();
  b.devBought = { 2: 3 }; b.devHeld = { 2: 1 }; b.devUsed = { 2: 2 }; b.devApplied = { 2: 3 };
  B.applyFullState(b, { gameSettings: { id: 'new' }, gameState: {
    playerColor: 1, mapState: { tileHexStates: {}, tileCornerStates: {} },
    playerStates: { 1: { resourceCards: { cards: [] } } },
  }, playerUserStates: [{ selectedColor: 1, username: 'Me' }] });
  assert.deepEqual(b.devBought, {}, 'a different gameId clears the previous game dev counts');
  assert.deepEqual(b.devApplied, {}, 'and the charged-cost tracker');
});
