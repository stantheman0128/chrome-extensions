'use strict';

// The dice histogram migrates onto the WebSocket: board.js accrues roll counts
// from type-10 log events (authoritative — it can't miss a roll the way late-
// mounting chat rows could), and syncDiceFromWS mirrors them into state. Turn
// timing stays DOM-driven (the protocol carries no timestamps). A new
// gameSettings.id resets the board, so counts don't bleed across games.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, relay } = require('./helpers/setup');
const board = global.__cstBoard;

// Feed a full-state whose gameLogState is a list of [index, sum] rolls. Each call
// uses a fresh gameSettings.id, so the board self-resets (new game) — the WS board
// is no longer reset by the DOM resetState, only by a new id in a full state.
let gameSeq = 0;
function relayRolls(entries, rollType = 10) {
  gameSeq += 1;
  const gameLogState = {};
  for (const [idx, sum] of entries) {
    const a = Math.min(6, Math.max(1, sum - 1));   // any valid 1–6 split of the sum
    gameLogState[String(idx)] = { text: { type: rollType, firstDice: a, secondDice: sum - a } };
  }
  relay({ type: 4, payload: {
    gameSettings: { id: 'dice-game-' + gameSeq },
    gameState: { playerColor: 1, mapState: {}, playerStates: {}, gameLogState },
    playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
  } });
}

test('board accrues dice counts from type-10 events (deduped, ordered)', () => {
  cst.resetState();                       // resets state; relayRolls' fresh id resets the board
  relayRolls([[1, 8], [2, 8], [3, 5]]);
  const d = board.diceOf(cst.getWsBoard());
  assert.equal(d.counts[8], 2, 'two 8s');
  assert.equal(d.counts[5], 1, 'one 5');
  assert.equal(d.total, 3, 'three rolls total');
  assert.deepEqual(d.rolls, [8, 8, 5], 'rolls kept in order');
});

// Colonist Rush rolls the dice as type-141 (no playerColor) instead of type-10,
// carrying the same firstDice/secondDice. The histogram must count those too, or
// the Dice Rolls panel stays empty in Rush — the WS board is authoritative and
// overwrites the DOM "rolled" count via syncDiceFromWS.
test('board accrues dice from Colonist Rush type-141 events', () => {
  cst.resetState();
  relayRolls([[1, 8], [2, 5], [3, 11]], 141);
  const d = board.diceOf(cst.getWsBoard());
  assert.equal(d.total, 3, 'three Rush rolls counted');
  assert.equal(d.counts[8], 1, 'one 8');
  assert.equal(d.counts[5], 1, 'one 5');
  assert.equal(d.counts[11], 1, 'one 11');
  assert.deepEqual(d.rolls, [8, 5, 11], 'rolls in order');
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
