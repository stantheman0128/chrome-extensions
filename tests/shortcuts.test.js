'use strict';

// Keyboard shortcut scheme (consistent, per Stan):
//   D = collapse/expand the Dice section
//   R = jump to Resources; press again (already there) to collapse the section
//   S = jump to Stats;     press again (already there) to collapse the section
//   C = collapse/expand the whole panel (unchanged)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, document } = require('./helpers/setup');
const KeyboardEvent = global.window.KeyboardEvent;
const press = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

function freshPanel() {
  cst.resetState();
  cst.getPlayer('P1', '#c00');
  cst.createPanel();
  cst.render();
  const ui = cst.getUiState();
  ui.panelCollapsed = false; ui.diceCollapsed = false; ui.resCollapsed = false; ui.resView = 'cards';
}

test('D collapses then expands the Dice section', () => {
  freshPanel();
  press('d');
  assert.equal(cst.getUiState().diceCollapsed, true, 'D collapsed dice');
  press('d');
  assert.equal(cst.getUiState().diceCollapsed, false, 'D expanded dice');
});

test('R jumps to Resources from Stats, then collapses the section when pressed again', () => {
  freshPanel();
  cst.getUiState().resView = 'stats';
  press('r');
  assert.equal(cst.getUiState().resView, 'cards', 'R switched to Resources');
  assert.equal(cst.getUiState().resCollapsed, false, 'still open right after switching');
  press('r');
  assert.equal(cst.getUiState().resCollapsed, true, 'R again collapsed the section');
});

test('S jumps to Stats, then collapses the section when pressed again', () => {
  freshPanel();
  press('s');
  assert.equal(cst.getUiState().resView, 'stats', 'S switched to Stats');
  press('s');
  assert.equal(cst.getUiState().resCollapsed, true, 'S again collapsed the section');
});
