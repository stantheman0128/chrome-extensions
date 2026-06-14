'use strict';

// v1.30.0 — jsdom smoke test for the popup's render path. aggregate() is covered
// by popup-aggregate.test.js; this drives boot() against the real popup.html with
// a stubbed chrome + a history fixture, so the summary/histogram/history DOM is
// actually built (catches id typos, NaN bar heights, missing elements, etc.).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const POPUP_DIR = path.join(__dirname, '..', 'colonist-stats-tracker');
const popup = require(path.join(POPUP_DIR, 'popup.js'));

function bootWith(history) {
  const html = fs.readFileSync(path.join(POPUP_DIR, 'popup.html'), 'utf8');
  const dom = new JSDOM(html);
  global.window = dom.window;
  global.document = dom.window.document;
  global.chrome = {
    i18n: { getMessage: () => '' },                       // empty → code fallbacks
    runtime: { getManifest: () => ({ version: '9.9.9' }) },
    storage: { local: { get: (keys, cb) => cb({ 'cst-history': history }) } },
  };
  popup.boot();
  return dom.window.document;
}

const oneGame = {
  date: 1000, duration: 600000, winner: 'Me', selfName: 'Me',
  totalRolls: 30,
  diceCounts: { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 4, 9: 3, 10: 2, 11: 1, 12: 1 },
  players: [{ name: 'Me', color: '#CF4449', hand: { grain: 2 }, unknown: 1 }],
  tally: { Me: { gained: 25, stole: 3, lost: 1, turnMs: 90000, turns: 9 } },
  blocked: {},
};

test('boot renders the lifetime summary when history exists', () => {
  const doc = bootWith([oneGame]);
  const summary = doc.getElementById('summary');
  assert.notEqual(summary.style.display, 'none', 'summary is shown');
  assert.ok(summary.querySelector('.sum-head'), 'has a heading');
  // 11 histogram bars + 11 labels.
  assert.equal(summary.querySelectorAll('.sum-bar').length, 11, 'one bar per sum 2-12');
  assert.equal(summary.querySelectorAll('.sum-num').length, 11, 'one label per sum');
  // No bar height should be NaN/undefined.
  summary.querySelectorAll('.sum-bar').forEach((b) => {
    assert.match(b.style.height, /^\d+%$/, 'bar height is a clean percentage');
  });
  assert.ok(summary.querySelectorAll('.sum-line').length >= 2, 'has summary text lines');
  // The version still got injected.
  assert.equal(doc.getElementById('ver').textContent, 'v9.9.9');
});

test('boot hides the summary and shows the empty hint when there is no history', () => {
  const doc = bootWith([]);
  assert.equal(doc.getElementById('summary').style.display, 'none', 'summary hidden when empty');
  assert.ok(doc.getElementById('history').textContent.length > 0, 'shows the empty-history hint');
});
