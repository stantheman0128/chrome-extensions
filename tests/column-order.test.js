'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { cst } = require('./helpers/setup');

test('reconcileOrder drops unknown keys and appends missing canonical keys', () => {
  const canon = ['a', 'b', 'c'];
  assert.deepEqual(cst.reconcileOrder(['c', 'a'], canon), ['c', 'a', 'b']);
  assert.deepEqual(cst.reconcileOrder(['x', 'b'], canon), ['b', 'a', 'c']);
  assert.deepEqual(cst.reconcileOrder(null, canon), ['a', 'b', 'c']);
});

test('legacy stat order with s-stole is reconciled to include s-block, drop s-stole', () => {
  const out = cst.reconcileOrder(
    ['s-stole', 's-lost', 's-disc'],
    ['s-block', 's-lost', 's-disc', 's-gain', 's-turn', 's-trade']);
  assert.ok(!out.includes('s-stole'));
  assert.ok(out.includes('s-block'));
  assert.equal(out.length, 6);
});

const { document } = require('./helpers/setup');

function headKeys() {
  return [...document.querySelectorAll('#cst-res-wrap [data-colhead]')]
    .map((el) => el.getAttribute('data-res'));
}

test('stats header renders in statOrder', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().resView = 'stats';
  cst.getUiState().statOrder = ['s-trade', 's-block', 's-lost', 's-disc', 's-gain', 's-turn'];
  cst.render();
  assert.deepEqual(headKeys(), ['s-trade', 's-block', 's-lost', 's-disc', 's-gain', 's-turn']);
});

test('cards header renders in resOrder (unknown reorderable)', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().resView = 'cards';
  cst.getUiState().resOrder = ['unknown', 'lumber', 'brick', 'wool', 'grain', 'ore'];
  cst.render();
  assert.deepEqual(headKeys(), ['unknown', 'lumber', 'brick', 'wool', 'grain', 'ore']);
});

test('reorderKeys moves a key forward and backward', () => {
  const a = ['a', 'b', 'c', 'd'];
  assert.deepEqual(cst.reorderKeys(a, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(cst.reorderKeys(a, 3, 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(cst.reorderKeys(a, 1, 1), ['a', 'b', 'c', 'd']);
});

// Regression: the Resources header uses <img> card icons (Stats uses text emoji).
// A browser <img> is natively draggable by default, so pressing+dragging a
// resource icon starts a native image drag that hijacks our pointer-based column
// reorder — Resources columns become un-reorderable while Stats stay fine. The
// fix is draggable="false" on the icon images. (jsdom can't simulate native DnD,
// so we lock the invariant: header icons must not be natively draggable.)
test('card header icons are not natively draggable', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().resView = 'cards';
  cst.render();
  const img = document.querySelector('#cst-res-wrap [data-colhead] img');
  assert.ok(img, 'a card header icon image exists');
  assert.equal(img.getAttribute('draggable'), 'false');
});
