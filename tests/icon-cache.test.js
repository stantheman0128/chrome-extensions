'use strict';

// Stat-column icons are now fully self-drawn: a unified line-art glyph plus a
// corner +/- badge (THEME.good "+" gain / THEME.bad "−" loss / none neutral), with
// no colonist-asset harvest/bundle dependency. The sixth column is ⚔️ Cards stolen
// (replacing the retired 🤝 Cards traded).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, document } = require('./helpers/setup');

test('every stat header renders a self-drawn svg icon (no colonist <img>)', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('A', '#c00');
  cst.getUiState().resView = 'stats';
  cst.render();
  ['s-block', 's-lost', 's-disc', 's-gain', 's-turn', 's-stolen'].forEach((key) => {
    const h = document.querySelector(`[data-colhead][data-res="${key}"]`);
    assert.ok(h, key + ' header present');
    assert.match(h.innerHTML, /<svg/i, key + ' uses a self-drawn svg');
    assert.doesNotMatch(h.innerHTML, /<img/i, key + ' has no colonist <img>');
  });
});

test('the stolen column replaces the trade column (sixth column)', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('A', '#c00');
  cst.getUiState().resView = 'stats';
  cst.render();
  assert.ok(document.querySelector('[data-colhead][data-res="s-stolen"]'), 's-stolen present');
  assert.equal(document.querySelector('[data-colhead][data-res="s-trade"]'), null, 's-trade gone');
});
