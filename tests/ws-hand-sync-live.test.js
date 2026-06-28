'use strict';

// Opponent resource composition must update the INSTANT colonist broadcasts it, not
// a second later on the 1s tick. The realistic ordering is: a diff bumps the
// opponent's hand TOTAL (playerStates) before/around the production event (type-47)
// that says WHICH resource. Until the type-47 lands the gain is honestly "unknown";
// the moment it does, the WS message handler syncs immediately and the card moves
// onto its real resource — no lingering phantom unknown, no tick wait.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, relay } = require('./helpers/setup');

function fullState() {
  return { type: 4, payload: {
    gameSettings: { id: 'sync-A' },
    gameState: {
      playerColor: 1,
      mapState: { tileHexStates: {}, tileCornerStates: {} },
      mechanicRobberState: { locationTileIndex: 0 },
      playerStates: { 1: { resourceCards: { cards: [1] } }, 2: { resourceCards: { cards: [] } } },
      gameLogState: {},
    },
    playerUserStates: [{ selectedColor: 1, username: 'Stan' }, { selectedColor: 2, username: 'Mosley' }],
  } };
}

test('opponent production lands on its real resource immediately (no tick), via the WS handler', () => {
  cst.resetState();
  cst.createPanel();                 // the immediate WS-handler sync only runs when a panel exists
  relay(fullState());
  cst.getPlayer('Stan', '#c00');
  const opp = cst.getPlayer('Mosley', '#00c');

  // 1) the total jumps first (2 hidden cards) before we know what they are
  relay({ type: 91, payload: { diff: { playerStates: { 2: { resourceCards: { cards: [0, 0] } } } } } });
  assert.equal(opp.resources.ore, 0, 'no production event yet → not on ore');
  assert.equal(opp.unknown, 2, 'honestly unknown for now');

  // 2) the production broadcast arrives (gained 2 ore) — handled on the SAME message,
  //    no 1s tick: the cards move onto ore and the unknown clears.
  relay({ type: 91, payload: { diff: { gameLogState: {
    1: { text: { type: 47, playerColor: 2, cardsToBroadcast: [5, 5], distributionType: 1 } },
  } } } });
  assert.equal(opp.resources.ore, 2, 'ore now shows 2 right away (no phantom unknown)');
  assert.equal(opp.unknown, 0, 'unknown cleared');
});
