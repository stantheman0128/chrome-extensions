'use strict';

// Opponent hand reconstruction from the WS gameLogState. board.js maintains a
// per-colour reconstructed hand (handRecon {1..5, unknown}) fed by event handlers
// and reconciled against colonist's authoritative total (handCountOf). Reload-proof
// via the existing history replay. Spec:
// docs/superpowers/specs/2026-06-21-opponent-hand-ws-reconstruction-design.md

const { test } = require('node:test');
const assert = require('node:assert/strict');
const board = require('../colonist-stats-tracker/board.js');

const diffLog = (entries) => ({ gameLogState: entries });

// ---- Task 1: reconcile-to-total core ----

test('reconcile pads unknown when the known sum is below the WS total', () => {
  const b = board.createBoard();
  b.hands[2] = { cards: [0, 0, 0, 0, 0] };           // WS total = 5, masked opponent
  board.__setRecon(b, 2, { 1: 2 });                  // we only know 2 lumber  assert.deepEqual(board.reconBreakdownOf(b, 2), { 1: 2, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 3 });
});

test('reconcile treats an unexplained -3 as a dev-card buy (deduct 1 wool 1 grain 1 ore)', () => {
  const b = board.createBoard();
  b.hands[2] = { cards: [0, 0] };                          // WS total 2 (the buyer's −3)
  board.__setRecon(b, 2, { 1: 2, 3: 1, 4: 1, 5: 1 });     // sum 5: 2 lumber + 1 wool/grain/ore
  assert.deepEqual(board.reconBreakdownOf(b, 2), { 1: 2, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 }, 'spent the dev cost, kept the lumber');
});

test('a dev-card buy deducts from unknown when the spent resource is not yet known', () => {
  const b = board.createBoard();
  b.hands[2] = { cards: [0, 0, 0] };                       // WS total 3
  board.__setRecon(b, 2, { 3: 1, unknown: 5 });           // sum 6: 1 wool known + 5 unknown
  const r = board.reconBreakdownOf(b, 2);
  assert.equal(r[3], 0, 'wool came off the known holding');
  assert.equal(r.unknown, 3, 'grain + ore came off unknown (5 - 2)');
});

// ---- Task 2: production (47) + Year of Plenty (21) ----
test('production (47) and YoP (21) add resIds to handRecon', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({
    '9': { text: { type: 47, playerColor: 3, cardsToBroadcast: [1, 1, 5], distributionType: 0 } },
    '10': { text: { type: 21, playerColor: 3, cardEnums: [4, 4] } },
  }));
  const r = board.reconBreakdownOf(b, 3);
  assert.equal(r[1], 2); assert.equal(r[5], 1); assert.equal(r[4], 2);
});

// ---- Task 3: bank trade (116) + player trade (115) ----
test('bank trade (116) deducts given, adds received', () => {
  const b = board.createBoard();
  board.__setRecon(b, 4, { 3: 4 });
  board.applyDiff(b, diffLog({ '5': { text: { type: 116, playerColor: 4, givenCardEnums: [3, 3, 3, 3], receivedCardEnums: [1] } } }));
  const r = board.reconBreakdownOf(b, 4);
  assert.equal(r[3], 0); assert.equal(r[1], 1);
});

test('player trade (115) moves cards both ways', () => {
  const b = board.createBoard();
  board.__setRecon(b, 2, { 5: 1 }); board.__setRecon(b, 4, { 2: 1 });
  board.applyDiff(b, diffLog({ '7': { text: { type: 115, playerColor: 2, acceptingPlayerColor: 4, givenCardEnums: [5], receivedCardEnums: [2] } } }));
  assert.deepEqual(board.reconBreakdownOf(b, 2), { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0, unknown: 0 });
  assert.deepEqual(board.reconBreakdownOf(b, 4), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, unknown: 0 });
});

// ---- Task 4: discard (55) + build cost (5) ----
test('discard (55) removes cardEnums from handRecon', () => {
  const b = board.createBoard();
  board.__setRecon(b, 1, { 1: 1, 3: 1, 5: 2 });
  board.applyDiff(b, diffLog({ '3': { text: { type: 55, playerColor: 1, cardEnums: [1, 3, 5, 5] } } }));
  assert.deepEqual(board.reconBreakdownOf(b, 1), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 });
});

