'use strict';

// The Resources table migrated onto the WebSocket: ws-inspector relays an id=130
// frame as a window 'message'; content.js's listener feeds board.js; syncFromWS
// then sets self's EXACT breakdown and reconciles each opponent's TOTAL (their
// card types are hidden in the protocol, so their inferred breakdown is kept).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, relayFullState } = require('./helpers/setup');
const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const totalOf = (p) => p.unknown + RES.reduce((s, r) => s + p.resources[r], 0);

function relayFullStateHands() {
  relayFullState({
    gameState: {
      playerColor: 1,
      mapState: {},
      playerStates: {
        1: { resourceCards: { cards: [1, 1, 4] } },       // self: 2 lumber + 1 grain
        2: { resourceCards: { cards: [0, 0, 0, 0, 0] } },  // opponent: 5 hidden
      },
    },
    playerUserStates: [
      { selectedColor: 1, username: 'StanTheMan01' },
      { selectedColor: 2, username: 'Sancho' },
    ],
  });
}

// Runs FIRST: the shared board is not ready until a full state is relayed below.
test('syncFromWS is a no-op (false) before any WS state has arrived', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  assert.equal(cst.syncFromWS(), false);
});

test('syncFromWS sets self exact breakdown and reconciles an opponent total', () => {
  cst.resetState();
  const me = cst.getPlayer('StanTheMan01', '#CF4449');
  const opp = cst.getPlayer('Sancho', '#285FBD');
  me.unknown = 3; me.resources.wool = 9;       // stale junk that must be overwritten

  relayFullStateHands();                            // the content-script listener feeds board.js

  assert.equal(cst.syncFromWS(), true, 'something changed');
  assert.equal(me.resources.lumber, 2, 'self lumber from WS (resId 1 ×2)');
  assert.equal(me.resources.grain, 1, 'self grain (resId 4)');
  assert.equal(me.resources.wool, 0, 'stale self value cleared');
  assert.equal(me.unknown, 0, 'no phantom unknown for self');
  assert.equal(totalOf(opp), 5, 'opponent total reconciled to the WS count (no recon data yet → total-only fallback)');
});

test('syncFromWS gives an opponent the WS-reconstructed breakdown, not just a total', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  const opp = cst.getPlayer('Sancho', '#285FBD');

  relayFullStateHands();                                   // opponent color 2 holds 5 hidden cards

  // The log events have let us pin 2 of Sancho's 5 cards as ore; the rest stay unknown.
  __cstBoard.__setRecon(cst.getWsBoard(), 2, { 5: 2 });

  assert.equal(cst.syncFromWS(), true, 'something changed');
  assert.equal(opp.resources.ore, 2, 'opponent ore comes from the WS reconstruction');
  assert.equal(opp.unknown, 3, 'the remaining 3 cards stay unknown (projected to the WS total of 5)');
  assert.equal(totalOf(opp), 5, 'breakdown still sums to the WS total');
});
