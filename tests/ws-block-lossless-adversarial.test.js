'use strict';

// Independent adversarial verification for the 1.90 blocked-loss redesign.
// This file intentionally does not reuse tests/ws-blocked-loss.test.js helpers.
// It attacks ordering boundaries: synchronous persistence, restore/full-state
// order, game-id mismatch, incomplete geometry, replay dedup, and exact geometry
// detail for headline + hover.

const { test, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');

const STATE_KEY = 'colonist-stats-tracker:game';
const store = new Map();
global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { cst, document, relay } = require('./helpers/setup');
const B = require('../colonist-stats-tracker/board.js');

// Keep the unrelated 600ms general-state debounce deterministic. Block snapshots
// themselves are expected to persist synchronously in the WS listener.
const realSetTimeout = global.setTimeout;
const delayed = [];
global.setTimeout = (fn, delay, ...args) => {
  if (delay === 600) {
    const token = { fn, args };
    delayed.push(token);
    return token;
  }
  return realSetTimeout(fn, delay, ...args);
};

function flushDelayed() {
  while (delayed.length) {
    const timer = delayed.shift();
    timer.fn(...timer.args);
  }
}

afterEach(() => flushDelayed());
after(() => { global.setTimeout = realSetTimeout; });

let logIndex = 500;

function basicFullState(gameId, geometry = 'complete') {
  let mapState;
  if (geometry === 'empty') {
    mapState = { tileHexStates: {}, tileCornerStates: {} };
  } else if (geometry === 'partial') {
    // Non-empty but unusable for this player's real board: geomReady() currently
    // accepts it even though a classic board snapshot must contain 19/54.
    mapState = {
      tileHexStates: { 99: { x: 9, y: 9, type: 5, diceNumber: 6 } },
      tileCornerStates: { 99: { x: 9, y: 9, z: 0 } },
    };
  } else {
    mapState = {
      tileHexStates: {
        7: { x: 1, y: 1, type: 5, diceNumber: 2 },
        8: { x: 4, y: 1, type: 0, diceNumber: 0 },
      },
      tileCornerStates: { 23: { x: 1, y: 0, z: 1 } },
    };
  }
  return { type: 4, payload: {
    gameSettings: { id: gameId },
    gameState: {
      mapState,
      mechanicRobberState: { locationTileIndex: 7, isActive: true },
      gameLogState: {},
    },
    playerUserStates: [{ selectedColor: 1, username: 'Stan' }],
  } };
}

function geometryFullState(gameId) {
  return { type: 4, payload: {
    gameSettings: { id: gameId },
    gameState: {
      mapState: {
        // Two distant ore-6 tiles plus a desert. The first has a settlement; the
        // second has a city. This distinguishes robber tile identity from merely
        // matching the same number/resource.
        tileHexStates: {
          1: { x: 0, y: 0, type: 5, diceNumber: 6 },
          2: { x: 3, y: 0, type: 5, diceNumber: 6 },
          3: { x: 6, y: 0, type: 0, diceNumber: 0 },
        },
        tileCornerStates: {
          1: { x: 0, y: 0, z: 0, owner: 1, buildingType: 1 },
          2: { x: 3, y: 0, z: 0, owner: 1, buildingType: 2 },
        },
      },
      mechanicRobberState: { locationTileIndex: 1, isActive: true },
      gameLogState: {},
    },
    playerUserStates: [{ selectedColor: 1, username: 'Stan' }],
  } };
}

function freshBoard() {
  Object.assign(cst.getWsBoard(), B.createBoard());
}

function harness() {
  flushDelayed();
  store.clear();
  cst.resetState();
  freshBoard();
  document.body.innerHTML = '';
}

function start(gameId, full = basicFullState(gameId)) {
  relay(full);
  cst.getPlayer('Stan', '#c00');
}

function placeSettlement() {
  relay({ type: 91, payload: { diff: {
    mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } },
  } } });
}

function roll(sum, index = ++logIndex) {
  relay({ type: 91, payload: { diff: {
    gameLogState: {
      [index]: { text: { type: 10, playerColor: 1, firstDice: 1, secondDice: sum - 1 } },
    },
  } } });
  return index;
}

