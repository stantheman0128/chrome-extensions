'use strict';

// Trade ghost is edge-triggered: the panel fades for the trade UI ONLY when the
// trade appeared over a still panel — NOT when the user dragged the panel onto
// an existing trade (then it must stay put and grabbable). tradeGhostOn() is the
// pure decision behind that; the DOM overlap detection itself is layout-based
// and verified in a real game.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

test('no overlap → never ghost', () => {
  assert.equal(cst.tradeGhostOn({ over: false, moved: false, prevOverlap: false, alreadyLight: false }), false);
  assert.equal(cst.tradeGhostOn({ over: false, moved: true, prevOverlap: true, alreadyLight: true }), false);
});

test('trade appears over a still panel → ghost', () => {
  assert.equal(cst.tradeGhostOn({ over: true, moved: false, prevOverlap: false, alreadyLight: false }), true);
});

test('panel dragged onto an existing trade → do NOT ghost (stays grabbable)', () => {
  // The panel is moving when the overlap begins.
  assert.equal(cst.tradeGhostOn({ over: true, moved: true, prevOverlap: false, alreadyLight: false }), false);
  // And once it has settled over the trade (overlap carried over from the drag),
  // it must still not start ghosting.
  assert.equal(cst.tradeGhostOn({ over: true, moved: false, prevOverlap: true, alreadyLight: false }), false);
});

test('an already-open trade ghost is kept while the overlap lasts', () => {
  assert.equal(cst.tradeGhostOn({ over: true, moved: true, prevOverlap: true, alreadyLight: true }), true);
});
