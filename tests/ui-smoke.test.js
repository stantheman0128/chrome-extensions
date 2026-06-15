'use strict';

// Smoke test for the render layer. The Node tests can't see a real browser, so
// this drives createPanel()/render() inside jsdom to prove the UI builds without
// a runtime error and has the expected structure. (localStorage/ResizeObserver
// are absent under Node; content.js guards/try-catches both.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

test('UI renders the full panel: dice bars + %, merged resources/bank, player rows', async () => {
  cst.resetState();
  const stan = cst.getPlayer('StanTheMan01', '#CF4449');
  cst.giveResource(stan, 'grain', 3);
  cst.giveResource(stan, 'lumber', 2);
  const thant = cst.getPlayer('Thant', '#285FBD');
  cst.giveResource(thant, 'brick', 4);
  thant.unknown = 1; // forces the bank "(≈)" approximate note
  Object.assign(cst.state.diceCounts, { 6: 5, 7: 3, 8: 4 });
  cst.state.totalRolls = 12;

  cst.createPanel(); // must not throw
  cst.render(); // must not throw

  const panel = document.querySelector('#colonist-stats-tracker');
  assert.ok(panel, 'panel mounted to the document');

  // Dice: one column per sum 2..12, with percentages shown.
  assert.equal(panel.querySelectorAll('#cst-dice div[data-die]').length, 11);
  assert.match(panel.querySelector('#cst-dice').textContent, /%/);

  // Resources: 5 resource icons (each cell carrying a Bank data-tip) + 1 "?"
  // unknown-card header icon = 6 imgs total. No Σ total column.
  const resources = panel.querySelector('#cst-resources');
  assert.equal(resources.querySelectorAll('img').length, 6);
  assert.equal(resources.querySelectorAll('span[data-res][data-tip^="Bank:"]').length, 5);
  // A hand-total badge sits next to each player's name (2 players seeded).
  assert.equal(resources.querySelectorAll('span[data-tip="Total cards in hand"]').length, 2);
  assert.match(resources.textContent, /StanTheMan01/);
  assert.match(resources.textContent, /Thant/);

  // Resources · Stats view tabs: both exist; clicking Stats swaps the table to
  // the six event columns (⚔️ 💔 🗑️ 📥 🎴 🏗️) for the same player rows.
  const tabs = panel.querySelectorAll('.cst-vtab');
  assert.equal(tabs.length, 2);
  panel.querySelector('[data-resview="stats"]').click();
  await sleep(320);   // the switch slide-fades (render happens ~160ms in)
  assert.equal(resources.querySelectorAll('span[data-res="s-block"]').length, 3,
    'stats header + one cell per player');
  assert.match(resources.textContent, /StanTheMan01/);
  panel.querySelector('[data-resview="cards"]').click();
  await sleep(320);
  assert.equal(resources.querySelectorAll('span[data-res="s-block"]').length, 0,
    'back to the resource columns');

  // Foldable sections each expose a data-fold header (dice + resources).
  assert.ok(panel.querySelector('[data-fold="diceCollapsed"]'));
  assert.ok(panel.querySelector('[data-fold="resCollapsed"]'));

  // Removed for good: the stats-wiping reset, status line, separate bank block,
  // +/- scale buttons, and the dedicated collapse button (the glyph collapses).
  for (const sel of ['#cst-reset', '#cst-status', '#cst-bank', '#cst-bigger', '#cst-smaller', '#cst-collapse']) {
    assert.equal(panel.querySelector(sel), null, `${sel} should be gone`);
  }
  assert.ok(panel.querySelector('#cst-glyph'), 'dice glyph (collapse trigger) exists');
  // Header controls: re-sync, large/small toggle, and the presets (⋮) menu.
  assert.ok(panel.querySelector('#cst-resync'), 're-sync button exists');
  assert.ok(panel.querySelector('#cst-size'), 'large/small toggle exists');
  assert.ok(panel.querySelector('#cst-prefs'), 'presets menu button exists');
  assert.ok(panel.querySelector('#cst-menu [data-act="save-large"]'), 'save-large menu item exists');
  assert.ok(panel.querySelector('#cst-menu [data-act="reset"]'), 'reset-presets menu item exists');
  // The manual new-game button moved to the popup; it's gone from the panel.
  assert.equal(panel.querySelector('#cst-newgame'), null, 'new-game button removed from panel');
});
