'use strict';

// WS game-log dedup must survive an entry that first arrives as an EMPTY SHELL.
// The old code keyed dedup off a single max index (seenLog) and advanced it before
// confirming the entry had content, so a shell at index N permanently blocked the
// real entry that filled N later — the same class of bug the DOM reader hit in 1.41.
// colonist's gameLogState also SKIPS indices (a real capture jumps 65 -> 68), so a
// contiguous floor won't do; dedup is by a processed-index set.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

test('an entry that first arrives as an empty shell is processed once it fills (not skipped)', () => {
  const b = B.createBoard();
  // index 4 is a real roll; index 5 arrives in the same frame as a shell (no text)
  B.applyDiff(b, { gameLogState: {
    4: { text: { type: 10, firstDice: 4, secondDice: 4 } },
    5: { from: 1 },
  } });
  assert.equal(B.diceOf(b).total, 1, 'the real roll at 4 accrued; the shell at 5 did not');
  // index 5 fills with its real content a frame later
  B.applyDiff(b, { gameLogState: { 5: { text: { type: 10, firstDice: 5, secondDice: 5 } } } });
  assert.equal(B.diceOf(b).total, 2, 'the now-filled entry at 5 is processed, not skipped');
  // replaying the same entry does not double-count
  B.applyDiff(b, { gameLogState: { 5: { text: { type: 10, firstDice: 5, secondDice: 5 } } } });
  assert.equal(B.diceOf(b).total, 2, 'no double count on replay');
});

test('skipped indices in the log do not stall later entries (colonist jumps indices)', () => {
  const b = B.createBoard();
  B.applyDiff(b, { gameLogState: { 65: { text: { type: 10, firstDice: 3, secondDice: 3 } } } });
  // 66, 67 never appear; 68 must still be processed
  B.applyDiff(b, { gameLogState: { 68: { text: { type: 10, firstDice: 6, secondDice: 6 } } } });
  assert.equal(B.diceOf(b).total, 2, 'index 68 processed despite the 66/67 gap');
});
