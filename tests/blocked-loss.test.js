'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst, makeMessage, feed, document } = require('./helpers/setup');
const { fixtures } = require('./fixtures/game-log');

test('clean roll teaches the yield map for the gainer', () => {
  cst.resetState();
  feed(fixtures.roll_2_2);             // Richia rolled sum 4
  feed(fixtures.got_bot_brick_grain);  // Richia got brick + grain
  const ty = cst.state.tally['Richia'] || {};
  assert.deepEqual(ty.produces && ty.produces[4], { brick: 1, grain: 1 });
});

test('starting resources are NOT learned as a numbered yield', () => {
  cst.resetState();
  feed(fixtures.starting_resources);   // "received starting resources" — no roll
  const ty = cst.state.tally['StanTheMan01'] || {};
  assert.equal(ty.produces == null || Object.keys(ty.produces).length === 0, true);
});

test('Year-of-Plenty take is NOT learned as a yield', () => {
  cst.resetState();
  feed(fixtures.roll_2_2);             // a real roll sets lastRoll = 4
  feed(fixtures.year_of_plenty_took);  // "took from bank" must be excluded
  const ty = cst.state.tally['StanTheMan01'] || {};
  assert.equal(ty.produces == null || ty.produces[4] == null, true);
});

test('block message records "N res" key (resource read from the tile image)', () => {
  cst.resetState();
  feed(fixtures.blocked_by_robber);    // prob_11 + generated_tile_wool
  assert.equal(cst.state.blocked.count, 1);
  assert.equal(cst.state.blocked.byKey['11 wool'], 1);
});

test('block loss ignores a blocked resource the player does not produce on that number', () => {
  cst.resetState();
  feed(fixtures.roll_2_2, fixtures.got_bot_brick_grain);                          // produces[Richia][4]={brick,grain}
  feed(fixtures.roll_2_2, fixtures.got_bot_brick_grain, fixtures.blocked_4_ore);  // 4-ore blocked; Richia makes no ore on 4
  feed(fixtures.roll_2_2);                                                        // settleRound
  assert.equal(cst.blockLossOf('Richia'), 0, 'Richia produces no ore on 4 → a 4-ore block costs nothing');
});

test('block loss backfills once the number warms up', () => {
  cst.resetState();
  // 4-brick blocked BEFORE Richia's 4-brick yield is known → 0 for now.
  feed(fixtures.roll_2_2, fixtures.blocked_4_brick);
  feed(fixtures.roll_2_2);                       // settleRound round 1: event stored, produces still unknown
  assert.equal(cst.blockLossOf('Richia'), 0, 'no yield learned yet → 0');
  // A later clean 4 teaches produces[Richia][4].brick=1 → the stored event backfills.
  feed(fixtures.got_bot_brick_grain);
  assert.equal(cst.blockLossOf('Richia'), 1, 'retroactively credited once 4-brick yield is known');
});

test('Stats view shows the block column and not the stolen column', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().resView = 'stats';
  cst.render();
  const wrap = document.querySelector('#cst-res-wrap');
  assert.ok(wrap, 'res wrap exists');
  assert.ok(wrap.querySelector('[data-res="s-block"]'), 'has s-block column');
  assert.equal(wrap.querySelector('[data-res="s-stole"]'), null, 'no s-stole column');
});

// ---- Differential method: block loss is scoped to the player actually blocked,
// not every owner of that number+resource (the old × global-count over-counted). ----

test('block loss only counts the player whose tile was blocked, not all same-number owners', () => {
  cst.resetState();
  // Clean round on 4: both Stan and Richia roll-yield 1 ore → produces[4].ore = 1 each.
  feed(fixtures.roll_2_2, fixtures.got_self_ore, fixtures.got_bot_ore);
  // Blocked round on 4: only Richia gets ore; Stan's 4-ore tile is under the robber.
  feed(fixtures.roll_2_2, fixtures.got_bot_ore, fixtures.blocked_4_ore);
  // Next roll closes the blocked round (settleRound).
  feed(fixtures.roll_2_2);
  assert.equal(cst.blockLossOf('StanTheMan01'), 1, 'blocked player loses their 1 ore');
  assert.equal(cst.blockLossOf('Richia'), 0, 'un-blocked same-number owner loses nothing');
});

test('block loss = expected minus actual when one of several same-number tiles is blocked', () => {
  cst.resetState();
  // Clean round: Stan's three 4-ore tiles all produce → produces[Stan][4].ore = 3.
  feed(fixtures.roll_2_2, fixtures.got_self_ore_x3);
  // Blocked round: one 4-ore tile is under the robber → Stan only gets 2 this time.
  feed(fixtures.roll_2_2, fixtures.got_self_ore_x2, fixtures.blocked_4_ore);
  feed(fixtures.roll_2_2);  // settleRound
  assert.equal(cst.blockLossOf('StanTheMan01'), 1, 'lost just the one blocked tile (3 − 2), not all 3');
});

