'use strict';

// v1.31.0 — generic "get out of the way when colonist takes over the screen".
// Instead of guessing each dialog's class, we collapse the panel whenever the
// live board (a <canvas>) is no longer what's at the viewport centre — which
// covers Settings, Leave Game, Pause/Resume, the end screen, etc. The DOM probe
// (boardHidden) needs a real browser; this tests the pure edge-trigger decision.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

const act = (o) => cst.boardPostureAction(o);

test('no action when the hidden signal has not changed (edge-triggered)', () => {
  assert.equal(act({ hidden: false, prevHidden: false, userCollapsed: false, collapsedForBoard: false }), null);
  assert.equal(act({ hidden: true,  prevHidden: true,  userCollapsed: true,  collapsedForBoard: true  }), null);
});

test('collapses when a colonist screen appears over the board', () => {
  assert.equal(
    act({ hidden: true, prevHidden: false, userCollapsed: false, collapsedForBoard: false }),
    'collapse'
  );
});

test('does NOT fight a panel the user had already collapsed', () => {
  assert.equal(
    act({ hidden: true, prevHidden: false, userCollapsed: true, collapsedForBoard: false }),
    null
  );
});

test('re-expands when the board returns — but only if WE collapsed it', () => {
  assert.equal(
    act({ hidden: false, prevHidden: true, userCollapsed: true, collapsedForBoard: true }),
    'expand'
  );
  // The user (or another mechanism) owns this collapse — leave it be.
  assert.equal(
    act({ hidden: false, prevHidden: true, userCollapsed: true, collapsedForBoard: false }),
    null
  );
});
