'use strict';

// board.js accrues Stats-section events straight from colonist's structured WS
// game log (gameLogState). Phase 1: discards (text.type 55) —
// { playerColor, cardEnums:[resId…] } → discards (events) + discardCards (total).
// Accrued from BOTH the full-state history (reconnect) and live diffs, deduped by
// the monotonic log index so a replay never double-counts.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const board = require('../colonist-stats-tracker/board.js');

const diffLog = (entries) => ({ gameLogState: entries });

test('discard (type 55) accrues discards + discardCards by color', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({
    '274': { text: { type: 55, playerColor: 2, cardEnums: [2, 3, 3, 4, 5], areResourceCards: true } },
  }));
  const s = board.statsOf(b, 2);
  assert.equal(s.discards, 1, 'one discard event');
  assert.equal(s.discardCards, 5, 'five cards discarded');
  assert.deepEqual(s.discardRes, { 2: 1, 3: 2, 4: 1, 5: 1 }, 'per-resource breakdown (resId)');
});

test('multiple discards accumulate', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({ '10': { text: { type: 55, playerColor: 1, cardEnums: [1, 1] } } }));
  board.applyDiff(b, diffLog({ '20': { text: { type: 55, playerColor: 1, cardEnums: [3, 4, 5] } } }));
  const s = board.statsOf(b, 1);
  assert.equal(s.discards, 2);
  assert.equal(s.discardCards, 5);
});

test('a replayed log index is not counted twice', () => {
  const b = board.createBoard();
  const d = diffLog({ '30': { text: { type: 55, playerColor: 1, cardEnums: [1, 2] } } });
  board.applyDiff(b, d);
  board.applyDiff(b, d);   // same frame redelivered
  const s = board.statsOf(b, 1);
  assert.equal(s.discards, 1, 'replayed entry ignored');
  assert.equal(s.discardCards, 2);
});

test('full-state history accrues discards too (reconnect completeness)', () => {
  const b = board.createBoard();
  board.applyFullState(b, {
    gameState: {
      mapState: {}, playerStates: {},
      gameLogState: { '5': { text: { type: 55, playerColor: 2, cardEnums: [1, 1, 1] } } },
    },
  });
  const s = board.statsOf(b, 2);
  assert.equal(s.discardCards, 3, 'discards recovered from the reconnect snapshot');
});

test('statsOf for an unseen color is null', () => {
  const b = board.createBoard();
  assert.equal(board.statsOf(b, 9), null);
});

test('discard accrual leaves blocked accrual untouched', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({
    '40': { text: { type: 10, playerColor: 1, firstDice: 3, secondDice: 4 } },
    '41': { text: { type: 55, playerColor: 1, cardEnums: [2] } },
  }));
  assert.equal(board.statsOf(b, 1).discardCards, 1);
  assert.equal(board.blockedLossOf(b, 1), 0, 'no robber match → no blocked');
});

test('roll production (type 47) accrues gained + per-resId gainedRes', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({
    '9': { text: { type: 47, playerColor: 2, cardsToBroadcast: [4, 1, 2], distributionType: 0 } },
  }));
  const s = board.statsOf(b, 2);
  assert.equal(s.gained, 3);
  assert.deepEqual(s.gainedRes, { 1: 1, 2: 1, 4: 1 });
});

test('Year of Plenty (type 21) also accrues gained', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({ '190': { text: { type: 21, playerColor: 1, cardEnums: [1, 1] } } }));
  const s = board.statsOf(b, 1);
  assert.equal(s.gained, 2);
  assert.deepEqual(s.gainedRes, { 1: 2 });
});

function twoPlayers() {
  const b = board.createBoard();
  board.applyFullState(b, {
    gameState: { mapState: {}, playerStates: {} },
    playerUserStates: [{ selectedColor: 1, username: 'A' }, { selectedColor: 2, username: 'B' }],
  });
  return b;
}

test('monopoly (type 86) accrues monoTook for the taker by resId', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({ '483': { text: { type: 86, playerColor: 2, amountStolen: 3, cardEnum: 3 } } }));
  assert.deepEqual(board.statsOf(b, 2).monoTook, { 3: 3 });
});

test('monopoly victim is attributed in a 2-player game', () => {
  const b = twoPlayers();
  board.applyDiff(b, diffLog({ '483': { text: { type: 86, playerColor: 2, amountStolen: 3, cardEnum: 5 } } }));
  assert.deepEqual(board.statsOf(b, 2).monoTook, { 5: 3 }, 'taker took ore×3');
  assert.deepEqual(board.statsOf(b, 1).monoLost, { 2: { 5: 3 } }, 'victim lost ore×3 to taker 2');
});

