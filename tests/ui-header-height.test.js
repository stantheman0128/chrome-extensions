'use strict';

// Switching Resources ⇄ Stats must not change the panel height. The only
// systematic difference between the two table headers is the top room they
// reserve: the Resources header needs it for the pinned opponents-hold figure
// that floats above a column icon (top:-1.5em), and the Stats header reserves the
// same room even though it has no such figure. Both now read one HEAD_PAD_TOP
// constant; this locks them to the same value so the height-jump can't come back
// through a one-sided edit. (jsdom doesn't lay out pixels, so we assert the shared
// padding markup rather than a measured height.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

function headTopPadding(view) {
  cst.getUiState().resView = view;
  cst.render();
  const res = global.document.querySelector('#cst-resources');
  const head = res.firstElementChild;            // the tableHead <div>
  const style = (head && head.getAttribute('style')) || '';
  const m = style.match(/padding:\s*([^;]+)/);
  return m ? m[1].trim() : null;
}

test('Resources and Stats headers reserve the same top padding (no height jump on switch)', () => {
  cst.resetState();
  cst.createPanel();

  const cards = headTopPadding('cards');
  const stats = headTopPadding('stats');

  assert.ok(cards, 'the Resources header has padding set');
  assert.equal(stats, cards, 'the Stats header reserves the same top room as Resources');
});
