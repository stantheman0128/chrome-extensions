'use strict';

// Recent-roll sequence strip: the last ~12 rolls rendered oldest→newest in the
// dice section (7s flagged), purely a display over state.rollHistory.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

test('roll strip shows the last rolls in order; blank-but-reserved when empty', () => {
  cst.resetState();
  cst.createPanel();
  cst.render();
  assert.equal(document.querySelector('[data-tip*="rolls (oldest"]'), null,
    'no labelled strip before the first roll');
  // ...but the row still occupies its height (a hidden placeholder chip) so the
  // panel doesn't jump when the first roll lands.
  assert.match(document.querySelector('#cst-dice').innerHTML, /visibility:hidden/,
    'an invisible placeholder reserves the strip height');

  cst.state.rollHistory = [5, 7, 9];
  cst.render();
  const strip = document.querySelector('[data-tip="Last 3 rolls (oldest → newest)"]');
  assert.ok(strip, 'strip appears once rolls exist');
  const chips = [...strip.querySelectorAll('span')].slice(1); // [0] is the label
  assert.deepEqual(chips.map((c) => c.textContent), ['5', '7', '9']);
});

test('roll strip caps at the last 12 rolls', () => {
  cst.state.rollHistory = Array.from({ length: 20 }, (_, i) => 2 + (i % 11));
  cst.render();
  const strip = document.querySelector('[data-tip="Last 12 rolls (oldest → newest)"]');
  assert.ok(strip, 'only the last 12 are shown');
});
