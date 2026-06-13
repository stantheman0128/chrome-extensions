'use strict';

// colonist's full-page Settings (outer class `gameSettingsContainer…`, no URL
// change, not a fixed/absolute overlay) should collapse the dashboard out of the
// way while it's open and restore it on close — but never fight a panel the user
// had already collapsed before opening Settings.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');
const KeyboardEvent = global.window.KeyboardEvent;

const openSettings = () =>
  document.body.insertAdjacentHTML('beforeend', '<div class="gameSettingsContainer-QwyaJ5Mz"></div>');
const closeSettings = () => {
  const el = document.querySelector('[class*="gameSettingsContainer"]');
  if (el) el.remove();
};

test('settingsOpen detects the gameSettingsContainer (any deploy hash)', () => {
  closeSettings();
  assert.equal(cst.settingsOpen(), false, 'no settings container → false');
  openSettings();
  assert.equal(cst.settingsOpen(), true, 'visible gameSettingsContainer → true');
  closeSettings();
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
