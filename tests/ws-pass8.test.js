'use strict';

// Codex pass-8 fixes to the WS model:
//  #2  projectRecon must clamp the displayed opponent total to colonist's authoritative
//      handCount even when a silent dev-card buy can't actually spend its 3 resources
//      (the old code assumed a full −3 it couldn't make, leaving the total over-counted).
//  P2  geomComplete: a hex centre that SIX corners surround must have a loaded tile —
//      a map-agnostic partial-tile completeness gate (no fixed 19/54).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

test('#2 projectRecon clamps to handCount even when the dev-card resources are absent', () => {
  const b = B.createBoard();
  b.hands[4] = { cards: new Array(10).fill(0) };                       // colonist's masked hand: 10 cards
  B.__setRecon(b, 4, { 1: 13, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 });   // raw over-counts by 3, all lumber
  assert.equal(B.handCountOf(b, 4), 10);
  assert.equal(B.reconSumOf(b, 4), 10, 'a phantom dev-card buy must not leave the total at 13');
});

test('#2 projectRecon reconciles when only one of the three dev-card resources is held', () => {
  const b = B.createBoard();
  b.hands[2] = { cards: new Array(9).fill(0) };                        // 9 cards
  B.__setRecon(b, 2, { 1: 11, 2: 0, 3: 1, 4: 0, 5: 0, unknown: 0 });   // 12 raw vs 9: excess 3, only 1 wool
  assert.equal(B.reconSumOf(b, 2), 9, 'spends the 1 wool, then clamps the rest with single losses');
});

test('P2 geomComplete flags a hex six corners surround but no tile is loaded for', () => {
  const b = B.createBoard();
  // six corners all pointing at hex centre (0,0); each also points at two off-board
  // centres (referenced < 6 times), so only (0,0) is a "real" tile by the six-corner rule.
  b.corners = {
    a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 1, z: 0 }, c: { x: -1, y: 1, z: 0 },
    d: { x: 0, y: 0, z: 1 }, e: { x: 1, y: -1, z: 1 }, f: { x: 0, y: -1, z: 1 },
  };
  assert.equal(B.geomComplete(b), false, '(0,0) is surrounded by 6 corners but absent → incomplete');

  b.tiles = { 9: { type: 1, number: 5, x: 0, y: 0 } };
  b.coordToTile = { '0,0': 9 };
  assert.equal(B.geomComplete(b), true, 'once (0,0) is loaded the geometry is complete');
});

test('P2 a real complete board passes geomComplete (no false positive)', () => {
  const b = B.createBoard();
  B.applyFullState(b, require('./fixtures/ws-fullstate-2p.json'));
  assert.equal(B.geomComplete(b), true, 'the genuine 19-tile / 54-corner board is complete');
  assert.equal(B.geomReady(b), true, 'and still geometry-ready');
});
