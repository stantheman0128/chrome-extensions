'use strict';

// The Player column must be identical in both views (one shared grid), and the
// switch animation must move ONLY the value cells — the Player column stays
// perfectly still. (Regression: when Stats grew to 6 columns its grid's first
// track was shrunk to make room, so the name column jumped between views.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');
const KeyboardEvent = global.window.KeyboardEvent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

test('both views share one grid, so the Player column never changes width', async () => {
  cst.resetState();
  cst.getPlayer('P1', '#CF4449');
  cst.createPanel();
  cst.render(); // cards view (fresh process → default resView 'cards')

  const panel = document.querySelector('#colonist-stats-tracker');
  const cardsGrid = panel.querySelector('#cst-resources [data-prow="P1"]').style.gridTemplateColumns;

  press('s');
  await sleep(260); // let the switch settle

  const statsGrid = panel.querySelector('#cst-resources [data-prow="P1"]').style.gridTemplateColumns;
  assert.ok(cardsGrid, 'cards grid is set');
  assert.equal(statsGrid, cardsGrid, 'Stats view uses the exact same grid template');
});

test('the switch animates only the value cells, never the Player column', async () => {
  press('r');           // ensure we are in the cards view
  await sleep(260);

  const panel = document.querySelector('#colonist-stats-tracker');
  const row = panel.querySelector('#cst-resources [data-prow="P1"]');
  const nameCell = row.firstElementChild;          // the Player cell
  assert.equal(nameCell.hasAttribute('data-res'), false, 'name cell carries no data-res');
  const valueCell = row.querySelector('[data-res]'); // a value cell

  press('s');           // fade-out is applied synchronously inside the handler
  assert.equal(valueCell.style.opacity, '0', 'value cells fade out');
  assert.equal(nameCell.style.opacity, '', 'the Player column is never faded');
  assert.equal(nameCell.style.transform, '', 'the Player column is never slid');
});
