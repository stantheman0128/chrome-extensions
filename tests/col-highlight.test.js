'use strict';

// ROADMAP item B: clicking a resource column header pins a highlight over that
// whole column EXCEPT your own cell (you read opponents' holdings, e.g. before a
// Monopoly), and each header shows opponents' total holding of that resource.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst, document } = require('./helpers/setup');

test('toggleColumnHighlight adds then removes a resource key', () => {
  cst.resetState();
  cst.getUiState().resColHighlights = [];
  cst.toggleColumnHighlight('ore');
  assert.deepEqual(cst.getUiState().resColHighlights, ['ore']);
  cst.toggleColumnHighlight('ore');
  assert.deepEqual(cst.getUiState().resColHighlights, []);
});

test('clicking a resource column pins a neon band overlay (not a per-cell background)', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('StanTheMan01', '#CF4449');
  cst.getPlayer('Sancho', '#285FBD');
  cst.getUiState().resColHighlights = ['ore'];
  cst.render();
  const wrap = document.querySelector('#cst-res-wrap');
  assert.ok(wrap.querySelector('[data-pinband="ore"]'), 'a pinned band overlay exists for the ore column');
  // The value cells themselves get NO background — the band is a separate layer.
  const oppOre = document.querySelector('[data-cell="Sancho|ore"]');
  assert.doesNotMatch(oppOre.getAttribute('style') || '', /background/, 'cells are not individually shaded');
  // Unpinning removes the band.
  cst.getUiState().resColHighlights = [];
  cst.render();
  assert.equal(wrap.querySelector('[data-pinband="ore"]'), null, 'band removed when unpinned');
});

test('a pinned resource header shows opponents\' total holding, excluding self', () => {
  cst.resetState();
  cst.createPanel();
  const me = cst.getPlayer('StanTheMan01', '#CF4449');
  const opp = cst.getPlayer('Sancho', '#285FBD');
  cst.state.selfName = 'StanTheMan01';
  me.resources.ore = 5;     // self's ore must NOT be counted
  opp.resources.ore = 3;    // opponents hold 3
  cst.getUiState().resColHighlights = [];
  cst.render();
  assert.doesNotMatch(document.querySelector('#colonist-stats-tracker').innerHTML, /Opponents hold/, 'hidden until the column is pinned');
  cst.getUiState().resColHighlights = ['ore'];
  cst.render();
  assert.match(document.querySelector('#colonist-stats-tracker').innerHTML, /Opponents hold 3/, 'pinned ore header shows opponents hold 3 (self 5 excluded)');
});