test('build (5) deducts cost by pieceEnum: 0 road, 2 settlement, 3 city', () => {
  const b = board.createBoard();
  board.__setRecon(b, 1, { 1: 1, 2: 1, 3: 1, 4: 3, 5: 3 });
  board.applyDiff(b, diffLog({ '4': { text: { type: 5, playerColor: 1, pieceEnum: 0, isVp: false } } })); // road -1L -1B
  board.applyDiff(b, diffLog({ '8': { text: { type: 5, playerColor: 1, pieceEnum: 3, isVp: true } } }));  // city -2G -3O
  assert.deepEqual(board.reconBreakdownOf(b, 1), { 1: 0, 2: 0, 3: 1, 4: 1, 5: 0, unknown: 0 });
});

// ---- back-deduction: a spend resolves unknown cards ----
test('building a city proves the unknowns were ore (resolve + spend)', () => {
  const b = board.createBoard();
  board.__setRecon(b, 1, { 4: 2, unknown: 3 });   // 2 grain + 3 unknown
  board.applyDiff(b, diffLog({ '5': { text: { type: 5, playerColor: 1, pieceEnum: 3, isVp: true } } })); // city = 2 grain + 3 ore
  assert.deepEqual(board.reconBreakdownOf(b, 1), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 }, 'the 3 unknown could only have been the ore the city needed');
});

test('a known-resource cost resolves partly from unknown when not held as known', () => {
  const b = board.createBoard();
  board.__setRecon(b, 1, { unknown: 3 });          // 3 unknown, nothing known
  board.applyDiff(b, diffLog({ '5': { text: { type: 5, playerColor: 1, pieceEnum: 0, isVp: false } } })); // road = 1 lumber + 1 brick
  assert.deepEqual(board.reconBreakdownOf(b, 1), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 1 }, '2 of the 3 unknown were the road cost; 1 unknown remains');
});

// ---- Task 5: monopoly (86) — taker gains, each victim loses that resource ----
test('monopoly (86) gives the taker amountStolen and zeroes each victim of that resource', () => {
  const b = board.createBoard();
  board.__setRecon(b, 2, { 5: 3 }); board.__setRecon(b, 3, { 5: 2 }); board.__setRecon(b, 1, { 4: 1 });
  board.applyDiff(b, diffLog({ '9': { text: { type: 86, playerColor: 1, amountStolen: 5, cardEnum: 5 } } }));
  assert.equal(board.reconBreakdownOf(b, 1)[5], 5, 'taker +5 ore');
  assert.equal(board.reconBreakdownOf(b, 2)[5], 0, 'victim 2 loses its ore');
  assert.equal(board.reconBreakdownOf(b, 3)[5], 0, 'victim 3 loses its ore');
  assert.equal(board.reconBreakdownOf(b, 1)[4], 1, 'taker other resources untouched');
});

// ---- Task 6: self steals (14/15) into handRecon ----
test('self steal (14) and being robbed (15) move the known card in handRecon', () => {
  const b = board.createBoard();
  board.__setRecon(b, 1, { 4: 1 });           // self(1) holds grain
  board.applyDiff(b, diffLog({ '5': { text: { type: 15, playerColor: 3, cardEnums: [4] }, specificRecipients: [1] } }));
  assert.equal(board.reconBreakdownOf(b, 1)[4], 0, 'self lost the grain');
  assert.equal(board.reconBreakdownOf(b, 3)[4], 1, 'thief gained it');
  board.applyDiff(b, diffLog({ '6': { text: { type: 14, playerColor: 3, cardEnums: [2] }, specificRecipients: [1] } }));
  assert.equal(board.reconBreakdownOf(b, 1)[2], 1, 'self gained the stolen brick');
});

// ---- Task 7: reconcile wired in + reload-proof + invariant ----

