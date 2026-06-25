'use strict';

// Time-aware recon settle. The opponent hand recon credits public production into
// the right resource, but the read-time projectRecon used to clamp the whole raw
// recon down to colonist's authoritative handCount — so an OLD over-count debt (a
// silent loss we never saw) would eat a freshly-broadcast type-47 production and
// show it as "?". The fix settles the old debt against the CURRENT handCount at the
// start of each live diff, BEFORE the new log is accrued, so stale uncertainty only
// touches stale state and the next public production stays known.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// a live diff carrying a roll + one player's type-47 production + their new hand count
function rollDiff(idxRoll, idxProd, prodColor, cards, newCount) {
  return {
    gameLogState: {
      [idxRoll]: { text: { type: 10, playerColor: 1, firstDice: 3, secondDice: 3 } },
      [idxProd]: { text: { type: 47, playerColor: prodColor, cardsToBroadcast: cards, distributionType: 1 } },
    },
    playerStates: { [prodColor]: { resourceCards: { cards: new Array(newCount).fill(0) } } },
  };
}

test('A — a fresh public production stays known instead of being eaten by old debt (Clover)', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(5).fill(0) };          // Clover handCount = 5
  B.__setRecon(b, 2, { 2: 3, 5: 2, unknown: 2 });          // raw = brick3 ore2 ?2 (sum 7, over by 2)

  // Clover rolls into +grain grain; handCount 5 → 7. The 2-card debt must settle
  // against the pre-production hand, not swallow the new grain.
  B.applyDiff(b, rollDiff(400, 401, 2, [4, 4], 7));

  const proj = B.reconBreakdownOf(b, 2);
  assert.equal(B.handCountOf(b, 2), 7, 'authoritative count followed the diff');
  assert.ok(proj[4] >= 2, `the freshly broadcast 2 grain stay known, got grain=${proj[4]}`);
  // the specific bug shape: brick1 grain0 ore0 unknown6 — must NOT happen
  assert.ok(!(proj[4] === 0 && proj.unknown === 6), 'production not collapsed into unknown');
});

test('B — production credits the broadcast resources as known (Arman)', () => {
  const b = B.createBoard();
  b.hands['4'] = { cards: new Array(4).fill(0) };          // Arman handCount = 4
  B.__setRecon(b, 4, { 5: 2, unknown: 1 });                // raw = ore2 ?1 (sum 3)

  B.applyDiff(b, rollDiff(410, 411, 4, [4, 5, 5], 7));     // +grain +ore +ore, count 4 → 7

  const proj = B.reconBreakdownOf(b, 4);
  assert.equal(proj[4], 1, 'grain1 known');
  assert.equal(proj[5], 4, 'ore4 known (2 prior + 2 produced)');
});

test('C — with no authoritative handCount, settle leaves the raw recon untouched', () => {
  const b = B.createBoard();
  // color 3 has a recon but NO hand entry → handCount is null (DOM-fallback territory)
  B.__setRecon(b, 3, { 1: 2, unknown: 1 });
  const before = JSON.stringify(b.handRecon[3]);

  B.applyDiff(b, { gameLogState: { 420: { text: { type: 10, playerColor: 1, firstDice: 2, secondDice: 2 } } } });

  assert.equal(JSON.stringify(b.handRecon[3]), before, 'no count → no settle, raw kept for the DOM fallback');
});

test('D — settling is idempotent and never runs the hand below the authoritative count', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(4).fill(0) };          // handCount = 4
  B.__setRecon(b, 2, { 2: 3, 5: 3, unknown: 0 });          // raw = brick3 ore3 (sum 6, over by 2)

  B.applyDiff(b, {});                                       // a bare diff just settles
  const after1 = JSON.stringify(b.handRecon[2]);
  B.applyDiff(b, {});
  B.applyDiff(b, {});
  const after3 = JSON.stringify(b.handRecon[2]);

  assert.equal(after1, after3, 'repeated settles converge — no runaway erosion');
  const sum = [1, 2, 3, 4, 5].reduce((s, r) => s + b.handRecon[2][r], 0) + b.handRecon[2].unknown;
  assert.equal(sum, 4, 'settled raw matches the authoritative handCount, not below');
});
