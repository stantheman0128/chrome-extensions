'use strict';

// Protocol invariants for opponent hand recon — NOT frozen breakdown expectations.
// See tests/ORACLE_POLICY.md (B5 hand-recon oracle).

const B = require('../../colonist-stats-tracker/board.js');

function breakdownSum(r) {
  if (!r) return 0;
  return r[1] + r[2] + r[3] + r[4] + r[5] + (r.unknown || 0);
}

function emptyBreakdown() {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 };
}

function rawBreakdown(b, color) {
  const r = b.handRecon[String(color)];
  if (!r) return null;
  return { 1: r[1], 2: r[2], 3: r[3], 4: r[4], 5: r[5], unknown: r.unknown || 0 };
}

function colorsWithHandCount(b) {
  const out = [];
  for (const c of Object.keys(b.hands || {})) {
    const n = B.handCountOf(b, c);
    if (n != null) out.push(String(c));
  }
  return out;
}

function publicType47Production(diff) {
  const out = {};
  if (!diff || !diff.gameLogState) return out;
  for (const k of Object.keys(diff.gameLogState)) {
    const t = diff.gameLogState[k] && diff.gameLogState[k].text;
    if (!t || t.type !== 47) continue;
    if (t.distributionType !== 0 && t.distributionType !== 1) continue;
    const c = String(t.playerColor);
    out[c] = out[c] || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const res of t.cardsToBroadcast || []) {
      if (out[c][res] != null) out[c][res] += 1;
    }
  }
  return out;
}

function buyDevCard(r) {
  let spent = 0;
  for (const res of [3, 4, 5]) {
    if (r[res] > 0) { r[res] -= 1; spent += 1; }
    else if (r.unknown > 0) { r.unknown -= 1; spent += 1; }
  }
  return spent;
}

function loseOne(r) {
  const total = breakdownSum(r);
  if (total <= 0) return;
  let kept = 0;
  for (let i = 1; i <= 5; i++) { r[i] = Math.max(0, r[i] - 1); kept += r[i]; }
  r.unknown = Math.max(0, total - 1 - kept);
}

/** 1.113-style read-time lifetime re-deduct — teeth only. */
function buggyProjectRecon(b, color) {
  const r = b.handRecon[String(color)];
  if (!r) return null;
  const proj = { 1: r[1], 2: r[2], 3: r[3], 4: r[4], 5: r[5], unknown: r.unknown || 0 };
  const total = B.handCountOf(b, color);
  if (total == null) return proj;
  const buys = (b.devBought && b.devBought[String(color)]) || 0;
  for (let i = 0; i < buys; i++) buyDevCard(proj);
  const diff = total - breakdownSum(proj);
  if (diff > 0) { proj.unknown += diff; return proj; }
  let excess = -diff;
  while (excess >= 3) {
    const spent = buyDevCard(proj);
    if (!spent) break;
    excess -= spent;
  }
  for (; excess > 0; excess -= 1) loseOne(proj);
  return proj;
}

function assertTotalConservation(b, label, readBreakdown) {
  const violations = [];
  for (const color of colorsWithHandCount(b)) {
    const hand = B.handCountOf(b, color);
    const br = readBreakdown(b, color);
    const sum = br ? breakdownSum(br) : 0;
    if (sum !== hand) violations.push({ color, hand, sum, label });
  }
  return violations;
}

/** Invariant 1 — reconSum === handCount (projected by default). */
function assertInvariant1(b, label, readBreakdown = B.reconBreakdownOf.bind(B)) {
  return assertTotalConservation(b, label, readBreakdown);
}

/** Invariant 2a — public type-47 accrual into raw known piles (protocol). */
function assertInvariant2Raw(b, beforeRaw, production) {
  const violations = [];
  for (const color of Object.keys(production)) {
    const aft = rawBreakdown(b, color);
    const bef = beforeRaw[color] || emptyBreakdown();
    if (!aft) continue;
    for (let res = 1; res <= 5; res++) {
      const gained = production[color][res] || 0;
      if (gained > 0 && (aft[res] || 0) < (bef[res] || 0) + gained) {
        violations.push({ color, res, gained, before: bef[res] || 0, after: aft[res] || 0, layer: 'raw' });
      }
    }
  }
  return violations;
}

