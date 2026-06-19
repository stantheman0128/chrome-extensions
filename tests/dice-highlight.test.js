'use strict';

// Click-to-highlight a whole dice bar (2–12): a manual marker the user toggles
// on a dice sum's column in the Dice Rolls section, so they can keep an eye on
// the number(s) they care about. Clicking the column highlights it; clicking the
// bottom 2–12 LABEL keeps its existing job (flip digits ⇄ dice faces), so the
// two interactions don't collide. Highlights clear when a new game starts.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst, document } = require('./helpers/setup');
const click = (el) => el.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));

test('toggleDiceHighlight adds then removes a sum', () => {
  cst.resetState();
  cst.getUiState().diceHighlights = [];
  cst.toggleDiceHighlight('8');
  assert.deepEqual(cst.getUiState().diceHighlights, ['8']);
  cst.toggleDiceHighlight('8');
  assert.deepEqual(cst.getUiState().diceHighlights, []);
});

test('a highlighted dice column renders with a background; others do not', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().diceHighlights = ['8'];
  cst.render();
  const on = document.querySelector('[data-die="8"]');
  const off = document.querySelector('[data-die="6"]');
  assert.ok(on && off, 'both dice columns render with data-die');
  assert.match(on.getAttribute('style') || '', /background/, 'highlighted column has a background');
  assert.doesNotMatch(off.getAttribute('style') || '', /background/, 'un-highlighted column has none');
});

test('clicking a dice column toggles its highlight', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().diceHighlights = [];
  cst.render();
  const col = document.querySelector('[data-die="8"]');
  assert.ok(col, 'dice column exists');
  click(col);
  assert.deepEqual(cst.getUiState().diceHighlights, ['8'], 'click highlighted the column');
});

test('clicking the 2–12 label flips faces — it does NOT highlight (no collision)', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().diceHighlights = [];
  cst.render();
  const label = document.querySelector('[data-dietoggle="8"]');
  assert.ok(label, 'the toggle label exists');
  click(label);
  assert.deepEqual(cst.getUiState().diceHighlights, [], 'the label click must not highlight the column');
});
