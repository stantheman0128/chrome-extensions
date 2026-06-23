'use strict';

// Recent-roll sequence strip in the dice section (7s flagged), a display over
// state.rollHistory. It renders up to the last 40 rolls oldest→newest; the row then
// shows as many as the panel width fits (newest on the right, oldest fade out left).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

test('roll strip shows the last rolls in order; blank-but-reserved when empty', () => {
  cst.resetState();
  cst.createPanel();
  cst.render();
  assert.equal(document.querySelector('[data-tip^="Recent rolls"]'), null,
    'no labelled strip before the first roll');
  // ...but the row still occupies its height (a hidden placeholder chip) so the
  // panel doesn't jump when the first roll lands.
  assert.match(document.querySelector('#cst-dice').innerHTML, /visibility:hidden/,
    'an invisible placeholder reserves the strip height');

  cst.state.rollHistory = [5, 7, 9];
  cst.render();
  const strip = document.querySelector('[data-tip^="Recent rolls"]');
  assert.ok(strip, 'strip appears once rolls exist');
  // The "Roll order" label is a SIBLING of the chips box, so the box holds only chips.
  const chips = [...strip.querySelectorAll('span')];
  assert.deepEqual(chips.map((c) => c.textContent), ['5', '7', '9']);
});

test('roll strip renders up to the last 40 rolls (width then decides how many show)', () => {
  cst.state.rollHistory = Array.from({ length: 60 }, (_, i) => 2 + (i % 11));
  cst.render();
  const strip = document.querySelector('[data-tip^="Recent rolls"]');
  assert.ok(strip, 'the strip is present');
  const chips = [...strip.querySelectorAll('span')];
  assert.equal(chips.length, 40, 'renders at most the last 40; CSS clips to what fits');
  assert.equal(chips[chips.length - 1].textContent, String(2 + (59 % 11)),
    'newest roll is the rightmost chip');
});