test('an earlier clean round does not offset a later blocked round (roundGot is per-round)', () => {
  cst.resetState();
  feed(fixtures.roll_2_2, fixtures.got_self_ore);   // round A: Stan cleanly gets 1 ore on 4
  feed(fixtures.roll_2_2, fixtures.blocked_4_ore);  // round B: Stan's 4-ore is blocked (gets nothing)
  feed(fixtures.roll_2_2);                          // settleRound round B
  assert.equal(cst.blockLossOf('StanTheMan01'), 1, "round A's ore must not bleed into round B's got");
});

test('a rolled 7 produces no block events and does not crash', () => {
  cst.resetState();
  feed(fixtures.roll_2_5);   // sum 7 (robber) — no yield
  feed(fixtures.roll_2_2);   // next roll → settleRound
  assert.equal(cst.state.blockEvents.length, 0, 'no block events from a 7');
  assert.equal(cst.blockLossOf('StanTheMan01'), 0);
});

test('buildGameRecord settles the final round (no trailing roll needed)', () => {
  cst.resetState();
  feed(fixtures.roll_2_2, fixtures.got_self_ore_x2);                 // produces[Stan][4].ore = 2
  feed(fixtures.roll_2_2, fixtures.got_self_ore, fixtures.blocked_4_ore); // final round: 1 of 2 ore blocked, NO next roll
  const record = cst.buildGameRecord('StanTheMan01');
  assert.equal(record.blockLoss['StanTheMan01'], 1, 'winner line settles the last round (2 − 1)');
});

test('game record carries blockLoss, blockEvents and the legacy blocked counter', () => {
  cst.resetState();
  feed(fixtures.roll_2_2, fixtures.got_self_ore_x2);
  feed(fixtures.roll_2_2, fixtures.got_self_ore, fixtures.blocked_4_ore);
  const record = cst.buildGameRecord('StanTheMan01');
  assert.equal(typeof record.blockLoss['StanTheMan01'], 'number');
  assert.ok(Array.isArray(record.blockEvents), 'record carries blockEvents for audit');
  assert.ok(record.blocked && typeof record.blocked.byKey === 'object', 'legacy blocked counter kept');
});

test('block hover detail matches the differential loss, not the global counter', () => {
  cst.resetState();
  feed(fixtures.roll_2_2, fixtures.got_self_ore, fixtures.got_bot_ore);
  feed(fixtures.roll_2_2, fixtures.got_bot_ore, fixtures.blocked_4_ore);  // Stan blocked, Richia not
  feed(fixtures.roll_2_2);
  const hover = cst.blockReportHTML('StanTheMan01');
  assert.match(hover, /🎲4/, 'blocked player hover shows the roll-4 line');
  assert.match(hover, /<b>\d+<\/b>/, 'cards lost lead each line in bold');
  assert.doesNotMatch(hover, /×\d+\s*=/, 'no misleading "<roll> ×<times> = <cards>" equation');
  assert.equal(cst.blockReportHTML('Richia'), '', 'un-blocked same-number owner has no block detail');
});

test('a re-scrape replay after game end still settles the final blocked round', () => {
  cst.resetState();
  // A finished game whose final round had a block and no trailing roll.
  feed(fixtures.roll_2_2, fixtures.got_self_ore_x2);
  feed(fixtures.roll_2_2, fixtures.got_self_ore, fixtures.blocked_4_ore);
  cst.onGameWon('StanTheMan01');                 // live winner line → settles via buildGameRecord
  assert.equal(cst.blockLossOf('StanTheMan01'), 1, 'settled on the live winner line');

  // deepRescrape resets and replays the whole log while lifecycle stays ENDED, so the
  // replayed winner line hits onGameWon's idempotent guard. It must STILL settle the
  // final round (which has no trailing roll) rather than dropping it.
  cst.resetState();                              // lifecycle stays ENDED (resetState doesn't touch it)
  feed(fixtures.roll_2_2, fixtures.got_self_ore_x2);
  feed(fixtures.roll_2_2, fixtures.got_self_ore, fixtures.blocked_4_ore);
  cst.onGameWon('StanTheMan01');                 // ENDED guard — must still settle, not just return
  assert.equal(cst.blockLossOf('StanTheMan01'), 1, 'rescrape replay settles the final round');
});
