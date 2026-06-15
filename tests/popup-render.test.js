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

// getMessage defaults to '' (empty → the code's hardcoded fallbacks). Pass a
// {key: template} map to exercise the real i18n substitution path instead — the
// {x} tokens in those templates are substituted by popup.js's own M() helper.
function bootWith(history, messages) {
  const html = fs.readFileSync(path.join(POPUP_DIR, 'popup.html'), 'utf8');
  const dom = new JSDOM(html);
  global.window = dom.window;
  global.document = dom.window.document;
  global.chrome = {
    i18n: { getMessage: (key) => (messages && messages[key]) || '' },
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

// REGRESSION: the lifeBlockLoss locale message must carry {b}/{l} placeholders,
// or M() silently drops the figures and the user sees a bare label. The other
// render tests stub getMessage → '' (fallback path), which can't catch this — so
// here we stub a real template WITH placeholders and assert the number lands.
test('lifeBlockLoss summary substitutes the block-loss figure into the locale message', () => {
  const game = {
    date: 1000, duration: 600000, winner: 'Me', selfName: 'Me', totalRolls: 30,
    diceCounts: { 6: 5, 8: 5 },
    players: [{ name: 'Me', color: '#CF4449', hand: { grain: 2 }, unknown: 0 }],
    tally: { Me: { gained: 10, lost: 0, turnMs: 0, turns: 0 } },
    blocked: {}, blockLoss: { Me: 4 },                    // one played game → avg 4
  };
  const doc = bootWith([game], { lifeBlockLoss: 'blocked {b} lost {l}' });
  const text = doc.getElementById('summary').textContent;
  assert.match(text, /blocked 4 lost/, 'the avgBlockLoss number is substituted, not dropped');
});

// And the shipped locale strings themselves must carry the {b}/{l} tokens the
// call site fills in — otherwise the substitution above has nothing to land on
// once a real locale is loaded. (This is the exact bug the message reviewer found.)
test('shipped lifeBlockLoss messages keep the {b}/{l} placeholders', () => {
  for (const locale of ['en', 'zh_TW']) {
    const msgs = JSON.parse(
      fs.readFileSync(path.join(POPUP_DIR, '_locales', locale, 'messages.json'), 'utf8'));
    const m = msgs.lifeBlockLoss && msgs.lifeBlockLoss.message;
    assert.ok(m, `${locale}: lifeBlockLoss exists`);
    assert.ok(m.includes('{b}'), `${locale}: lifeBlockLoss keeps the {b} block-loss token`);
    assert.ok(m.includes('{l}'), `${locale}: lifeBlockLoss keeps the {l} lost token`);
  }
});
