'use strict';

// Regression: the snake-draft pivot player (last to place in round 1, first in
// round 2) places both settlements back-to-back and immediately receives
// starting resources — with no other player's message in between. Nothing
// snapshots them at 0 before that gain, so they were absent from the previous
// render's snapshot. spawnGainFloats() used to skip any player missing from the
// snapshot (`if (!old) continue`), swallowing the pivot's first +N float; only
// later players (already snapshotted at 0) floated. Players always start at 0,
// so a missing baseline must be treated as zero — the +N "shower" after a
// reset/restore/rescrape is already prevented by the separate null-prev guard.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

// Float spans are appended directly to #cst-res-wrap (siblings of the table).
function floatCount() {
  const wrap = document.querySelector('#cst-res-wrap');
  return [...wrap.children].filter(
    (el) => el.tagName === 'SPAN' && /^[+−]/.test(el.textContent || '')
  ).length;
}

test('the snake-draft pivot player floats +N on their first resources', () => {
  cst.resetState();
  cst.createPanel();
  cst.render(); // boot: prev was null → baseline set, non-null from here

  // Earlier players exist and get snapshotted at 0 by a render (as in round 1).
  cst.getPlayer('P1', '#CF4449');
  cst.getPlayer('P2', '#285FBD');
  cst.render();
  assert.equal(floatCount(), 0, 'no floats yet — nobody has gained');

  // The pivot is created AFTER the last render, then immediately gains — it is
  // absent from the previous snapshot.
  const pivot = cst.getPlayer('P4', '#228103');
  cst.giveResource(pivot, 'lumber', 1);
  cst.giveResource(pivot, 'wool', 1);
  cst.render();

  assert.equal(floatCount(), 2, 'pivot first gain floats +1 lumber and +1 wool');
});
