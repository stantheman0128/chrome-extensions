'use strict';

// ⛔ Cards blocked, after the lossless redesign. The displayed value is the WS
// board's LIVE geometric blocked-loss (which self-resets per gameSettings.id),
// persisted by snapshotting board.blockedLoss INTO localStorage the instant a block
// lands and restored back INTO the board on reload. Source order: colonist's exact
// Victory figure > the live geometry total (only when geometry is usable) > the log
// differential. The hover is drawn from the SAME geometry so it can't disagree.
//
// These cover the edge cases an independent stress pass (Codex) flagged on the first
// promotion: pre-tick/persist-debounce F5 loss, first-baseline drop, cross-game
// carry, ready-without-geometry, game-end-before-mirror, and hover/headline mismatch.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst } = require('./helpers/setup');
const B = require('../colonist-stats-tracker/board.js');
const window = global.window;

function relay(data) {
  window.dispatchEvent(new window.MessageEvent('message', { data: { __cstWS: 'state', msg: { id: '130', data } } }));
}

// robber on tile 7 (ore, number 2); corner 23 = (1,0,z1) touches (1,1)=tile 7.
function fullState(gameId, withGeom = true) {
  return { type: 4, payload: {
    gameSettings: { id: gameId },
    gameState: {
      playerColor: 1,
      mapState: withGeom
        ? { tileHexStates: { 7: { x: 1, y: 1, type: 5, diceNumber: 2 } }, tileCornerStates: { 23: { x: 1, y: 0, z: 1 } } }
        : { tileHexStates: {}, tileCornerStates: {} },
      mechanicRobberState: { locationTileIndex: 7, isActive: true },
      gameLogState: {},
    },
    playerUserStates: [{ selectedColor: 1, username: 'Stan' }],
  } };
}

let logIdx = 100;
function placeSettlement() { relay({ type: 91, payload: { diff: { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } } } }); }
function upgradeCity() { relay({ type: 91, payload: { diff: { mapState: { tileCornerStates: { 23: { buildingType: 2 } } } } } }); }
function rollA(sum) { relay({ type: 91, payload: { diff: { gameLogState: { [++logIdx]: { text: { type: 10, firstDice: 1, secondDice: sum - 1 } } } } } }); }

function freshBoard() { Object.assign(cst.getWsBoard(), B.createBoard()); }   // a brand-new board.js instance after F5

function harness() {
  store.clear();
  cst.resetState();
  freshBoard();
}

function startGame(id) {
  relay(fullState(id));
  cst.getPlayer('Stan', '#c00');
}

// roll the robber's number → board accrues a block (the relay path also persists it)
function block() { placeSettlement(); rollA(2); }

function setDifferential(name, expected, got = 0) {
  cst.state.tally[name] = { produces: { 2: { ore: expected } } };
  cst.state.blockEvents = [{ roll: 2, res: 'ore', got: { [name]: got } }];
}

test('source order: differential before geometry is ready, live geometry once it is, Victory always wins', () => {
  harness();
  cst.getPlayer('Stan', '#c00');
  setDifferential('Stan', 3);
  assert.equal(cst.blockLossOf('Stan'), 3, 'pre-board: the log differential');

  startGame('order-A');
  block();                                         // board geometry = 1
  assert.equal(cst.blockLossOf('Stan'), 1, 'board ready: the live geometry total, not the differential');

  cst.state.endgameBlocked = { Stan: 7 };
  assert.equal(cst.blockLossOf('Stan'), 7, 'Victory exact overrides everything');
});

test('ready=true but geometry unusable keeps the differential fallback (no jump to WS zero)', () => {
  harness();
  cst.getPlayer('Stan', '#c00');
  setDifferential('Stan', 1);
  relay(fullState('shell', false));               // a type-4 shell: ready, but 0 tiles / 0 corners
  assert.equal(B.ready(cst.getWsBoard()), true);
  assert.equal(B.geomReady(cst.getWsBoard()), false, 'empty geometry is not usable');
  assert.equal(cst.blockLossOf('Stan'), 1, 'still the differential, not WS zero');
});

test('a new game id resets the displayed total immediately, without waiting on the DOM reset', () => {
  harness();
  startGame('carry-A');
  block();
  assert.equal(cst.blockLossOf('Stan'), 1);
  relay(fullState('carry-B'));                     // board self-resets by game id; resetState() NOT called yet
  assert.equal(B.blockedLossOf(cst.getWsBoard(), 1), 0, 'board B is clean');
  assert.equal(cst.blockLossOf('Stan'), 0, 'display follows the board, not the previous game');
});