test('type-16 opp steal: thief gains 1 unknown, victim loses 1 honestly (no guess)', () => {
  const b = board.createBoard();
  board.__setRecon(b, 2, { 1: 2 });            // thief: 2 lumber
  board.__setRecon(b, 4, { 1: 1, 5: 1 });      // victim: 1 lumber + 1 ore — which was taken is ambiguous
  board.applyDiff(b, {
    playerStates: { 2: { resourceCards: { cards: [0, 0, 0] } }, 4: { resourceCards: { cards: [0] } } }, // totals 3, 1
    gameLogState: { '7': { text: { type: 16, playerColorThief: 2, playerColorVictim: 4, cardBacks: [0] } } },
  });
  assert.deepEqual(board.reconBreakdownOf(b, 2), { 1: 2, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 1 }, 'thief +1 unknown');
  assert.deepEqual(board.reconBreakdownOf(b, 4), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 1 }, 'victim: the remaining card is unknown (was lumber-or-ore), not a guess');
});

test('a single-resource victim of a type-16 steal stays exact (no over-blur)', () => {
  const b = board.createBoard();
  board.__setRecon(b, 3, { 5: 2 });            // victim holds only ore → the stolen card MUST be ore
  board.applyDiff(b, {
    playerStates: { 3: { resourceCards: { cards: [0] } } },
    gameLogState: { '8': { text: { type: 16, playerColorThief: 2, playerColorVictim: 3, cardBacks: [0] } } },
  });
  assert.deepEqual(board.reconBreakdownOf(b, 3), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, unknown: 0 }, 'still exactly 1 ore');
});

test('after a diff, every player reconSum equals the WS total (invariant)', () => {
  const b = board.createBoard();
  board.applyDiff(b, {
    playerStates: { 2: { resourceCards: { cards: [0, 0, 0, 0] } }, 3: { resourceCards: { cards: [0, 0] } } },
    gameLogState: {
      '9': { text: { type: 47, playerColor: 2, cardsToBroadcast: [1, 1] } },     // +2 known, total 4 -> +2 unknown
      '10': { text: { type: 47, playerColor: 3, cardsToBroadcast: [5, 5, 5] } }, // +3 known, total 2 -> remove 1
    },
  });
  assert.equal(board.reconSumOf(b, 2), 4);
  assert.equal(board.reconSumOf(b, 3), 2);
});

test('handRecon replay is deterministic: live diffs == full-state history (reload-proof)', () => {
  const log = {
    '9': { text: { type: 47, playerColor: 2, cardsToBroadcast: [1, 1, 5] } },
    '12': { text: { type: 116, playerColor: 2, givenCardEnums: [1], receivedCardEnums: [4] } },
    '18': { text: { type: 55, playerColor: 3, cardEnums: [3] } },
    '20': { text: { type: 5, playerColor: 2, pieceEnum: 0, isVp: false } },
  };
  const live = board.createBoard();
  for (const k of Object.keys(log)) board.applyDiff(live, { gameLogState: { [k]: log[k] } });
  const reconnect = board.createBoard();
  board.applyFullState(reconnect, { gameState: { gameLogState: log } });
  for (const c of [2, 3]) assert.deepEqual(board.reconBreakdownOf(live, c), board.reconBreakdownOf(reconnect, c));
});

test('live vs replay are IDENTICAL even with a masked steal + a silent dev buy + totals', () => {
  // The scenario that broke before the read-time projection: color 2 produces 6,
  // gets robbed (masked → -1), then buys a dev card (silent -3 with no log event).
  const steps = [
    { playerStates: { 2: { resourceCards: { cards: [0, 0, 0, 0, 0, 0] } } }, gameLogState: { '5': { text: { type: 47, playerColor: 2, cardsToBroadcast: [1, 1, 3, 4, 5, 5] } } } },
    { playerStates: { 2: { resourceCards: { cards: [0, 0, 0, 0, 0] } } }, gameLogState: { '8': { text: { type: 16, playerColorThief: 3, playerColorVictim: 2, cardBacks: [0] } } } },
    { playerStates: { 2: { resourceCards: { cards: [0, 0] } } }, gameLogState: {} },   // silent -3 = dev buy
  ];
  const live = board.createBoard();
  for (const s of steps) board.applyDiff(live, s);
  const replay = board.createBoard();
  board.applyFullState(replay, { gameState: {
    playerStates: { 2: { resourceCards: { cards: [0, 0] } } },     // final total 2
    gameLogState: Object.assign({}, ...steps.map((s) => s.gameLogState)),
  } });
  assert.deepEqual(board.reconBreakdownOf(live, 2), board.reconBreakdownOf(replay, 2),
    'same events + same final total → identical breakdown whether built live or replayed');
});
