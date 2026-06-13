'use strict';

// v1.20.0 — dice drought spotlight. coldestSum() finds the producing sum
// (2–6, 8–12; never 7) that is most overdue RELATIVE to how often it should
// appear, so common numbers (6/8) get flagged sooner than rare ones (2/12).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

function seedRolls(history) {
  cst.resetState();
  for (const n of history) {
    cst.state.diceCounts[n] += 1;
    cst.state.totalRolls += 1;
    cst.state.rollHistory.push(n);
  }
}

test('no spotlight before enough rolls have happened', () => {
  seedRolls([6, 8, 8]); // 3 rolls — too early to call anything cold
  assert.equal(cst.coldestSum(), null);
});

test('no spotlight when nothing is meaningfully overdue', () => {
  // Every sum appeared once in the last 11 rolls — no real drought.
  seedRolls([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(cst.coldestSum(), null);
});

test('spotlights a common sum (6) that has gone cold', () => {
  // One 6, then 15 straight 8s. The 6 has been absent 15 rolls; so have
  // 2/3/4/5/9/10/11/12 (absent 16, even LONGER) — but only 6 clears the
  // probability-weighted bar, because 6 is supposed to show up far more often.
  seedRolls([6, ...Array(15).fill(8)]);
  const cold = cst.coldestSum();
  assert.ok(cold, 'a cold sum is flagged');
  assert.equal(cold.n, 6, 'the common, overdue 6 is chosen over rarer 2/12');
  assert.equal(cold.k, 15, 'reports the rolls-since-last count');
});

test('never spotlights 7 (a 7 drought is good news, not a wait)', () => {
  // One 7, then 20 rolls alternating 6/8. 7 has the longest weighted factor,
  // but it must be excluded; 5 and 9 (never rolled here) are the real leaders.
  const alt = [];
  for (let i = 0; i < 20; i++) alt.push(i % 2 ? 8 : 6);
  seedRolls([7, ...alt]);
  const cold = cst.coldestSum();
  assert.ok(cold, 'a cold sum is still flagged');
  assert.notEqual(cold.n, 7, '7 is never the spotlight');
  assert.ok([5, 9].includes(cold.n), 'the genuinely overdue 5/9 is chosen');
});
