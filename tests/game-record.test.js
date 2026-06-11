'use strict';

// buildGameRecord(): the self-contained snapshot archived to chrome.storage
// when the winner line is seen. Pure data — must carry everything the popup's
// history list needs and share no live references with state.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, makeMessage } = require('./helpers/setup');

test('buildGameRecord snapshots the finished game', () => {
  cst.resetState();
  cst.state.gameStartTs = 1_000_000;
  cst.state.gameEndTs = 1_000_000 + 25 * 60 * 1000;
  const a = cst.getPlayer('Ann', '#c00');
  cst.giveResource(a, 'ore', 2);
  cst.getPlayer('Bob', '#0c0');
  cst.state.totalRolls = 41;
  cst.state.diceCounts[7] = 8;
  cst.state.blocked = { count: 1, byKey: { '6 brick': 1 } };

  const rec = cst.buildGameRecord('Ann');
  assert.equal(rec.winner, 'Ann');
  assert.equal(rec.duration, 25 * 60 * 1000);
  assert.equal(rec.totalRolls, 41);
  assert.equal(rec.diceCounts[7], 8);
  assert.equal(rec.players.length, 2);
  assert.equal(rec.players[0].hand.ore, 2);
  assert.equal(rec.blocked.byKey['6 brick'], 1);

  // Snapshots must not alias live state.
  a.resources.ore = 5;
  cst.state.blocked.count = 9;
  assert.equal(rec.players[0].hand.ore, 2, 'hand is a copy');
  assert.equal(rec.blocked.count, 1, 'blocked is a copy');
});

test('the winner line carries the winner name into the lifecycle', () => {
  cst.resetState();
  cst.processMessage(makeMessage(
    '<div class="feedMessage-x"><span class="messagePart-x">' +
    '<span style="color:#c00">Bradly</span> won the game!</span></div>'
  ));
  assert.equal(cst.getLifecycle(), cst.LIFE.ENDED);
  // (saveGameRecord is a no-op under Node — no chrome.storage — but the
  // record builder is exercised via buildGameRecord above.)
});
