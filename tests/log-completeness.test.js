'use strict';

// A virtual log row can mount as an EMPTY shell — its data-index is set but the
// feedMessage content is rendered a frame later. That fill arrives as inner
// spans/imgs (NOT a fresh scrollItemContainer), so the observer's added-node
// path doesn't re-read the row. If processItem commits the dedup during the
// empty shell, the row's event is lost forever once it fills:
//   • a missed roll → the dice count is short one  (Stan: "少算一次擲骰")
//   • a missed got  → reconcileTotal pads the gap as "unknown" (self breakdown wrong)
//   • rescrape races → repeated reads disagree (resync inconsistency)
// processItem must only mark a row seen once it actually has text.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, document } = require('./helpers/setup');
const { fixtures: F } = require('./fixtures/game-log');

function mountRow(container, idx, html) {
  const row = document.createElement('div');
  row.className = 'scrollItemContainer-test';
  row.setAttribute('data-index', String(idx));
  if (html) row.innerHTML = html.trim();
  container.appendChild(row);
  return row;
}

test('a row that mounts empty then fills is still read (no lost roll)', () => {
  cst.resetState();
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);

  // 1) Empty shell: data-index present, no feedMessage yet.
  const row = mountRow(container, 42, '');
  cst.scanExisting(container);
  assert.equal(cst.state.diceCounts[7], 0, 'nothing parsed from an empty shell');
  assert.equal(cst.state.seenIndices.has('42'), false, 'an empty shell must NOT be marked seen');

  // 2) colonist fills the SAME row a frame later (inner content).
  row.innerHTML = F.roll_2_5.trim();   // StanTheMan01 rolled 2 + 5 = 7
  cst.scanExisting(container);
  assert.equal(cst.state.diceCounts[7], 1, 'the roll is counted once the row has content');
  assert.equal(cst.state.sevenRollers.StanTheMan01, 1);
  assert.equal(cst.state.seenIndices.has('42'), true, 'now committed to the dedup set');

  // 3) A later rescan must not double-count it.
  cst.scanExisting(container);
  assert.equal(cst.state.diceCounts[7], 1, 'no double count on re-scan');
});

test('a fully-mounted row is read exactly once across repeated scans', () => {
  cst.resetState();
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountRow(container, 7, F.roll_2_5);
  cst.scanExisting(container);
  cst.scanExisting(container);
  assert.equal(cst.state.diceCounts[7], 1, 'read once despite two scans');
});

const tick = () => new Promise((r) => setTimeout(r, 0));

// The per-tick scan is a 1s safety net; in a burst the row could recycle before
// it runs. The observer should catch the fill THE MOMENT it lands, by re-reading
// the enclosing row when content is added into it (not just on row mount).
test('the observer re-reads a row when its content is filled in after mount (burst-safe)', async () => {
  cst.resetState();
  document.body.innerHTML = '';
  const vs = document.createElement('div');
  vs.className = 'virtualScroller-test';
  document.body.appendChild(vs);
  cst.attachObserver();                       // observe the (empty) scroller

  // Empty shell mounts (data-index, no content yet).
  const row = document.createElement('div');
  row.className = 'scrollItemContainer-test';
  row.setAttribute('data-index', '88');
  vs.appendChild(row);
  await tick();
  assert.equal(cst.state.diceCounts[7], 0, 'an empty shell parses nothing');

  // colonist fills the SAME row a frame later.
  row.innerHTML = F.roll_2_5.trim();          // StanTheMan01 rolled 2 + 5 = 7
  await tick();
  assert.equal(cst.state.diceCounts[7], 1, 'the observer read the row the instant it filled');
});
