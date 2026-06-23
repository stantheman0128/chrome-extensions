'use strict';

// Live geometry self-audit. colonist broadcasts the real production each roll
// (gameLog type 47), which is the ground truth. Our geometry independently
// PREDICTS who should produce what on a roll (every building on a numbered tile
// that isn't robbed). Comparing the two every roll proves our corner→tile geometry
// is correct on THIS board — and since blocked-loss uses the SAME geometry on the
// robbed tile (where the server is silent), a clean audit on the un-robbed tiles
// is the evidence that the blocked-loss is trustworthy too. Conflicts are recorded,
// not acted on (collect data first, per Stan).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// tile 7 = (1,1), number 8, ore (type 5). corner 23 = (1,0,z1) touches (1,1)=tile 7.
function fullState(gameId) {
  return { type: 4, payload: {
    gameSettings: { id: gameId },
    gameState: {
      playerColor: 1,
      mapState: {
        tileHexStates: { 7: { x: 1, y: 1, type: 5, diceNumber: 8 } },
        tileCornerStates: { 23: { x: 1, y: 0, z: 1, owner: 1, buildingType: 1 } },
      },
      // no robber → tile 7 produces; tests move it explicitly when needed
      gameLogState: {},
    },
    playerUserStates: [{ selectedColor: 1, username: 'Stan' }],
  } };
}

let idx = 100;
function roll(b, sum) {
  B.applyDiff(b, { gameLogState: { [++idx]: { text: { type: 10, firstDice: 1, secondDice: sum - 1 } } } });
}
function produce(b, color, cards) {
  B.applyDiff(b, { gameLogState: { [++idx]: { text: { type: 47, playerColor: color, cardsToBroadcast: cards } } } });
}
function moveRobber(b, tile) { B.applyDiff(b, { mechanicRobberState: { locationTileIndex: tile } }); }
function fresh(id) { const b = B.createBoard(); B.applyFullState(b, fullState(id).payload); return b; }

test('a roll whose production matches the geometry prediction is confirmed', () => {
  const b = fresh('a');
  roll(b, 8);              // geometry predicts colour 1 gets 1 ore
  produce(b, 1, [5]);      // server: colour 1 got 1 ore
  roll(b, 6);              // next roll settles the previous one
  const a = B.auditOf(b);
  assert.equal(a.confirms, 1);
  assert.equal(a.conflicts, 0);
});

test('a roll whose production disagrees with the geometry is a conflict', () => {
  const b = fresh('b');
  roll(b, 8);
  produce(b, 1, [5, 5]);   // server says 2 ore, geometry predicted 1 → geometry is wrong here
  roll(b, 6);
  const a = B.auditOf(b);
  assert.equal(a.confirms, 0);
  assert.equal(a.conflicts, 1);
  assert.equal(a.trail.length, 1);
  assert.equal(a.trail[0].ok, false);
  assert.equal(a.trail[0].roll, 8);
});

test('the robbed tile is predicted to produce nothing — a blocked roll still confirms', () => {
  const b = fresh('c');
  moveRobber(b, 7);        // robber on the ore tile
  roll(b, 8);              // server produces nothing (blocked); geometry predicts nothing too
  roll(b, 6);              // settle
  const a = B.auditOf(b);
  assert.equal(a.confirms, 1, 'empty == empty');
  assert.equal(a.conflicts, 0);
  assert.equal(B.blockedLossOf(b, 1), 1, 'and the block was still counted as a loss');
});

test('a 7 (no production tile) is safe and confirms', () => {
  const b = fresh('d');
  roll(b, 7);
  roll(b, 8);              // settle the 7
  const a = B.auditOf(b);
  assert.equal(a.conflicts, 0);
});

test('production split into a later diff than the roll still reconciles', () => {
  const b = fresh('e');
  roll(b, 8);
  // (some unrelated diff with no production could arrive here)
  B.applyDiff(b, {});
  produce(b, 1, [5]);      // arrives after the roll, in its own diff
  roll(b, 6);
  const a = B.auditOf(b);
  assert.equal(a.confirms, 1);
  assert.equal(a.conflicts, 0);
});

test('the final roll is settled on demand (no following roll to trigger it)', () => {
  const b = fresh('f');
  roll(b, 8);
  produce(b, 1, [5]);
  // game ends, no next roll
  B.auditSettle(b);
  const a = B.auditOf(b);
  assert.equal(a.confirms, 1);
  assert.equal(a.conflicts, 0);
});

test('a new game resets the audit', () => {
  const b = fresh('g1');
  roll(b, 8); produce(b, 1, [5, 5]); roll(b, 6);
  assert.equal(B.auditOf(b).conflicts, 1);
  B.applyFullState(b, fullState('g2').payload);   // new game id
  const a = B.auditOf(b);
  assert.equal(a.confirms, 0);
  assert.equal(a.conflicts, 0);
  assert.equal(a.trail.length, 0);
});
