'use strict';

// Bank-derived opponent resolution. colonist broadcasts the supply (bankState), and
// each base resource has 19 cards, so `19 - bank - self` is the exact combined total
// opponents hold of that resource. A conservation gate (combined total === Σ opponent
// hand counts) decides whether the bank is trustworthy, so a masked / expansion / stale
// supply auto-falls-back to the log-recon projection. 1v1 resolves an opponent exactly;
// with more opponents, the sole holder of unknowns is still exact.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// real ids for self (revealed), masked 0s for an opponent's count
function cards(ids) { return { cards: ids.slice() }; }
function masked(n) { return { cards: new Array(n).fill(0) }; }
function brk(o) { return [1, 2, 3, 4, 5].map((r) => o[r] || 0).concat(o.unknown || 0); }

test('1v1: the opponent hand is resolved EXACTLY from the bank, overriding a clueless recon', () => {
  const b = B.createBoard();
  b.selfColor = 1;
  b.hands['1'] = cards([5, 5, 5, 4, 4]);                 // self: ore3 grain2 (revealed)
  b.hands['2'] = masked(4);                              // opponent: 4 cards, types hidden
  // opponent truly holds lumber1 brick1 wool2 → bank = 19 - held - self
  b.bank = { 1: 18, 2: 18, 3: 17, 4: 17, 5: 16 };
  B.__setRecon(b, 2, { unknown: 4 });                    // recon knows nothing — pure unknown

  const got = B.reconBreakdownOf(b, 2);
  assert.deepEqual(brk(got), brk({ 1: 1, 2: 1, 3: 2, unknown: 0 }), 'bank gives the exact split, 0 unknown');
});

test('a masked bank fails the conservation gate → falls back to the recon projection', () => {
  const b = B.createBoard();
  b.selfColor = 1;
  b.hands['1'] = cards([5, 5, 5, 4, 4]);
  b.hands['2'] = masked(4);
  b.bank = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };             // hidden → zeros: derived combined total blows past 4
  B.__setRecon(b, 2, { 2: 1, unknown: 3 });              // projection: brick1 + ?3 (sum 4)

  assert.equal(B.bankOppTotalsOf(b), null, 'gate rejects the masked bank');
  const got = B.reconBreakdownOf(b, 2);
  assert.deepEqual(brk(got), brk({ 2: 1, unknown: 3 }), 'display fell back to the projection, no crash');
});

test('an incomplete supply (a missing resource) is not usable → projection', () => {
  const b = B.createBoard();
  b.selfColor = 1;
  b.hands['1'] = cards([5]);
  b.hands['2'] = masked(2);
  b.bank = { 1: 18, 2: 18, 3: 18, 4: 18 };               // resId 5 missing
  B.__setRecon(b, 2, { unknown: 2 });

  assert.equal(B.bankOppTotalsOf(b), null);
  assert.deepEqual(brk(B.reconBreakdownOf(b, 2)), brk({ unknown: 2 }));
});

test('3-4p: the SOLE holder of unknowns is resolved exactly from the leftover', () => {
  const b = B.createBoard();
  b.selfColor = 1;
  b.hands['1'] = cards([]);                              // self holds nothing (spectator-like)
  b.hands['2'] = masked(1);                              // Clover: 1 card, fully known via recon
  b.hands['3'] = masked(1);                              // Farl:   1 card, fully known via recon
  b.hands['4'] = masked(2);                              // Arman:  2 cards, all unknown
  // truth: Clover lumber1, Farl brick1, Arman wool1 ore1 → bank = 19 - combined
  b.bank = { 1: 18, 2: 18, 3: 18, 4: 19, 5: 18 };
  B.__setRecon(b, 2, { 1: 1, unknown: 0 });             // lumber1 known
  B.__setRecon(b, 3, { 2: 1, unknown: 0 });             // brick1 known
  B.__setRecon(b, 4, { unknown: 2 });                   // both unknown

  const got = B.reconBreakdownOf(b, 4);
  assert.deepEqual(brk(got), brk({ 3: 1, 5: 1, unknown: 0 }), 'Arman resolves to wool1 ore1 from the leftover');
});