function moveRobber(tileIndex) {
  relay({ type: 91, payload: { diff: {
    mechanicRobberState: { locationTileIndex: tileIndex },
  } } });
}

function blockOnce() {
  placeSettlement();
  roll(2);
}

function setDifferential(name, expected, got = 0) {
  cst.state.tally[name] = { produces: { 2: { ore: expected } } };
  cst.state.blockEvents = [{ roll: 2, res: 'ore', got: { [name]: got } }];
}

function storedBoardSnapshot() {
  const saved = JSON.parse(store.get(STATE_KEY));
  return saved && saved.wsBlockedBoard;
}

function hoverCards(html) {
  // The cards-lost figure leads each line as <b>N</b> (the header uses <b style=…> so it
  // never matches); the Victory-override single total is <b>N</b> too.
  let total = 0;
  const re = /<b>(\d+)<\/b>/g;
  let match;
  while ((match = re.exec(html))) total += Number(match[1]);
  return total;
}

test('1 GREEN: block is live and durable before any tick, then survives F5 of the same game', () => {
  harness();
  start('f5-lossless');
  blockOnce();

  assert.equal(cst.blockLossOf('Stan'), 1, 'headline reads the board immediately');
  const snap = storedBoardSnapshot();
  assert.equal(snap.gameId, 'f5-lossless');
  assert.equal(snap.loss[1], 1, 'listener synchronously persisted the loss');
  assert.deepEqual(snap.detail[1]['2|5'], { roll: 2, res: 5, times: 1, cards: 1 });

  cst.resetState();
  freshBoard();
  cst.restoreState();
  relay(basicFullState('f5-lossless'));

  assert.equal(cst.blockLossOf('Stan'), 1);
  assert.equal(hoverCards(cst.blockReportHTML('Stan')), 1, 'detail survives with the total');
});

test('2 GREEN: game end needs no tick or Victory DOM to retain the final block', () => {
  harness();
  start('instant-end');
  blockOnce();
  cst.onGameWon('Stan');
  assert.equal(cst.blockLossOf('Stan'), 1);
  assert.equal(storedBoardSnapshot().loss[1], 1);
});

test('3 GREEN: replaying the identical roll log index changes neither total nor detail', () => {
  harness();
  start('dedup');
  placeSettlement();
  const index = roll(2);
  const firstSnap = JSON.stringify(B.blockedSnapshot(cst.getWsBoard()));

  roll(2, index);
  assert.equal(cst.blockLossOf('Stan'), 1);
  assert.equal(JSON.stringify(B.blockedSnapshot(cst.getWsBoard())), firstSnap);
  assert.deepEqual(B.blockedDetailOf(cst.getWsBoard(), 1)['2|5'], {
    roll: 2, res: 5, times: 1, cards: 1,
  });
});

test('4 GREEN: a new game id clears headline and hover before resetState runs', () => {
  harness();
  start('switch-A');
  blockOnce();
  assert.equal(cst.blockLossOf('Stan'), 1);

  relay(basicFullState('switch-B'));
  assert.equal(cst.getWsBoard().gameId, 'switch-B');
  assert.equal(cst.blockLossOf('Stan'), 0);
  assert.equal(cst.blockReportHTML('Stan'), '');
});

test('5 GREEN: an empty type-4 shell keeps the differential fallback', () => {
  harness();
  cst.getPlayer('Stan', '#c00');
  setDifferential('Stan', 1);
  relay(basicFullState('empty-shell', 'empty'));

  assert.equal(B.ready(cst.getWsBoard()), true);
  assert.equal(B.geomReady(cst.getWsBoard()), false);
  assert.equal(cst.blockLossOf('Stan'), 1);
});

test('6 GREEN: hover shares geometry with headline and ignores later differential inflation', () => {
  harness();
  start('same-source');
  blockOnce();
  assert.equal(cst.blockLossOf('Stan'), 1);
  assert.equal(hoverCards(cst.blockReportHTML('Stan')), 1);

  setDifferential('Stan', 4); // later settlements/cities make the old oracle claim 4
  assert.equal(cst.blockLossOf('Stan'), 1);
  assert.equal(hoverCards(cst.blockReportHTML('Stan')), 1);
});

