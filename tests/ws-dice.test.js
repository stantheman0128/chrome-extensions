'use strict';

// The dice histogram migrates onto the WebSocket: board.js accrues roll counts
// from type-10 log events (authoritative — it can't miss a roll the way late-
// mounting chat rows could), and syncDiceFromWS mirrors them into state. Turn
// timing stays DOM-driven (the protocol carries no timestamps). resetAccrual
// gives each new game a clean board so counts don't bleed across games.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst } = require('./helpers/setup');
const board = global.__cstBoard;
const window = global.window;

// Feed a reconnect full-state whose gameLogState is a list of [index, sum] rolls.
function relayRolls(entries) {
  const gameLogState = {};
  for (const [idx, sum] of entries) {
    const a = Math.min(6, Math.max(1, sum - 1));   // any valid 1–6 split of the sum
    gameLogState[String(idx)] = { text: { type: 10, firstDice: a, secondDice: sum - a } };
  }
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: { playerColor: 1, mapState: {}, playerStates: {}, gameLogState },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
    } } } },
  }));
}

test('board accrues dice counts from type-10 events (deduped, ordered)', () => {
  cst.resetState();                       // resetAccrual gives a clean board
  relayRolls([[1, 8], [2, 8], [3, 5]]);
  const d = board.diceOf(cst.getWsBoard());
  assert.equal(d.counts[8], 2, 'two 8s');
  assert.equal(d.counts[5], 1, 'one 5');
  assert.equal(d.total, 3, 'three rolls total');
  assert.deepEqual(d.rolls, [8, 8, 5], 'rolls kept in order');
});

test('syncDiceFromWS mirrors the WS dice into state', () => {
  cst.resetState();
  relayRolls([[1, 6], [2, 6], [3, 6], [4, 9]]);
  assert.equal(cst.syncDiceFromWS(), true, 'something changed');
  assert.equal(cst.state.diceCounts[6], 3, 'three 6s in state');
  assert.equal(cst.state.diceCounts[9], 1, 'one 9');
  assert.equal(cst.state.totalRolls, 4, 'total rolls');
  assert.deepEqual(cst.state.rollHistory, [6, 6, 6, 9], 'roll strip in order');
});

test('resetAccrual zeroes the board dice for a new game', () => {
  cst.resetState();
  relayRolls([[1, 4], [2, 10]]);
  assert.equal(board.diceOf(cst.getWsBoard()).total, 2, 'accrued before reset');
  board.resetAccrual(cst.getWsBoard());
  const d = board.diceOf(cst.getWsBoard());
  assert.equal(d.total, 0, 'total zeroed');
  assert.deepEqual(d.rolls, [], 'rolls cleared');
  assert.equal(board.diceOf(cst.getWsBoard()).counts[4] || 0, 0, 'counts cleared');
});
