'use strict';

// Stat-column icons prefer colonist's own artwork. We can't hardcode the CDN URLs
// (they carry a per-deploy hash), so harvestIcons collects them from the live DOM
// by their stable base name (stat_rolling_loss, stat_robbing_loss, stat_res_gain,
// stat_trade_loss, …) and caches them; the header renders the cached image when
// present, else a self-drawn SVG fallback. Never blank, and adapts on redeploy.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst, document } = require('./helpers/setup');

test('harvestIcons caches a colonist stat icon URL found in the DOM (hash-tolerant)', () => {
  cst.resetState();
  const url = 'https://cdn.colonist.io/dist/assets/stat_rolling_loss.abcd1234ef98.svg';
  document.body.innerHTML = `<img src="${url}">`;
  cst.harvestIcons();
  assert.equal(cst.getAssetUrls().stat_rolling_loss, url);
});

test('a stat header uses the colonist image when cached, else the fallback svg', () => {
  cst.resetState();
  const cache = cst.getAssetUrls();
  Object.keys(cache).forEach((k) => delete cache[k]);   // start with an empty cache
  cst.createPanel();
  cst.getPlayer('A', '#c00');
  cst.getUiState().resView = 'stats';
  cst.render();
  const h1 = document.querySelector('[data-colhead][data-res="s-block"]');
  assert.match(h1.innerHTML, /<svg/i, 'no cache → self-drawn svg fallback');
  cache.stat_rolling_loss = 'https://cdn.colonist.io/dist/assets/stat_rolling_loss.x.svg';
  cst.render();
  const h2 = document.querySelector('[data-colhead][data-res="s-block"]');
  assert.match(h2.innerHTML, /<img[^>]*stat_rolling_loss/i, 'cached → colonist image');
});

test('the gain column now targets a colonist asset (no longer self-drawn only)', () => {
  cst.resetState();
  const cache = cst.getAssetUrls();
  Object.keys(cache).forEach((k) => delete cache[k]);
  cache.stat_res_gain = 'https://cdn.colonist.io/dist/assets/stat_res_gain.x.svg';
  cst.createPanel();
  cst.getPlayer('A', '#c00');
  cst.getUiState().resView = 'stats';
  cst.render();
  const h = document.querySelector('[data-colhead][data-res="s-gain"]');
  assert.match(h.innerHTML, /<img[^>]*stat_res_gain/i, 's-gain uses the colonist image');
});
