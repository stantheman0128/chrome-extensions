'use strict';

// B5 — hand-recon regression oracle (protocol invariants, NOT frozen breakdowns).
// Ground truth:
//   (1) reconSumOf === handCountOf whenever WS reports hand size
//   (2) public type-47 production accrues into known resIds (raw + projected when clean)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  B,
  replayFixture,
  bootstrapBoard,
  applyStep,
  buggyProjectRecon,
} = require('./helpers/hand-recon-oracle');

const ORACLE_DIR = path.join(__dirname, 'fixtures', 'oracle');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ORACLE_DIR, name), 'utf8'));
}

function loadGamelog(name) {
  return require(path.join(__dirname, 'fixtures', name));
}

const frame50 = loadJson('frame50-hand-recon-replay.json');
const deal2630 = loadJson('deal2630-4p-recon-replay.json');
const deal2630Log = loadGamelog('ws-deal2630-4p-gamelog.json');

test('frame50: every step satisfies total conservation + projected public production', () => {
  const r = replayFixture(frame50, null);
  assert.equal(r.frames, frame50.steps.length);
  assert.deepEqual(r.invariant1, [], `invariant1: ${JSON.stringify(r.invariant1[0] || {})}`);
  assert.deepEqual(r.invariant2Raw, []);
  assert.deepEqual(r.invariant2Projected, [], `invariant2 projected: ${JSON.stringify(r.invariant2Projected[0] || {})}`);
});

test('deal2630 4p: every hand-count frame satisfies total conservation', () => {
  const r = replayFixture(deal2630, deal2630Log);
  assert.ok(r.frames >= 40, `expected many buffer steps, got ${r.frames}`);
  assert.deepEqual(r.invariant1, [], `invariant1: ${JSON.stringify(r.invariant1[0] || {})}`);
});

test('deal2630 4p: public type-47 accrues into raw known piles (protocol layer)', () => {
  const r = replayFixture(deal2630, deal2630Log);
  assert.deepEqual(r.invariant2Raw, [], `invariant2 raw: ${JSON.stringify(r.invariant2Raw[0] || {})}`);
});

test('deal2630 4p: projected public production when raw recon has no unknowns', () => {
  const r = replayFixture(deal2630, deal2630Log, { checkProjected: true });
  assert.deepEqual(r.invariant2Projected, [], `invariant2 projected: ${JSON.stringify(r.invariant2Projected[0] || {})}`);
});

test('teeth: 1.113-style lifetime re-deduct hides public ore after frame50 production step', () => {
  const b = bootstrapBoard(frame50, null);
  applyStep(b, frame50.steps[0]);
  applyStep(b, frame50.steps[1]);

  const last = frame50.steps[2];
  applyStep(b, last);

  const good = B.reconBreakdownOf(b, 2);
  assert.equal(good[5], 2, 'correct board keeps both ore known');
  assert.equal(good.unknown, 0);

  const buggy = buggyProjectRecon(b, 2);
  assert.ok((buggy[5] || 0) < 2, 'lifetime re-deduct at read time eats publicly broadcast ore');
  assert.ok(buggy.unknown > good.unknown, 'ore shifts into unknown under the 1.113 read-time bug');
});

test('fixture policy: recon replay fixtures store inputs only (no expected breakdown)', () => {
  for (const fx of [frame50, deal2630]) {
    assert.ok(fx.opening && fx.steps, `${fx.meta.id} has opening + steps`);
    assert.equal(fx.expectedBreakdown, undefined, `${fx.meta.id} must not freeze breakdown`);
    assert.match(fx.meta.oraclePolicy, /invariant/i);
  }
});