test('7 GREEN: exact tile identity, city x2, same-number resource, and robber movement are correct', () => {
  harness();
  start('geometry', geometryFullState('geometry'));

  roll(6);                                    // robber tile 1: settlement loses 1
  assert.equal(cst.blockLossOf('Stan'), 1);

  moveRobber(2);
  roll(6);                                    // same number/resource, tile 2: city loses 2
  assert.equal(cst.blockLossOf('Stan'), 3);

  moveRobber(3);                              // desert, not a producing tile
  roll(6);
  assert.equal(cst.blockLossOf('Stan'), 3, 'moving off both ore tiles stops accrual');
  assert.deepEqual(B.blockedDetailOf(cst.getWsBoard(), 1)['6|5'], {
    roll: 6, res: 5, times: 2, cards: 3,
  });
  assert.equal(hoverCards(cst.blockReportHTML('Stan')), 3);
});

test('8a GREEN: restore before same-game full state retains total and detail', () => {
  harness();
  start('restore-same');
  blockOnce();

  cst.resetState();
  freshBoard();
  cst.restoreState();                          // board has snapshot but no geometry yet
  assert.equal(cst.getWsBoard().gameId, 'restore-same');
  assert.equal(B.ready(cst.getWsBoard()), false);
  relay(basicFullState('restore-same'));        // same id keeps restored accrual

  assert.equal(cst.blockLossOf('Stan'), 1);
  assert.equal(hoverCards(cst.blockReportHTML('Stan')), 1);
});

test('8b GREEN: restore before a different-game full state is cleared by that full state', () => {
  harness();
  start('restore-old');
  blockOnce();

  cst.resetState();
  freshBoard();
  cst.restoreState();                          // old id/loss restored first
  relay(basicFullState('restore-new'));         // different id must reset it

  assert.equal(cst.getWsBoard().gameId, 'restore-new');
  assert.equal(cst.blockLossOf('Stan'), 0);
  assert.equal(cst.blockReportHTML('Stan'), '');
});

test('8c RED: a late old-game restore must not overwrite a different full state already applied', () => {
  harness();
  start('late-old');
  blockOnce();                                 // durable old snapshot = 1

  cst.resetState();
  freshBoard();
  relay(basicFullState('late-new'));            // new game is already authoritative
  assert.equal(cst.getWsBoard().gameId, 'late-new');
  cst.restoreState();                           // current restoreBlocked unconditionally writes old id/loss

  assert.equal(cst.getWsBoard().gameId, 'late-new',
    'restore must reject a snapshot whose id differs from an already-loaded board');
  assert.equal(cst.blockLossOf('Stan'), 0);
});

test('NEW RED: non-empty but incomplete geometry must not disable a known differential value', () => {
  harness();
  cst.getPlayer('Stan', '#c00');
  setDifferential('Stan', 1);
  relay(basicFullState('partial-shell', 'partial'));

  assert.equal(B.geomReady(cst.getWsBoard()), false,
    'one tile and one corner are non-empty, but not a complete Colonist board');
  assert.equal(cst.blockLossOf('Stan'), 1);
});

test('NEW RED: a new game id must suppress the previous game Victory override immediately', () => {
  harness();
  start('victory-old');
  blockOnce();
  cst.state.endgameBlocked = { Stan: 7 };         // previous game's captured exact value
  assert.equal(cst.blockLossOf('Stan'), 7);

  relay(basicFullState('victory-new'));            // board knows this is a new, clean game
  assert.equal(B.blockedLossOf(cst.getWsBoard(), 1), 0);
  assert.equal(cst.blockLossOf('Stan'), 0,
    'a game-scoped Victory value must not outrank a different board game id');
});

test('NEW RED: if Victory corrects the headline, hover must not remain on a different sum', () => {
  harness();
  start('victory-detail');
  blockOnce();                                     // board headline/detail = 1
  cst.state.endgameBlocked = { Stan: 2 };          // authoritative correction

  assert.equal(cst.blockLossOf('Stan'), 2);
  assert.equal(hoverCards(cst.blockReportHTML('Stan')), 2,
    'the hover still comes from board detail even though headline switched to Victory');
});
