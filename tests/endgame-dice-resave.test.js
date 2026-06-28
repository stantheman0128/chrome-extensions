'use strict';

// resaveEndgameRecord must carry the dice histogram, not just hands/tally/blocked.
// buildGameRecord snapshots totalRolls + diceCounts, but the late-frame re-save used
// to omit them — so a dice correction that lands at ENDED (a final roll's DOM row
// mounting late, then the WS tick correcting it) would leave the archived histogram
// stale. Self-contained (no relay helper) so it doesn't collide with the shared-helper
// work in endgame-record-resave.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

const HISTORY_KEY = 'cst-history';
function mockStorage() {
  const store = { [HISTORY_KEY]: [] };
  global.chrome = {
    storage: { local: {
      get(keys, cb) { cb({ [HISTORY_KEY]: store[HISTORY_KEY] }); },
      set(obj) { Object.assign(store, obj); },
    } },
  };
  return store;
}

test('resaveEndgameRecord patches the saved dice histogram + totalRolls', () => {
  const store = mockStorage();
  cst.resetState();
  cst.state.gameStartTs = 222;
  // snapshot taken at the winner line, before a final roll's frame was reflected
  cst.saveGameRecord({
    date: 222, winner: 'Me', players: [], tally: {}, blocked: {}, blockEvents: [], blockLoss: {},
    totalRolls: 2, diceCounts: { 8: 1, 5: 1 },
  });
  assert.equal(store[HISTORY_KEY][0].totalRolls, 2, 'starts stale');

  // a late ENDED frame corrected the live dice (one more roll the archive missed)
  cst.state.totalRolls = 3;
  cst.state.diceCounts[11] = 1;

  cst.resaveEndgameRecord();
  const rec = store[HISTORY_KEY][0];
  assert.equal(rec.totalRolls, 3, 'record now carries the corrected total');
  assert.equal(rec.diceCounts[11], 1, 'and the corrected histogram');
  assert.equal(rec.diceCounts[8], 0, 'a fresh resetState histogram is the live source (no stale 8)');

  delete global.chrome;
});
