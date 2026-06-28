'use strict';

// Click-to-highlight a value cell: a manual marker the user toggles on any
// number in the Resources or Stats table. Cell id is "player|key" so the
// highlight follows a column when it's drag-reordered, and falls away when a
// new game changes the roster.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, document } = require('./helpers/setup');

test('toggleCellHighlight adds then removes a cell id', () => {
  cst.resetState();
  cst.getUiState().highlights = [];
  cst.toggleCellHighlight('Aria|s-block');
  assert.deepEqual(cst.getUiState().highlights, ['Aria|s-block']);
  cst.toggleCellHighlight('Aria|s-block');
  assert.deepEqual(cst.getUiState().highlights, []);
});

test('selectPipPlayer supports multiple selected players at once', () => {
  cst.resetState();
  cst.getUiState().pipPlayers = [];
  cst.selectPipPlayer('Aria');
  cst.selectPipPlayer('Bo');
  assert.deepEqual(cst.getUiState().pipPlayers, ['Aria', 'Bo'], 'both stay selected');
  cst.selectPipPlayer('Aria');
  assert.deepEqual(cst.getUiState().pipPlayers, ['Bo'], 'toggling Aria off leaves Bo selected');
});

test('clearHighlights wipes both cell and dice pins, and no-ops when already empty', () => {
  cst.resetState();
  cst.getUiState().highlights = ['Aria|s-block', 'Bo|ore'];
  cst.getUiState().diceHighlights = ['8'];
  assert.equal(cst.clearHighlights(), true, 'returns true when something was pinned');
  assert.deepEqual(cst.getUiState().highlights, []);
  assert.deepEqual(cst.getUiState().diceHighlights, []);
  assert.equal(cst.clearHighlights(), false, 'no-op when nothing is pinned (so Resync skips a redundant save)');
});

test('a highlighted value cell renders with a background; an un-highlighted one does not', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('Aria', '#c00');
  cst.getUiState().resView = 'stats';
  cst.getUiState().highlights = ['Aria|s-block'];
  cst.render();
  const on = document.querySelector('[data-cell="Aria|s-block"]');
  const off = document.querySelector('[data-cell="Aria|s-lost"]');
  assert.ok(on && off, 'both cells render with data-cell ids');
  assert.match(on.getAttribute('style') || '', /background/, 'highlighted cell has a background');
  assert.doesNotMatch(off.getAttribute('style') || '', /background/, 'un-highlighted cell has none');
});

test('clicking a value cell toggles its highlight', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('Aria', '#c00');
  cst.getUiState().resView = 'stats';
  cst.getUiState().highlights = [];
  cst.render();
  const cell = document.querySelector('[data-cell="Aria|s-block"]');
  assert.ok(cell, 'cell exists');
  cell.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(cst.getUiState().highlights, ['Aria|s-block'], 'click highlighted it');
});