test('3-4p: when two opponents both hold unknowns, the bank cannot split → projection (no crash)', () => {
  const b = B.createBoard();
  b.selfColor = 1;
  b.hands['1'] = cards([]);
  b.hands['2'] = masked(2);                              // Clover: 2 unknown
  b.hands['3'] = masked(1);                              // Farl: 1 known
  b.hands['4'] = masked(2);                              // Arman: 2 unknown
  b.bank = { 1: 18, 2: 18, 3: 18, 4: 19, 5: 18 };       // combined opp = lum1 brk1 wol1 ore1 = 4 ... but handsum=5
  // make it consistent: combined must equal handsum (5). truth lum1 brk1 wol1 ore1 grn1 = 5
  b.bank = { 1: 18, 2: 18, 3: 18, 4: 18, 5: 18 };
  B.__setRecon(b, 2, { unknown: 2 });
  B.__setRecon(b, 3, { 2: 1, unknown: 0 });
  B.__setRecon(b, 4, { unknown: 2 });

  // Arman has unknowns but so does Clover → not the sole holder → bank declines, projection used
  const got = B.reconBreakdownOf(b, 4);
  const sum = brk(got).reduce((s, n) => s + n, 0);
  assert.equal(sum, 2, 'projection still sums to the authoritative hand count');
  assert.ok(got.unknown > 0, 'left honestly unknown — bank did not guess a split');
});

test('multi-opponent gate with an un-named opponent does NOT crash (audit: null projectRecon deref)', () => {
  const b = B.createBoard();
  b.selfColor = 3;
  b.hands['3'] = cards([1]);                             // self: 1 lumber (revealed)
  b.hands['1'] = masked(1);                              // opp 1: 1 card, has a recon
  b.hands['2'] = masked(1);                              // opp 2: 1 card, NO recon yet (early game)
  b.bank = { 1: 17, 2: 18, 3: 19, 4: 19, 5: 19 };       // totals {1:1,2:1}=2 == Σ opp counts 2 → gate passes, oppColors=[1,2]
  B.__setRecon(b, 1, { 1: 1, unknown: 0 });             // opp 1 known; opp 2 left with no handRecon entry

  // The multi-opponent branch used to deref projectRecon(2) === null → throw. Must not.
  let got;
  assert.doesNotThrow(() => { got = B.reconBreakdownOf(b, 1); }, 'no null-deref crash');
  assert.equal(brk(got).reduce((s, n) => s + n, 0), 1, 'falls back to a valid projection summing to handCount');
});

test('applyFullState reads a top-level playerColor (so self is not mis-counted as an opponent)', () => {
  const b = B.createBoard();
  // some colonist full states carry playerColor at the payload top level, not under gameState
  B.applyFullState(b, {
    playerColor: 2,
    gameSettings: { id: 'top' },
    gameState: { mapState: { tileHexStates: {}, tileCornerStates: {} }, playerStates: {} },
    playerUserStates: [],
  });
  assert.equal(b.selfColor, 2, 'selfColor self-heals from the top-level playerColor');
});

test('an opponent carrying a negative-unknown debt (1.126 masked steal) makes the bank bail to projection, never a hard split', () => {
  const b = B.createBoard();
  b.selfColor = 1;
  b.hands['1'] = cards([]);                              // self holds nothing
  b.hands['2'] = masked(1);                              // opp 2: 1 card
  b.hands['3'] = masked(1);                              // opp 3: 1 card
  b.bank = { 1: 18, 2: 18, 3: 19, 4: 19, 5: 19 };       // totals {1:1,2:1}=2 == Σ opp counts → gate passes
  B.__setRecon(b, 2, { 1: 2, unknown: -1 });            // reconStealOne left a negative-unknown debt (sum 1 = handCount)
  B.__setRecon(b, 3, { 2: 1 });

  assert.ok(B.bankOppTotalsOf(b), 'the conservation gate still passes');
  let got;
  assert.doesNotThrow(() => { got = B.reconBreakdownOf(b, 2); }, 'no crash on a negative-unknown opponent');
  // the combined guard `if (!pr || pr.unknown < 0) return null` bails → the projection stands,
  // keeping the victim's known breakdown rather than letting the bank invent a hard split
  assert.deepEqual({ ...got }, { 1: 2, 2: 0, 3: 0, 4: 0, 5: 0, unknown: -1 }, 'projection kept; bank did not hard-split');
});
