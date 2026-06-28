'use strict';

// recordTurn() times a turn as the wall-clock gap (Date.now()) between consecutive
// rolls — the protocol carries no roll timestamps. A "X rolled" row that mounts and
// processes at ENDED (after the winner line) would charge the whole post-winner gap to
// the previous roller as a bogus turn, and resaveEndgameRecord copies state.tally into
// the archived Victory record. So the roll branch must only time turns during live PLAY.
// (steal/trade counts are deliberately NOT gated — those are event counts a legitimate
// late-mounting row should still record.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, feed } = require('./helpers/setup');
const { fixtures } = require('./fixtures/game-log');

test('a roll processed at ENDED records no (bogus) turn time', () => {
  cst.resetState();
  cst.createPanel();
  cst.startNextGame();                              // → PLAYING
  cst.getPlayer('StanTheMan01', '#CF4449');
  cst.onGameWon('StanTheMan01');                    // → ENDED
  assert.equal(cst.getLifecycle(), cst.LIFE.ENDED, 'the game is ENDED');

  // a prior live roll left lastRoller/lastRollTs set, 5s before this late row (under the
  // 3-min TURN_CAP, so an un-gated recordTurn WOULD attribute it)
  cst.state.lastRoller = 'StanTheMan01';
  cst.state.lastRollTs = Date.now() - 5000;
  const before = (cst.state.tally.StanTheMan01 || {}).turnMs || 0;

  feed(fixtures.roll_2_5);                           // "StanTheMan01 rolled [2] [5]" mounts late at ENDED
  const after = (cst.state.tally.StanTheMan01 || {}).turnMs || 0;
  assert.equal(after, before, 'no turn attributed for a roll processed after the game ended');
});

test('the same roll DURING play still records the turn (the gate is lifecycle-scoped, not a kill-switch)', () => {
  cst.resetState();
  cst.createPanel();
  cst.startNextGame();                              // → PLAYING (stays)
  cst.getPlayer('StanTheMan01', '#CF4449');
  assert.equal(cst.getLifecycle(), cst.LIFE.PLAYING, 'still playing');

  cst.state.lastRoller = 'StanTheMan01';
  cst.state.lastRollTs = Date.now() - 5000;
  const before = (cst.state.tally.StanTheMan01 || {}).turnMs || 0;

  feed(fixtures.roll_2_5);
  const after = (cst.state.tally.StanTheMan01 || {}).turnMs || 0;
  assert.ok(after > before, 'a live roll still attributes the turn gap');
});
