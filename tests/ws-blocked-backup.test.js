'use strict';

// The WS board's blocked-loss is geometrically exact but lives only in memory and
// can't be replayed after a reload (accrueBlocked needs each past roll's robber
// position). accrueWsBlocked() mirrors its LIVE growth into a PERSISTED per-name
// total (state.wsBlocked) so a reload restores it. Display still uses the log
// estimate — this is the monitored backup, surfaced in the audit.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst } = require('./helpers/setup');
const window = global.window;

function relay(data) {
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data } },
  }));
}

// Robber on tile 7 (number 2); corner 23 is adjacent to tile 7 (verified geometry).
function openingFullState() {
  return { type: 4, payload: {
    gameState: {
      playerColor: 1,
      mapState: {
        tileHexStates: { 7: { x: 1, y: 1, type: 2, diceNumber: 2 } },
        tileCornerStates: { 23: { x: 1, y: 0, z: 1 } },   // (1,0,z1) touches (1,1)=tile 7
      },
      mechanicRobberState: { locationTileIndex: 7, isActive: true },
    },
    playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
  } };
}

test('accrueWsBlocked mirrors the board live blocked-loss into persisted state.wsBlocked', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  relay(openingFullState());                          // robber on tile 7, no buildings yet
  cst.accrueWsBlocked();                              // first sight → baseline at 0
  assert.equal(cst.state.wsBlocked['StanTheMan01'] || 0, 0, 'nothing accrued yet');

  // Settle corner 23 (adjacent to tile 7), then roll a 2 → the robber blocks it.
  relay({ type: 91, payload: { diff: { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } } } });
  relay({ type: 91, payload: { diff: { gameLogState: { '40': { text: { type: 10, playerColor: 1, firstDice: 1, secondDice: 1 } } } } } });
  cst.accrueWsBlocked();
  assert.equal(cst.state.wsBlocked['StanTheMan01'], 1, 'one card of blocked-loss captured live');
});

test('a city on the blocked tile accrues 2, and the delta keeps accumulating', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  relay(openingFullState());
  relay({ type: 91, payload: { diff: { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 2 } } } } } }); // city
  cst.accrueWsBlocked();                              // baseline at 0 (no roll yet)
  relay({ type: 91, payload: { diff: { gameLogState: { '50': { text: { type: 10, playerColor: 1, firstDice: 1, secondDice: 1 } } } } } });
  cst.accrueWsBlocked();
  assert.equal(cst.state.wsBlocked['StanTheMan01'], 2, 'a city loses 2');
});

test('state.wsBlocked persists and restores across a reload', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  cst.state.wsBlocked['StanTheMan01'] = 4;
  cst.persistState();
  cst.resetState();                                   // a reload starts fresh
  assert.equal(cst.state.wsBlocked['StanTheMan01'] || 0, 0, 'wiped by reset');
  cst.restoreState();                                 // ...then restores from storage
  assert.equal(cst.state.wsBlocked['StanTheMan01'], 4, 'restored across the reload');
});

test('the audit report shows the kept WS backup (wsKept)', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  cst.state.wsBlocked['StanTheMan01'] = 3;
  const report = cst.buildAuditReport();
  assert.match(report, /wsKept=3/, 'persisted WS blocked backup is in the audit line');
});
