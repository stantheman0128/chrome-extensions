'use strict';

// F5/reload must restore the live, time-ordered WS accrual instead of rebuilding it
// from a final full-state. Silent dev-card buys have no log timestamp, so rebuilding
// would charge their cost after every logged production and consume resources gained
// later (the frame-50 ore -> unknown regression).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

function emptyMap() {
  return { tileHexStates: {}, tileCornerStates: {} };
}

function devState(held, used = []) {
  return { players: { 2: { developmentCards: { cards: held }, developmentCardsUsed: used } } };
}

function fullState(gameId, log, handCount, held = []) {
  return {
    gameSettings: { id: gameId },
    gameState: {
      mapState: emptyMap(),
      playerStates: {
        1: { resourceCards: { cards: [] } },
        2: { resourceCards: { cards: new Array(handCount).fill(0) } },
      },
      gameLogState: log,
      mechanicDevelopmentCardsState: devState(held),
    },
    playerUserStates: [
      { selectedColor: 1, username: 'Me' },
      { selectedColor: 2, username: 'Opp' },
    ],
  };
}

function buildBeforeFrame50Board() {
  const b = B.createBoard();
  B.applyFullState(b, fullState('g1', {}, 0));

  // Public wool3 + grain3, followed by three silent dev-card buys. No ore is
  // currently known, so each buy charges wool/grain and floors the absent ore.
  B.applyDiff(b, {
    gameLogState: {
      1: { text: { type: 10, playerColor: 2, firstDice: 2, secondDice: 2 } },
      2: { text: { type: 47, playerColor: 2, cardsToBroadcast: [3, 3, 3, 4, 4, 4], distributionType: 1 } },
    },
    playerStates: { 2: { resourceCards: { cards: new Array(6).fill(0) } } },
  });
  B.applyDiff(b, {
    playerStates: { 2: { resourceCards: { cards: [] } } },
    mechanicDevelopmentCardsState: devState([10, 11, 12]),
  });
  return b;
}

function buildLiveFrame50Board() {
  const b = buildBeforeFrame50Board();

  // Later public ore must stay known; old buy costs must never consume it.
  B.applyDiff(b, {
    gameLogState: {
      3: { text: { type: 10, playerColor: 1, firstDice: 1, secondDice: 1 } },
      4: { text: { type: 47, playerColor: 2, cardsToBroadcast: [5, 5], distributionType: 1 } },
    },
    playerStates: { 2: { resourceCards: { cards: [0, 0] } } },
  });
  return b;
}

function reconnectFullState() {
  return fullState('g1', {
    1: { text: { type: 10, playerColor: 2, firstDice: 2, secondDice: 2 } },
    2: { text: { type: 47, playerColor: 2, cardsToBroadcast: [3, 3, 3, 4, 4, 4], distributionType: 1 } },
    3: { text: { type: 10, playerColor: 1, firstDice: 1, secondDice: 1 } },
    4: { text: { type: 47, playerColor: 2, cardsToBroadcast: [5, 5], distributionType: 1 } },
  }, 2, [10, 11, 12]);
}

test('F5 restores the live accrual before same-game full-state replay', () => {
  const live = buildLiveFrame50Board();
  const want = B.reconBreakdownOf(live, 2);
  assert.equal(want[5], 2);
  assert.equal(want.unknown, 0);

  const restored = B.createBoard();
  B.restoreAccrual(restored, B.accrualSnapshot(live));
  B.applyFullState(restored, reconnectFullState());

  assert.deepEqual(B.reconBreakdownOf(restored, 2), want);
  assert.equal(B.reconSumOf(restored, 2), 2);
  assert.deepEqual([...restored.processedLog].sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(restored.devApplied[2], 3, 'same-game reconnect does not recharge buys');
});

test('F5 restores WS stats, dice, and log counters without replay duplication', () => {
  const live = buildLiveFrame50Board();
  const restored = B.createBoard();
  // Snapshot before frame-50: the reconnect full-state must process only log 3/4
  // from the F5 gap, while retaining the already-charged devApplied count.
  B.restoreAccrual(restored, B.accrualSnapshot(buildBeforeFrame50Board()));
  B.applyFullState(restored, reconnectFullState());

  assert.deepEqual(B.reconBreakdownOf(restored, 2), B.reconBreakdownOf(live, 2));
  assert.deepEqual(B.statsOf(restored, 2), B.statsOf(live, 2));
  assert.deepEqual(B.diceOf(restored), B.diceOf(live));
  assert.deepEqual(B.logTypeCountsOf(restored), B.logTypeCountsOf(live));
});

test('a different game full-state clears a restored old-game accrual', () => {
  const old = buildLiveFrame50Board();
  const restored = B.createBoard();
  B.restoreAccrual(restored, B.accrualSnapshot(old));
  B.applyFullState(restored, fullState('g2', {}, 0));

  assert.equal(restored.gameId, 'g2');
  assert.deepEqual(restored.handRecon, {});
  assert.deepEqual([...restored.processedLog], []);
  assert.deepEqual(restored.wsStats, {});
  assert.deepEqual(B.diceOf(restored), { counts: {}, total: 0, rolls: [] });
  assert.equal(restored.devApplied[2] || 0, 0);
});

test('restoreAccrual refuses to overwrite an already-loaded different game', () => {
  const snap = B.accrualSnapshot(buildLiveFrame50Board());
  const current = B.createBoard();
  B.applyFullState(current, fullState('g2', {}, 0));
  B.restoreAccrual(current, snap);

  assert.equal(current.gameId, 'g2');
  assert.deepEqual(current.handRecon, {});
  assert.deepEqual([...current.processedLog], []);
});

let contentHarness;
function getContentHarness() {
  if (contentHarness) return contentHarness;
  const store = new Map();
  global.localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  contentHarness = { cst: require('./helpers/setup').cst, store };
  return contentHarness;
}

test('content persistence stores and restores accrualBoard without marking geometry ready', () => {
  const { cst, store } = getContentHarness();
  const key = 'colonist-stats-tracker:game';
  store.clear();
  cst.resetState();
  cst.getPlayer('Opp', '#888');

  const ws = cst.getWsBoard();
  Object.assign(ws, B.createBoard());
  const liveSnap = B.accrualSnapshot(buildLiveFrame50Board());
  B.restoreAccrual(ws, liveSnap);
  cst.persistState();

  const saved = JSON.parse(store.get(key));
  assert.deepEqual(saved.accrualBoard, liveSnap);

  Object.assign(ws, B.createBoard());
  cst.restoreState();
  assert.equal(B.ready(ws), false, 'restoring accrual does not fake geometry readiness');
  assert.deepEqual(B.accrualSnapshot(ws), liveSnap);
});

test('content restore accepts an old persisted blob without accrualBoard', () => {
  const { cst, store } = getContentHarness();
  const key = 'colonist-stats-tracker:game';
  store.set(key, JSON.stringify({
    players: [{ name: 'Opp', color: '#888', unknown: 0, resources: {} }],
  }));
  assert.doesNotThrow(() => cst.restoreState());
});
