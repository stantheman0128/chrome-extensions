'use strict';

// The log container can be REPLACED mid-game without the game changing — e.g. a
// disable-karma vote injects UI into the log area and colonist re-wraps the
// feed in a new node. Treating that identity change as a reconnect wipes the
// dedup set and triggers a (non-deterministic) deepRescrape, which is what makes
// repeated reads disagree. attachObserver must recognise a re-wrapped-but-
// continuous log and keep its state.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst, document } = require('./helpers/setup');

function mountGame(names) {
  document.body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.innerHTML = names
    .map((n) => `<div data-player-color="1"><div class="username-x">${n}</div></div>`)
    .join('');
  document.body.appendChild(wrap);
}

// A colonist-style virtual-scroll log: a virtualScroller with one
// scrollItemContainer[data-index] per rendered row, each holding a feedMessage.
function makeLogContainer(indices) {
  const vs = document.createElement('div');
  vs.className = 'virtualScroller-test';
  for (const idx of indices) {
    const sc = document.createElement('div');
    sc.className = 'scrollItemContainer-test';
    sc.setAttribute('data-index', String(idx));
    sc.innerHTML = '<div class="feedMessage-x"><span class="messagePart-x">x</span></div>';
    vs.appendChild(sc);
  }
  return vs;
}

test('logIsContinuation: a container sharing a seen data-index is a continuation', () => {
  cst.resetState();
  cst.state.seenIndices.add('5');
  assert.equal(cst.logIsContinuation(makeLogContainer([4, 5, 6])), true);
});

test('logIsContinuation: a container with all-new indices is a real swap', () => {
  cst.resetState();
  cst.state.seenIndices.add('5');
  assert.equal(cst.logIsContinuation(makeLogContainer([100, 101])), false);
});

test('logIsContinuation: an empty container (a vote briefly took over the log) is continuation', () => {
  cst.resetState();
  cst.state.seenIndices.add('5');
  // A karma vote injects UI and the log container momentarily renders no rows.
  // That transient empty state must NOT be read as a brand-new log.
  assert.equal(cst.logIsContinuation(makeLogContainer([])), true);
});

test('attachObserver keeps dedup when the log container is merely re-wrapped (karma vote)', () => {
  cst.resetState();
  mountGame(['A', 'B']);
  cst.evalLifecycle();                          // → PLAYING
  const c1 = makeLogContainer([5]);
  document.body.appendChild(c1);
  cst.attachObserver();                         // observedContainer = c1, sees index 5
  cst.state.seenIndices.add('3');               // an earlier row, now scrolled out of view
  document.body.removeChild(c1);
  const c2 = makeLogContainer([5]);             // re-wrap: new node, same index, no row 3
  document.body.appendChild(c2);
  cst.attachObserver();
  assert.ok(cst.state.seenIndices.has('3'),
    'a re-wrapped, still-continuous log must not wipe dedup (no needless rescrape)');
});

test('deepRescrape reads every row of the log and terminates', async () => {
  cst.resetState();
  document.body.innerHTML = '';          // isolate from earlier tests' leftover containers
  const log = makeLogContainer([0, 1, 2, 3, 4]);
  document.body.appendChild(log);
  await cst.deepRescrape();
  assert.equal(cst.state.seenIndices.size, 5, 'every row read, loop terminated');
});