test('monopoly victim is NOT split in a 3-player game', () => {
  const b = board.createBoard();
  board.applyFullState(b, {
    gameState: { mapState: {}, playerStates: {} },
    playerUserStates: [{ selectedColor: 1, username: 'A' }, { selectedColor: 2, username: 'B' }, { selectedColor: 3, username: 'C' }],
  });
  board.applyDiff(b, diffLog({ '483': { text: { type: 86, playerColor: 2, amountStolen: 4, cardEnum: 5 } } }));
  assert.deepEqual(board.statsOf(b, 2).monoTook, { 5: 4 }, 'taker still recorded');
  assert.equal(board.statsOf(b, 1), null, 'no per-victim attribution with 3+ players');
});

// Knight steals are revealed privately to self (text.type 14 = self is the thief,
// 15 = self is the victim); cardEnums carries the single stolen card's resId. Both
// sides are known → exact for thief AND victim. Self is always involved, so these
// fully cover self's steal columns; in 2p they cover the opponent too, in 3p+ the
// opponent-vs-opponent steals never appear here (stay log/unknown).
function selfBoard(selfColor, colors) {
  const b = board.createBoard();
  board.applyFullState(b, {
    gameState: { mapState: {}, playerStates: {}, playerColor: selfColor },
    playerUserStates: (colors || [1, 2]).map((c) => ({ selectedColor: c, username: 'P' + c })),
  });
  return b;
}

test('knight steal — self as thief (type 14) credits self stole + victim lost, by resId', () => {
  const b = selfBoard(2);                        // self is colour 2
  board.applyDiff(b, diffLog({                   // self stole card 4 (grain) from colour 1
    '59': { text: { type: 14, playerColor: 1, cardEnums: [4] }, from: 2, specificRecipients: [2] },
  }));
  assert.equal(board.statsOf(b, 2).stole, 1, 'self stole one');
  assert.deepEqual(board.statsOf(b, 2).stoleRes, { 4: 1 }, 'self stole grain');
  assert.equal(board.statsOf(b, 1).lost, 1, 'victim lost one');
  assert.deepEqual(board.statsOf(b, 1).lostRes, { 4: 1 }, 'victim lost grain');
});

test('knight steal — self as victim (type 15) credits thief stole + self lost, by resId', () => {
  const b = selfBoard(2);
  board.applyDiff(b, diffLog({                   // colour 1 stole card 5 (ore) from self (colour 2)
    '83': { text: { type: 15, playerColor: 1, cardEnums: [5] }, from: 1, specificRecipients: [2] },
  }));
  assert.equal(board.statsOf(b, 1).stole, 1, 'thief stole one');
  assert.deepEqual(board.statsOf(b, 1).stoleRes, { 5: 1 }, 'thief stole ore');
  assert.equal(board.statsOf(b, 2).lost, 1, 'self lost one');
  assert.deepEqual(board.statsOf(b, 2).lostRes, { 5: 1 }, 'self lost ore');
});

test('knight steals accumulate and dedup by index', () => {
  const b = selfBoard(2);
  const d = diffLog({ '59': { text: { type: 14, playerColor: 1, cardEnums: [4] }, from: 2 } });
  board.applyDiff(b, d);
  board.applyDiff(b, d);                          // same frame redelivered
  board.applyDiff(b, diffLog({ '120': { text: { type: 14, playerColor: 1, cardEnums: [5] }, from: 2 } }));
  assert.equal(board.statsOf(b, 2).stole, 2, 'two distinct steals, replay ignored');
  assert.deepEqual(board.statsOf(b, 2).stoleRes, { 4: 1, 5: 1 });
});

test('knight steal resolves self from specificRecipients when selfColor is unset (reconnect)', () => {
  const b = board.createBoard();   // no applyFullState → b.selfColor stays null (the reconnect bug)
  board.applyDiff(b, diffLog({
    '59': { text: { type: 14, playerColor: 1, cardEnums: [4] }, from: 2, specificRecipients: [2] }, // self(2) stole grain from 1
    '83': { text: { type: 15, playerColor: 1, cardEnums: [5] }, from: 1, specificRecipients: [2] }, // 1 stole ore from self(2)
  }));
  assert.equal(board.statsOf(b, 2).stole, 1, 'self credited despite null selfColor');
  assert.deepEqual(board.statsOf(b, 2).stoleRes, { 4: 1 });
  assert.equal(board.statsOf(b, 2).lost, 1, 'self lost credited');
  assert.deepEqual(board.statsOf(b, 2).lostRes, { 5: 1 });
  assert.equal(board.statsOf(b, 1).lost, 1, 'victim credited');
  assert.equal(board.statsOf(b, 1).stole, 1, 'thief credited');
  assert.equal(b.selfColor, 2, 'selfColor self-healed from specificRecipients');
});

test('accrueLog tallies a count of every log entry by type (audit cross-check)', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({
    '1': { text: { type: 10, playerColor: 1, firstDice: 2, secondDice: 3 } },
    '2': { text: { type: 55, playerColor: 1, cardEnums: [1] } },
    '3': { text: { type: 10, playerColor: 2, firstDice: 4, secondDice: 4 } },
  }));
  assert.deepEqual(board.logTypeCountsOf(b), { 10: 2, 55: 1 });
});