/** Invariant 2b — public type-47 visible in projected breakdown (phantom "?" guard). */
function assertInvariant2Projected(b, beforeProj, production) {
  const violations = [];
  for (const color of Object.keys(production)) {
    const raw = b.handRecon[color];
    if (raw && raw.unknown > 0) continue;
    const aft = B.reconBreakdownOf(b, color);
    const bef = beforeProj[color] || emptyBreakdown();
    if (!aft) continue;
    for (let res = 1; res <= 5; res++) {
      const gained = production[color][res] || 0;
      if (gained > 0 && (aft[res] || 0) < (bef[res] || 0) + gained) {
        violations.push({ color, res, gained, before: bef[res] || 0, after: aft[res] || 0, layer: 'projected' });
      }
    }
  }
  return violations;
}

function applyPreCatchUp(b, fixture, gamelog) {
  const from = fixture.preCatchUp.from;
  const to = fixture.preCatchUp.to;
  const devAt = fixture.devAtLogIndex || {};
  for (let i = from; i <= to; i++) {
    const entry = gamelog.gameLogState[String(i)];
    if (entry) B.applyDiff(b, { gameLogState: { [String(i)]: entry } });
    const dev = devAt[String(i)];
    if (dev) B.applyDiff(b, { mechanicDevelopmentCardsState: dev });
  }
}

function bootstrapBoard(fixture, gamelog) {
  const b = B.createBoard();
  if (fixture.accrualAtBufferStart) {
    B.restoreAccrual(b, fixture.accrualAtBufferStart);
  } else {
    B.applyFullState(b, fixture.opening.payload);
    if (fixture.preCatchUp && gamelog) applyPreCatchUp(b, fixture, gamelog);
  }
  return b;
}

function applyStep(b, step) {
  if (step.kind === 'fullState') B.applyFullState(b, step.payload);
  else if (step.kind === 'diff') B.applyDiff(b, step.diff);
  else throw new Error(`unknown step kind: ${step.kind}`);
}

function replayFixture(fixture, gamelog, opts = {}) {
  const readBreakdown = opts.readBreakdown || B.reconBreakdownOf.bind(B);
  const checkProjected = opts.checkProjected !== false;
  const b = bootstrapBoard(fixture, gamelog);
  const results = { frames: 0, invariant1: [], invariant2Raw: [], invariant2Projected: [] };

  for (let i = 0; i < fixture.steps.length; i++) {
    const step = fixture.steps[i];
    const diff = step.kind === 'diff' ? step.diff : null;
    const production = diff ? publicType47Production(diff) : {};
    const hasHands = !!(diff && diff.playerStates);
    const hasProduction = Object.keys(production).length > 0;

    const beforeRaw = {};
    const beforeProj = {};
    if (hasProduction && hasHands) {
      for (const color of Object.keys(production)) {
        beforeRaw[color] = rawBreakdown(b, color) || emptyBreakdown();
        beforeProj[color] = readBreakdown(b, color) || emptyBreakdown();
      }
    }

    applyStep(b, step);
    results.frames += 1;
    const label = `${fixture.meta.id} step ${i}`;

    if (hasHands) {
      results.invariant1.push(...assertInvariant1(b, label, readBreakdown));
      if (hasProduction) {
        results.invariant2Raw.push(...assertInvariant2Raw(b, beforeRaw, production));
        if (checkProjected) {
          results.invariant2Projected.push(...assertInvariant2Projected(b, beforeProj, production));
        }
      }
    }
  }
  return results;
}

module.exports = {
  B,
  breakdownSum,
  rawBreakdown,
  buggyProjectRecon,
  bootstrapBoard,
  applyStep,
  replayFixture,
  publicType47Production,
  assertInvariant1,
  assertInvariant2Raw,
  assertInvariant2Projected,
};
