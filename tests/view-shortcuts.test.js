'use strict';

// v1.19.0 — R/S keyboard view shortcuts + discard-risk hand-total badge.
// Drives createPanel()/render() inside jsdom (same approach as ui-smoke).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const KeyboardEvent = global.window.KeyboardEvent;

function pressKey(key, target) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true });
  (target || document).dispatchEvent(ev);
}

const inStatsView = () =>
  !!document.querySelector('#cst-resources [data-res="s-stole"]');

test('S and R keys switch between the Stats and Resources views', async () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  cst.createPanel();
  cst.render();

  assert.equal(inStatsView(), false, 'starts in the Resources (cards) view');

  pressKey('s');
  await sleep(250); // the directional slide re-renders after ~160 ms
  assert.equal(inStatsView(), true, 'S switches to the Stats view');

  pressKey('R'); // uppercase must work too
  await sleep(250);
  assert.equal(inStatsView(), false, 'R switches back to the Resources view');
});

test('view keys are ignored while typing in an input (chat box)', async () => {
  assert.equal(inStatsView(), false);
  const input = document.createElement('input');
  document.body.appendChild(input);
  pressKey('s', input);
  await sleep(250);
  assert.equal(inStatsView(), false, 'typing "s" in an input must not switch views');
  input.remove();
});

test('view keys are ignored with modifier keys held (Ctrl+R etc.)', async () => {
  const ev = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true });
  document.dispatchEvent(ev);
  await sleep(250);
  assert.equal(inStatsView(), false, 'Ctrl+S must not switch views');
});

test('C key collapses and expands the whole panel', async () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  cst.createPanel();
  cst.render();

  const title = document.querySelector('#cst-title');
  assert.notEqual(title.style.display, 'none', 'panel starts expanded');

  pressKey('c');
  assert.equal(title.style.display, 'none', 'C collapses to the dice icon');

  pressKey('C'); // uppercase too
  assert.notEqual(title.style.display, 'none', 'C again expands it back');
});

test('C key is ignored while typing in an input', () => {
  const title = document.querySelector('#cst-title');
  assert.notEqual(title.style.display, 'none');
  const input = document.createElement('input');
  document.body.appendChild(input);
  pressKey('c', input);
  assert.notEqual(title.style.display, 'none', 'typing "c" must not collapse');
  input.remove();
});

test('hand-total badge turns red at 8+ cards (discard risk), normal at 7', () => {
  cst.resetState();
  const fat = cst.getPlayer('FatHand', '#CF4449');
  cst.giveResource(fat, 'grain', 5);
  cst.giveResource(fat, 'lumber', 3); // 8 cards — a rolled 7 discards half
  const safe = cst.getPlayer('SafeHand', '#285FBD');
  cst.giveResource(safe, 'brick', 7); // exactly 7 — still safe
  cst.render();

  // The hand-total badge is the last span inside the name cell (row's 1st child).
  const badge = (name) => {
    const row = document.querySelector(`[data-prow="${name}"]`);
    return row && row.firstElementChild ? row.firstElementChild.lastElementChild : null;
  };
  const fatBadge = badge('FatHand');
  const safeBadge = badge('SafeHand');
  assert.ok(fatBadge && safeBadge, 'both hand-total badges rendered');
  assert.match(fatBadge.getAttribute('style') || '', /#c0533a/i,
    '8+ cards: badge uses the warning colour');
  assert.doesNotMatch(safeBadge.getAttribute('style') || '', /#c0533a/i,
    '7 cards: badge stays normal');
});
