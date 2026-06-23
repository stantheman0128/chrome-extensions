'use strict';

// Codex pass-9: the single-writer guard was GLOBAL ("board is ready") — which froze the
// DOM path for any player the board can't actually supply a count for (no colour mapping,
// or a masked hand with a null handCount), leaving them persistently UNDER-counted while
// syncFromWS skipped them too. Ownership is now decided PER PLAYER. Separately, the
// Victory record now snapshots WS-authoritative values so a transient DOM double-count
// can't be frozen into history.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');
const B = require('../colonist-stats-tracker/board.js');
const window = global.window;

function relay(data) {
  window.dispatchEvent(new window.MessageEvent('message', { data: { __cstWS: 'state', msg: { id: '130', data } } }));
}

function readyBoard(selfCards) {
  relay({ type: 4, payload: {
    gameSettings: { id: 'pp' },
    gameState: {
      playerColor: 1,
      mapState: { tileHexStates: {}, tileCornerStates: {} },
      playerStates: { 1: { resourceCards: { cards: selfCards } } },   // colour 4 omitted → null handCount
    },
    playerUserStates: [{ selectedColor: 1, username: 'Me' }, { selectedColor: 4, username: 'Opp' }],
  } });
}

test('per-player single-writer: WS owns a tracked player, the DOM stays live for one it cannot supply', () => {
  cst.resetState();
  readyBoard([1, 1]);                                  // self holds 2 lumber → handCount 2
  const b = cst.getWsBoard();
  assert.equal(B.ready(b), true, 'board is the authoritative source');
  assert.equal(B.handCountOf(b, 1), 2, 'self (colour 1) has an authoritative count');
  assert.equal(B.handCountOf(b, 4), null, 'colour 4 is named but has no hand → null count');

  const me = cst.getPlayer('Me', '#c00');
  me.resources.wool = 0;
  cst.giveResource(me, 'wool', 2);
  assert.equal(me.resources.wool, 0, 'WS owns Me → the DOM give is skipped (no double-count)');

  const opp = cst.getPlayer('Opp', '#08f');
  opp.resources.wool = 0;
  cst.giveResource(opp, 'wool', 2);
  assert.equal(opp.resources.wool, 2, 'WS cannot supply Opp → the DOM stays live (no under-count)');
  cst.takeResource(opp, 'wool', 1);
  assert.equal(opp.resources.wool, 1, 'and the DOM take still applies for the un-owned player');
});

test('buildGameRecord snapshots WS-authoritative hands, not a stale DOM value', () => {
  cst.resetState();
  readyBoard([1, 1, 2]);                               // self: 2 lumber, 1 brick
  const me = cst.getPlayer('Me', '#c00');
  me.resources.lumber = 99;                            // a stale / doubled DOM value
  const rec = cst.buildGameRecord('Me');
  const meRec = rec.players.find((p) => p.name === 'Me');
  assert.equal(meRec.hand.lumber, 2, 'the record re-syncs from WS before snapshotting (not the stale 99)');
  assert.equal(meRec.hand.brick, 1, 'and carries the exact WS breakdown');
});
