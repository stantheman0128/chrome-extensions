'use strict';

// Trade ghost is edge-triggered: the panel fades for the trade UI ONLY when the
// trade appeared over a still panel — NOT when the user dragged the panel onto
// an existing trade (then it must stay put and grabbable). tradeGhostOn() is the
// pure decision behind that; the DOM overlap detection itself is layout-based
// and verified in a real game.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

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

// tradeCreatorOpen distinguishes the OPEN trade creator from colonist's always-
// present trade furniture (the button bar + gameTradeOffersContainer reserve),
// which used to mask the overlap edge when the panel was parked near the bar.
test('tradeCreatorOpen ignores the persistent trade bar / offers container', () => {
  document.body.innerHTML =
    '<div class="tradeButton-BgRRP9Nn"></div>' +
    '<div class="gameTradeOffersContainer-DYpyuwA9"></div>' +
    '<div class="tradeCreatorContainer-BsQ23Nsz"></div>'; // closed creator (no proposal/actions)
  assert.equal(cst.tradeCreatorOpen(), false, 'closed: persistent trade elements do not count');
});

test('tradeCreatorOpen is true once the creator pops its proposal/actions parts', () => {
  document.body.innerHTML =
    '<div class="tradeButton-BgRRP9Nn"></div>' +
    '<div class="tradeCreatorContainer-BsQ23Nsz"></div>' +
    '<div class="tradeCreatorProposalContainer-wcW0pzjo"></div>' +
    '<div class="tradeCreatorActionsContainer-OhHzY6JP"></div>';
  assert.equal(cst.tradeCreatorOpen(), true, 'open: the proposal/actions parts mark it');
  document.body.innerHTML = '';
});