test('a block survives F5 with no tick/persist window — persisted the instant it lands, restored into the board', () => {
  harness();
  startGame('f5-A');
  block();                                         // the relay path persisted board=1 synchronously
  assert.equal(cst.blockLossOf('Stan'), 1);

  // F5: in-memory state + board are wiped; localStorage survives; colonist resends the same game.
  cst.resetState();
  freshBoard();
  cst.restoreState();                              // restores the snapshot INTO the fresh board
  relay(fullState('f5-A'));                        // same id → board keeps the restored blocked-loss
  assert.equal(cst.blockLossOf('Stan'), 1, 'no loss across reload');

  block();                                         // a further block after reload
  assert.equal(cst.blockLossOf('Stan'), 2, 'continues from the restored total, never double-counts');
});

test('a city on the blocked tile loses 2, and the same roll is never counted twice on replay', () => {
  harness();
  startGame('city-A');
  placeSettlement();
  upgradeCity();                                   // corner 23 is now a city
  rollA(2);
  assert.equal(cst.blockLossOf('Stan'), 2, 'a city loses 2');
  // replay the very same roll log entry (deep re-scrape) — dedup must hold
  relay({ type: 91, payload: { diff: { gameLogState: { [logIdx]: { text: { type: 10, firstDice: 1, secondDice: 1 } } } } } });
  assert.equal(cst.blockLossOf('Stan'), 2, 'no double count');
});

test('the final block needs no later mirror — it is already live and durable at game end', () => {
  harness();
  startGame('end-A');
  block();                                         // board=1, persisted; no further tick required
  cst.onGameWon('Stan');                           // ENDED with no Victory DOM mounted
  assert.equal(cst.blockLossOf('Stan'), 1, 'the headline keeps the final block even without a Victory capture');
});

test('the hover is drawn from the geometry: never empty when there is a loss, and sums to the headline', () => {
  harness();
  startGame('hover-A');
  block();                                         // geometry: roll 2, ore, 1 card
  assert.equal(cst.blockLossOf('Stan'), 1);
  const html = cst.blockReportHTML('Stan');
  assert.notEqual(html, '', 'hover is not empty when the geometry knows a loss');
  assert.match(html, /<b>1<\/b>/, 'hover sums to the headline');

  // a LATER ordinary settlement elsewhere raising the differential must NOT inflate it
  setDifferential('Stan', 2);                       // differential would say 2; geometry stays 1
  assert.equal(cst.blockLossOf('Stan'), 1, 'headline stays event-time exact');
  assert.match(cst.blockReportHTML('Stan'), /<b>1<\/b>/, 'hover still sums to 1');
});

test('restoreBlocked refuses a legacy id-less snapshot once the board is in a game', () => {
  const b = B.createBoard();
  B.applyFullState(b, fullState('established').payload);    // board.gameId = 'established'
  B.restoreBlocked(b, { loss: { 1: 9 }, detail: {} });     // legacy blob, no gameId
  assert.equal(B.blockedLossOf(b, 1), 0, 'an id-less snapshot cannot pollute an established game');
  assert.equal(b.gameId, 'established', 'the board keeps its game id');
});

test('a Victory value with no captured game id is dropped when a new game arrives (Codex #2)', () => {
  harness();
  cst.getPlayer('Stan', '#c00');
  cst.state.endgameBlocked = { Stan: 7 };      // a previous game's exact value...
  cst.state.endgameBlockedGid = null;          // ...that was never tagged with a game id (the bug)
  assert.equal(cst.blockLossOf('Stan'), 7);

  relay(fullState('brand-new'));               // a real new game id arrives over the WS
  assert.equal(cst.state.endgameBlocked, null, 'the untagged stale Victory value is dropped');
  assert.equal(cst.blockLossOf('Stan'), 0, 'the new clean board shows 0, not the old 7');
});

test('a Victory value tagged for the current game survives a same-id reconnect', () => {
  harness();
  startGame('keep');                           // board.gameId = 'keep'
  cst.state.endgameBlocked = { Stan: 5 };
  cst.state.endgameBlockedGid = 'keep';        // tagged for THIS game
  relay(fullState('keep'));                     // reconnect (same id), not a new game
  assert.deepEqual(cst.state.endgameBlocked, { Stan: 5 }, 'a same-game reconnect keeps the Victory value');
});
