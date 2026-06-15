'use strict';

// v1.30.0 — the popup's lifetime ("your luck over time") summary. aggregate()
// is a pure function over the per-game history records, so it's unit-tested here
// directly (popup.js exports it under CommonJS and guards its DOM bootstrap).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const popup = require('../colonist-stats-tracker/popup.js');

// Minimal game record, shaped like buildGameRecord() in content.js.
function game({ winner = null, self = 'Me', dice = {}, tally = {}, duration = 600000 }) {
  return {
    date: 1000, duration, winner, selfName: self,
    totalRolls: Object.values(dice).reduce((a, b) => a + b, 0),
    diceCounts: dice, players: [], tally, blocked: {},
  };
}

test('aggregate of an empty history is all-zero / null, never NaN', () => {
  const a = popup.aggregate([]);
  assert.equal(a.games, 0);
  assert.equal(a.played, 0);
  assert.equal(a.wins, 0);
  assert.equal(a.winRate, null);
  assert.equal(a.avgDurationMs, null);
  assert.equal(a.avgIncome, null);
  assert.equal(a.avgTurnMs, null);
  assert.equal(a.fairness, null);
  assert.equal(a.diceTotal, 0);
});

test('aggregate counts games / wins / income / turn time / block loss over played games', () => {
  const a = popup.aggregate([
    game({ winner: 'Me',  tally: { Me: { gained: 30, lost: 1, turnMs: 100000, turns: 10 } } }),
    game({ winner: 'Bob', tally: { Me: { gained: 20, lost: 3, turnMs: 80000,  turns: 8  } } }),
    game({ winner: 'Me',  tally: { Me: { gained: 40, lost: 0, turnMs: 120000, turns: 12 } } }),
  ]);
  assert.equal(a.games, 3);
  assert.equal(a.played, 3);
  assert.equal(a.wins, 2);
  assert.equal(Math.round(a.winRate * 1000), 667, 'win rate = 2/3');
  assert.equal(a.avgIncome, 30, 'avg income = (30+20+40)/3');
  assert.equal(a.avgTurnMs, 10000, 'avg turn = total ms / total turns = 300000/30');
  assert.equal(a.avgBlockLoss, 0, 'avgBlockLoss = 0 when no blockLoss on records (legacy)');
  assert.equal(Math.round(a.avgLosses * 100), 133, 'avg losses = 4/3');
});

test('a spectated game (selfName null) counts dice but not played / wins', () => {
  const a = popup.aggregate([
    game({ winner: 'Me', self: 'Me', dice: { 6: 3, 8: 3 },
           tally: { Me: { gained: 10, stole: 0, lost: 0, turnMs: 0, turns: 0 } } }),
    game({ winner: 'Carol', self: null, dice: { 7: 5 } }),  // watched, not played
  ]);
  assert.equal(a.games, 2, 'both games counted');
  assert.equal(a.played, 1, 'only the one you played in');
  assert.equal(a.wins, 1);
  assert.equal(a.winRate, 1, 'win rate is over PLAYED games only');
  assert.equal(a.diceTotal, 11, 'dice summed across ALL games (3+3+5)');
  assert.equal(a.diceCounts[7], 5, 'the spectated game\'s dice still count');
});

test('lifetime fairness: balanced dice read fair, all-7s read very skewed', () => {
  // Roughly fair: counts proportional to the two-dice distribution (×10).
  const fairDice = { 2: 10, 3: 20, 4: 30, 5: 40, 6: 50, 7: 60, 8: 50, 9: 40, 10: 30, 11: 20, 12: 10 };
  const fair = popup.aggregate([game({ winner: 'Me', dice: fairDice })]);
  assert.equal(fair.fairness, 'fair', 'a balanced lifetime distribution is fair');

  const skewed = popup.aggregate([game({ winner: 'Me', dice: { 7: 100 } })]);
  assert.equal(skewed.fairness, 'verySkewed', '100 sevens is wildly skewed');
});

test('fairness is null until there are enough rolls (CHI_MIN_ROLLS)', () => {
  const few = popup.aggregate([game({ winner: 'Me', dice: { 6: 5, 8: 5 } })]); // 10 < 24
  assert.equal(few.chi, null);
  assert.equal(few.fairness, null);
});

test('aggregate averages per-game block loss for the self player', () => {
  const history = [
    { selfName: 'Me', winner: 'Me', diceCounts: {}, tally: { Me: {} }, blockLoss: { Me: 4 } },
    { selfName: 'Me', winner: 'X',  diceCounts: {}, tally: { Me: {} }, blockLoss: { Me: 6 } },
  ];
  const agg = popup.aggregate(history);
  assert.equal(agg.avgBlockLoss, 5);
});

test('aggregate tolerates legacy records without blockLoss', () => {
  const agg = popup.aggregate([{ selfName: 'Me', diceCounts: {}, tally: { Me: {} } }]);
  assert.equal(agg.avgBlockLoss, 0);
});
