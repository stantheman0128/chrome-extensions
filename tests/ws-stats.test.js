'use strict';

// The Stats columns migrate onto the WS: board.js accrues per-colour event stats
// from the structured game log; content.js's syncStatsFromWS() maps them into
// state.tally by name. Phase 1 covers discards. WS-owned fields are overwritten;
// log-only fields (cards lost to knights, trades, turns) are left untouched.

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

function relayDiscardHistory() {
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1, mapState: {}, playerStates: {},
        gameLogState: { '5': { text: { type: 55, playerColor: 1, cardEnums: [1, 2, 3] } } },
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
    } } } },
  }));
}

test('syncStatsFromWS returns false when no player matches a WS colour', () => {
  cst.resetState();
  cst.getPlayer('Nobody', '#888');   // not in colorToName → no WS stats
  assert.equal(cst.syncStatsFromWS(), false);
});

test('syncStatsFromWS maps discards into tally and preserves log-only fields', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  cst.state.tally['StanTheMan01'] = { lost: 3, lostTo: { Bot: 3 }, discards: 0, discardCards: 0 };

  relayDiscardHistory();             // board accrues a 3-card discard for colour 1

  assert.equal(cst.syncStatsFromWS(), true, 'something changed');
  assert.equal(cst.state.tally['StanTheMan01'].discardCards, 3, 'discardCards from WS');
  assert.equal(cst.state.tally['StanTheMan01'].discards, 1, 'one discard event');
  assert.equal(cst.state.tally['StanTheMan01'].lost, 3, 'log-only "lost" preserved');
  assert.equal(cst.state.tally['StanTheMan01'].lostTo.Bot, 3, 'log-only "lostTo" preserved');
});

test('syncStatsFromWS maps gained + gainedRes with resId→name conversion', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1, mapState: {}, playerStates: {},
        gameLogState: { '7': { text: { type: 47, playerColor: 1, cardsToBroadcast: [1, 1, 5], distributionType: 0 } } },
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
    } } } },
  }));
  assert.equal(cst.syncStatsFromWS(), true);
  assert.equal(cst.state.tally['StanTheMan01'].gained, 3, 'gained total from WS');
  assert.deepEqual(cst.state.tally['StanTheMan01'].gainedRes, { lumber: 2, ore: 1 }, 'resId→name');
});

test('syncStatsFromWS maps monopoly took/lost (resId→name, color→name)', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');   // taker (colour 1)
  cst.getPlayer('Sancho', '#285FBD');         // victim (colour 2)
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1, mapState: {}, playerStates: {},
        gameLogState: { '50': { text: { type: 86, playerColor: 1, amountStolen: 3, cardEnum: 5 } } },
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }, { selectedColor: 2, username: 'Sancho' }],
    } } } },
  }));
  assert.equal(cst.syncStatsFromWS(), true);
  assert.deepEqual(cst.state.tally['StanTheMan01'].monoTook, { ore: 3 }, 'taker took ore×3');
  assert.deepEqual(cst.state.tally['Sancho'].monoLost, { StanTheMan01: { ore: 3 } }, 'victim lost to taker by name');
});

test('blockLossOf keeps colonist endgame-exact even when the WS board under-counts (audit bug)', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  // WS board ready but its blocked accrual is 0 — the divergence the audit caught
  // (wsBoard=0 vs colonist victory=11). The WS value must NOT override the exact.
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: { playerColor: 1, mapState: {}, playerStates: {} },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
    } } } },
  }));
  cst.state.endgameBlocked = { StanTheMan01: 11 };
  assert.equal(cst.blockLossOf('StanTheMan01'), 11, 'colonist exact wins over the WS board 0');
});

test('buildAuditReport lays out WS-vs-ours hand totals and flags a mismatch', () => {
  cst.resetState();
  const me = cst.getPlayer('StanTheMan01', '#CF4449');
  me.resources.lumber = 5;                 // ours total = 5
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1, mapState: {},
        playerStates: { 1: { resourceCards: { cards: [1, 1, 4] } } },   // WS total = 3
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
    } } } },
  }));
  const report = cst.buildAuditReport();
  assert.match(report, /StanTheMan01/);
  assert.match(report, /ws=3/, 'WS hand total shown');
  assert.match(report, /ours=5/, 'our hand total shown');
  assert.match(report, /⚠/, 'mismatch flagged');
});
