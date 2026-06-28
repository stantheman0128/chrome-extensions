'use strict';

// Codex pass-11 follow-up: a late BLOCKED roll after the winner line raises the board's
// geometric blocked-loss; the archived record's blockLoss must catch up too (1.110/1.112
// re-save), not just the live panel. Geometry harness mirrors ws-blocked-loss.test.js:
// robber on tile 7 (number 2), corner 23 a settlement that touches it → a roll of 2 is a
// blocked loss of 1.

const lstore = new Map();
global.localStorage = {
  getItem: (k) => (lstore.has(k) ? lstore.get(k) : null),
  setItem: (k, v) => lstore.set(k, String(v)),
  removeItem: (k) => lstore.delete(k),
};

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, relay } = require('./helpers/setup');
const B = require('../colonist-stats-tracker/board.js');

const HISTORY_KEY = 'cst-history';

function mockChrome() {
  const store = { [HISTORY_KEY]: [] };
  global.chrome = { storage: { local: {
    get(keys, cb) { cb({ [HISTORY_KEY]: store[HISTORY_KEY] }); },
    set(obj) { Object.assign(store, obj); },
  } } };
  return store;
}

function fullState(id) {
  return { type: 4, payload: {
    gameSettings: { id },
    gameState: {
      playerColor: 1,
      mapState: { tileHexStates: { 7: { x: 1, y: 1, type: 5, diceNumber: 2 } }, tileCornerStates: { 23: { x: 1, y: 0, z: 1 } } },
      mechanicRobberState: { locationTileIndex: 7, isActive: true },
      gameLogState: {},
    },
    playerUserStates: [{ selectedColor: 1, username: 'Stan' }],
  } };
}
let logIdx = 300;
function placeSettlement() { relay({ type: 91, payload: { diff: { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } } } }); }
function rollA(sum) { relay({ type: 91, payload: { diff: { gameLogState: { [++logIdx]: { text: { type: 10, firstDice: 1, secondDice: sum - 1 } } } } } }); }

test('a late blocked roll raises the archived blockLoss, not just the live panel', () => {
  const hist = mockChrome();
  lstore.clear();
  cst.resetState();
  Object.assign(cst.getWsBoard(), B.createBoard());   // a fresh board.js instance
  cst.createPanel();
  cst.startNextGame();                                 // PLAYING lifecycle so onGameWon runs
  relay(fullState('bg1'));
  cst.getPlayer('Stan', '#c00');
  placeSettlement();                                   // Stan's settlement touches the robbed tile
  cst.state.gameStartTs = 95000;
  cst.onGameWon('Stan');                               // archive blockLoss = 0 (no block rolled yet)
  cst.resaveEndgameRecord();
  let rec = hist[HISTORY_KEY].find((g) => g.date === 95000);
  assert.equal(rec.blockLoss.Stan || 0, 0, 'no block at the winner line');

  rollA(2);                                            // a LATE roll of the robber's number → blocked
  assert.equal(cst.getEndgameRecordDirty(), true, 'the blocked frame re-flagged the record');
  cst.resaveEndgameRecord();
  rec = hist[HISTORY_KEY].find((g) => g.date === 95000);
  assert.equal(rec.blockLoss.Stan, 1, 'the archived blockLoss caught up to the late block');

  delete global.chrome;
});
