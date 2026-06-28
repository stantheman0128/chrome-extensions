'use strict';

// The Stats columns migrate onto the WS: board.js accrues per-colour event stats
// from the structured game log; content.js's syncStatsFromWS() maps them into
// state.tally by name. Phase 1 covers discards. WS-owned fields are overwritten;
// log-only fields (cards lost to knights, trades, turns) are left untouched.

const { test } = require('node:test');
const assert = require('node:assert/strict');

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
  assert.deepEqual(cst.state.tally['StanTheMan01'].discardRes, { lumber: 1, brick: 1, wool: 1 }, 'discardRes resId→name');
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

test('syncStatsFromWS maps self knight steals (14/15) to per-resource breakdown', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');   // self, colour 1
  cst.getPlayer('Spicymeat', '#285FBD');      // opponent, colour 2
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1, mapState: {}, playerStates: {},
        gameLogState: {
          '59': { text: { type: 14, playerColor: 2, cardEnums: [4] }, from: 1, specificRecipients: [1] },   // self(1) stole grain from colour 2
          '83': { text: { type: 15, playerColor: 2, cardEnums: [5] }, from: 2, specificRecipients: [1] },   // colour 2 stole ore from self(1)
        },
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }, { selectedColor: 2, username: 'Spicymeat' }],
    } } } },
  }));
  assert.equal(cst.syncStatsFromWS(), true);
  const me = cst.state.tally['StanTheMan01'];
  assert.deepEqual(me.stoleRes, { grain: 1 }, 'self stole grain (resId→name)');
  assert.deepEqual(me.lostRes, { ore: 1 }, 'self lost ore');
  // 2-player → the opponent is fully covered too (the mirror of self).
  const opp = cst.state.tally['Spicymeat'];
  assert.deepEqual(opp.lostRes, { grain: 1 }, 'opponent lost the grain self took');
  assert.deepEqual(opp.stoleRes, { ore: 1 }, 'opponent stole the ore from self');
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

test('the audit shows the WS-reconstructed opponent breakdown (recon line)', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');   // self, colour 1
  cst.getPlayer('Geneva', '#888');            // opponent, colour 4 — fresh: no prior test touched it
  // High index + a fresh colour: the board is a singleton, so seenLog/handRecon
  // persist across tests in this file (same as across games — a known limitation).
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1, mapState: {},
        playerStates: { 4: { resourceCards: { cards: [0, 0, 0] } } },                   // masked total 3
        gameLogState: { '901': { text: { type: 47, playerColor: 4, cardsToBroadcast: [1, 5] } } }, // +lumber +ore
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }, { selectedColor: 4, username: 'Geneva' }],
    } } } },
  }));
  const report = cst.buildAuditReport();
  assert.match(report, /recon:/, 'recon line present');
  assert.match(report, /recon: l1 b0 w0 g0 o1 \?1/, 'reconstructed breakdown + 1 unknown (3 total - 2 known)');
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
