'use strict';

// v1.22.0 — three Stats additions, pure-logic level:
//   ① chiSquare()  — dice fairness statistic over sums 2–12 (dof 10).
//   ② recordTurn() — attributes the gap between consecutive rolls to the player
//      whose turn it was (capped so AFK/disconnect gaps don't skew the average).
//   ③ trade-flow   — executed trades accumulate per-opponent gave/got tallies.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, feed, document } = require('./helpers/setup');
const { fixtures: F } = require('./fixtures/game-log');
const KeyboardEvent = global.window.KeyboardEvent;

function seedDice(counts) {
  cst.resetState();
  for (const [n, c] of Object.entries(counts)) {
    cst.state.diceCounts[n] = c;
    cst.state.totalRolls += c;
  }
}

// ---- ① chi-square ----
test('chiSquare is null until enough rolls have accumulated', () => {
  seedDice({ 6: 3, 8: 2 }); // 5 rolls — far too few
  assert.equal(cst.chiSquare(), null);
});

test('a fair distribution scores near zero; a degenerate one scores high', () => {
  // Counts proportional to the fair distribution over 36 rolls.
  seedDice({ 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 });
  const fair = cst.chiSquare();
  assert.ok(fair !== null && fair < 1, `fair dice score should be tiny, got ${fair}`);

  seedDice({ 7: 36 }); // every roll a 7 — wildly skewed
  const skewed = cst.chiSquare();
  assert.ok(skewed > 50, `degenerate dice should score high, got ${skewed}`);
});

test('luckTier bands the chi-square by the standard critical values', () => {
  assert.equal(cst.luckTier(null), null, 'no value yet');
  assert.equal(cst.luckTier(8), 'fair');
  assert.equal(cst.luckTier(18.31), 'fair', 'at/below 18.31 is fair');
  assert.equal(cst.luckTier(20), 'skewed', 'p<0.05');
  assert.equal(cst.luckTier(25), 'verySkewed', 'p<0.01');
});

// ---- ② turn-time ----
test('recordTurn attributes the inter-roll gap to the previous roller', () => {
  cst.resetState();
  cst.recordTurn('P1', 1000);            // first roll — nothing to attribute yet
  cst.recordTurn('P2', 6000);            // P1's turn lasted 5s
  cst.recordTurn('P1', 9000);            // P2's turn lasted 3s
  assert.equal(cst.state.tally.P1.turnMs, 5000);
  assert.equal(cst.state.tally.P1.turns, 1);
  assert.equal(cst.state.tally.P2.turnMs, 3000);
  assert.equal(cst.state.tally.P2.turns, 1);
});

test('recordTurn ignores absurd gaps (AFK / disconnect) so the average stays real', () => {
  cst.resetState();
  cst.recordTurn('P1', 1000);
  cst.recordTurn('P2', 1000 + 10 * 60 * 1000); // 10 minutes — not a real turn
  assert.equal(cst.state.tally.P1, undefined, 'the 10-minute gap is not recorded');
});

// ---- ③ trade-flow ----
test('an executed trade accumulates per-opponent gave/got for both players', () => {
  // "Richia gave [grain] and got [lumber] from StanTheMan01"
  feed(F.trade_executed);
  const richia = cst.state.tally.Richia;
  const stan = cst.state.tally.StanTheMan01;
  assert.equal(richia.tradeGave.StanTheMan01, 1, 'Richia fed Stan 1 card');
  assert.equal(richia.tradeGot.StanTheMan01, 1, 'Richia got 1 card from Stan');
  assert.equal(stan.tradeGot.Richia, 1, 'mirror: Stan got 1 from Richia');
  assert.equal(stan.tradeGave.Richia, 1, 'mirror: Stan fed Richia 1');
});

// ---- ④ Monopoly tracked apart from knight steals + 7-roller footer ----
test('Monopoly is recorded apart from knight steals (monoTook / monoLost)', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  const thant = cst.getPlayer('Thant', '#285FBD');
  cst.giveResource(thant, 'brick', 4);
  feed(F.monopoly_result); // "StanTheMan01 stole 4 [brick]"
  assert.equal((cst.state.tally.StanTheMan01.monoTook || {}).brick, 4, 'taker monoTook brick ×4');
  assert.equal(((cst.state.tally.Thant.monoLost || {}).StanTheMan01 || {}).brick, 4, 'victim monoLost to Stan');
  assert.equal(cst.state.tally.StanTheMan01.stole || 0, 0, 'Monopoly stays OUT of the knight ⚔️ total');
  assert.equal(cst.state.tally.Thant.lost || 0, 0, 'Monopoly stays OUT of the knight 💔 total');
});

test('a rolled 7 is attributed to its roller', () => {
  cst.resetState();
  feed(F.roll_2_5); // StanTheMan01 rolled 2 + 5 = 7
  assert.equal(cst.state.diceCounts[7], 1);
  assert.equal(cst.state.sevenRollers.StanTheMan01, 1);
});

test('the lost report combines knight breakdown, a Monopoly line, and the 7s footer', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  const thant = cst.getPlayer('Thant', '#285FBD');
  cst.giveResource(thant, 'brick', 4);
  feed(F.roll_2_5);            // a 7, by StanTheMan01
  feed(F.monopoly_result);     // Stan Mono's 4 brick off Thant
  cst.recordSteal('StanTheMan01', 'Thant', 1); // a knight steal off Thant too
  const html = cst.stealReportHTML('Thant', 'lost');
  assert.match(html, /stolen by/i, 'knight "stolen by …" line');
  assert.match(html, /Mono/i, 'Monopoly line');
  assert.match(html, /7s rolled/i, '7s footer');
});

test('the 7s footer shows the count but no longer names who rolled them', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  feed(F.roll_2_5);            // StanTheMan01 rolled a 7 (no steals/Monopoly here)
  const html = cst.stealReportHTML('StanTheMan01', 'lost');
  assert.match(html, /7s rolled/i, 'count still shown');
  assert.doesNotMatch(html, /StanTheMan01/, 'roller name dropped from the footer');
});

// ---- render wiring: the two new Stats columns show up ----
test('the Stats view renders the ⏱ turn-time and 🤝 trade columns', async () => {
  cst.resetState();
  cst.getPlayer('P1', '#CF4449');
  cst.getPlayer('P2', '#285FBD');
  cst.recordTurn('P1', 0);
  cst.recordTurn('P2', 20000);         // P1's turn lasted 20s
  cst.state.tally.P1.tradeGave = { P2: 3 };
  cst.state.tally.P1.tradeGot = { P2: 1 };

  cst.createPanel();
  cst.render();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })); // → Stats view
  await new Promise((r) => setTimeout(r, 250)); // the directional slide re-renders

  const panel = document.querySelector('#colonist-stats-tracker');
  assert.ok(panel.querySelector('[data-res="s-turn"]'), 'turn-time column header present');
  assert.ok(panel.querySelector('[data-res="s-trade"]'), 'trade column header present');

  const row = panel.querySelector('[data-prow="P1"]');
  assert.match(row.querySelector('[data-res="s-turn"]').textContent, /20s/, 'P1 avg turn shows 20s');
  const tradeCell = row.querySelector('[data-res="s-trade"]');
  assert.equal(tradeCell.getAttribute('data-bd'), 'P1|trade', 'trade cell wires the hover');
  assert.match(tradeCell.textContent, /3/, 'trade cell shows 3 cards fed');
});
