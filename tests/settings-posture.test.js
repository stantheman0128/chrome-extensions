'use strict';

// colonist's full-page Settings (outer class `gameSettingsContainer…`, no URL
// change, not a fixed/absolute overlay) should collapse the dashboard out of the
// way while it's open and restore it on close — but never fight a panel the user
// had already collapsed before opening Settings.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');
const KeyboardEvent = global.window.KeyboardEvent;

// colonist keeps the shell mounted but EMPTY when closed; OPEN means it has a
// content child. openSettings injects content; openSettingsWithLimit adds the
// Card Discard Limit row; closeSettings removes the shell entirely.
const openSettings = () =>
  document.body.insertAdjacentHTML('beforeend',
    '<div class="gameSettingsContainer-wPWRmX6U"><div class="gameSettingsContainer-QwyaJ5Mz"></div></div>');
const openSettingsWithLimit = (n) =>
  document.body.insertAdjacentHTML('beforeend',
    '<div class="gameSettingsContainer-wPWRmX6U"><div class="contentContainer">' +
    '<div class="label-a">VPs to Win</div><div class="value-a">10</div>' +
    `<div class="label-a">Card Discard Limit</div><div class="value-a">${n}</div>` +
    '</div></div>');
const closeSettings = () => {
  document.querySelectorAll('[class*="gameSettingsContainer"]').forEach((el) => el.remove());
};

test('settingsOpen tracks the shell\'s content (empty = closed, populated = open)', () => {
  closeSettings();
  assert.equal(cst.settingsOpen(), false, 'no shell → closed');
  document.body.insertAdjacentHTML('beforeend', '<div class="gameSettingsContainer-wPWRmX6U"></div>');
  assert.equal(cst.settingsOpen(), false, 'mounted but EMPTY shell → still closed');
  closeSettings();
  openSettings();
  assert.equal(cst.settingsOpen(), true, 'shell with content → open');
  closeSettings();
});

test('discardLimit reads the Card Discard Limit when Settings is open, caches it, else headcount', () => {
  cst.resetState();
  closeSettings();
  assert.equal(cst.discardLimit(), 7, 'closed, no players → standard 7');
  openSettingsWithLimit(10);
  assert.equal(cst.discardLimit(), 10, 'reads the value while Settings is open');
  closeSettings();
  assert.equal(cst.discardLimit(), 10, 'still 10 after close — cached from when it was open');
  cst.resetState();
  cst.getPlayer('A', '#111'); cst.getPlayer('B', '#222');
  assert.equal(cst.discardLimit(), 10, '2-player headcount fallback → 10');
});

test('opening Settings collapses the panel; closing it expands again', () => {
  cst.resetState();
  cst.createPanel();
  cst.render();
  const ui = cst.getUiState();
  assert.equal(ui.panelCollapsed, false, 'starts expanded');

  openSettings();
  cst.updateSettingsPosture();
  assert.equal(ui.panelCollapsed, true, 'Settings open → panel collapses');

  closeSettings();
  cst.updateSettingsPosture();
  assert.equal(ui.panelCollapsed, false, 'Settings closed → panel expands back');
});

test('a panel the user already collapsed is left collapsed after Settings closes', () => {
  const ui = cst.getUiState();
  assert.equal(ui.panelCollapsed, false, 'precondition: expanded');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true })); // user collapses
  assert.equal(ui.panelCollapsed, true, 'user collapsed it');

  openSettings();
  cst.updateSettingsPosture();   // we must NOT mark this as ours
  closeSettings();
  cst.updateSettingsPosture();   // ...so we must NOT auto-expand it
  assert.equal(ui.panelCollapsed, true, 'still collapsed — user intent respected');
});
