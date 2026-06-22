'use strict';

// ⛔ blocked-loss is now sourced from the WS geometry total (persisted in
// state.wsBlocked, so it survives F5), after the 1.85 corner-formula fix made the
// geometry accrual exact (a real game verified wsKept == colonist's victory).
// Order: colonist's end-game Victory value > the geometry total > the log
// differential (only before the board is ready). The not-ready test runs FIRST
// because the board's _ready flag is sticky once a full state has been applied.

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

function relayFullState() {
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameSettings: { id: 'promote-test' },
      gameState: {
        playerColor: 1,
        mapState: { tileHexStates: {}, tileCornerStates: {} },
        mechanicRobberState: { locationTileIndex: 0 },
      },
      playerUserStates: [{ selectedColor: 1, username: 'Aria' }],
    } } } },
  }));
}

test('before the WS board is ready, blockLossOf falls back to the log differential', () => {
  cst.resetState();
  cst.getPlayer('Aria', '#c00');
  cst.state.wsBlocked['Aria'] = 5;        // must be IGNORED while the board is not ready
  assert.equal(cst.blockLossOf('Aria'), 0, 'differential fallback (no block events), not the geometry total');
});

test('once the board is ready, blockLossOf returns the persisted WS geometry total', () => {
  cst.resetState();
  cst.getPlayer('Aria', '#c00');
  relayFullState();                       // board ready
  cst.state.wsBlocked['Aria'] = 5;
  assert.equal(cst.blockLossOf('Aria'), 5, 'the geometry total drives the panel');
  cst.state.wsBlocked['Aria'] = undefined; // a player with no blocks reads 0, not stale
  assert.equal(cst.blockLossOf('Aria'), 0);
});

test('colonist\'s end-game Victory value overrides the geometry total', () => {
  cst.resetState();
  cst.getPlayer('Aria', '#c00');
  relayFullState();
  cst.state.wsBlocked['Aria'] = 5;
  cst.state.endgameBlocked = { Aria: 7 };
  assert.equal(cst.blockLossOf('Aria'), 7, 'Victory exact wins over the running geometry total');
});
