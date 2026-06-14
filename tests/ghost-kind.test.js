'use strict';

// v1.32.0 — ghost tier selection. Full-screen colonist views COLLAPSE the panel
// (board-posture); ghost mode only FADES for things that overlap the panel while
// the board is still visible — a dialog/menu (full tier) or the trade creator
// (light tier). The geometric/DOM probes need a live browser; this tests the pure
// tier-selection decision, including the "don't fade an already-collapsed panel"
// gate that keeps the two mechanisms from fighting.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

const kind = (o) => cst.ghostKind(o);

test('a dialog/menu overlapping an OPEN panel fades it (full tier)', () => {
  assert.equal(kind({ panelCollapsed: false, dialogOverlap: true, tradeOn: false }), 'full');
});

test('the trade creator over an open panel fades it (light tier)', () => {
  assert.equal(kind({ panelCollapsed: false, dialogOverlap: false, tradeOn: true }), 'light');
});

test('a dialog supersedes trade tracking (full wins over light)', () => {
  assert.equal(kind({ panelCollapsed: false, dialogOverlap: true, tradeOn: true }), 'full');
});

test('nothing to fade when nothing overlaps', () => {
  assert.equal(kind({ panelCollapsed: false, dialogOverlap: false, tradeOn: false }), '');
});

test('a COLLAPSED panel is never ghosted (full-screen views own the collapse)', () => {
  // e.g. full Settings / Leave Game already collapsed the panel — don't also fade
  // the dice icon, which is what caused the old double-state.
  assert.equal(kind({ panelCollapsed: true, dialogOverlap: true, tradeOn: false }), '');
  assert.equal(kind({ panelCollapsed: true, dialogOverlap: false, tradeOn: true }), '');
});
