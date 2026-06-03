'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, feed } = require('./helpers/setup');
const { fixtures } = require('./fixtures/game-log');

const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const player = (name) => cst.state.players.get(name);
const res = (name, r) => player(name).resources[r];
const total = (name) => {
  const p = player(name);
  return p ? p.unknown + RES.reduce((s, r) => s + p.resources[r], 0) : 0;
};
const reset = () => cst.resetState();
const seed = (name, color, bag) => {
  const p = cst.getPlayer(name, color);
  for (const [r, n] of Object.entries(bag)) cst.giveResource(p, r, n);
  return p;
};

// --- Buy development card ----------------------------------------------------

test('buy dev card: "bought [Development Card]" spends wool + grain + ore', () => {
  reset();
  seed('StanTheMan01', '#CF4449', { wool: 1, grain: 1, ore: 1 });
  feed(fixtures.buy_devcard);
  assert.equal(res('StanTheMan01', 'wool'), 0);
  assert.equal(res('StanTheMan01', 'grain'), 0);
  assert.equal(res('StanTheMan01', 'ore'), 0);
});

// --- Starting resources ------------------------------------------------------

test('starting resources: "received starting resources [lumber][wool]" adds them', () => {
  reset();
  feed(fixtures.starting_resources);
  assert.equal(res('StanTheMan01', 'lumber'), 1);
  assert.equal(res('StanTheMan01', 'wool'), 1);
});

// --- Free placement vs paid build -------------------------------------------

test('free placement: "placed a Settlement" costs nothing', () => {
  reset();
  feed(fixtures.placed_settlement);
  assert.equal(total('Thant'), 0); // created but unchanged
});

test('build settlement: "built a Settlement" spends lumber+brick+wool+grain', () => {
  reset();
  seed('Thant', '#285FBD', { lumber: 1, brick: 1, wool: 1, grain: 1 });
  feed(fixtures.built_settlement);
  for (const r of ['lumber', 'brick', 'wool', 'grain']) assert.equal(res('Thant', r), 0);
});

// --- Multi-card (2-for-1) trade ---------------------------------------------

test('trade 2-for-1: actor gives two cards, receives one; totals shift by net -1', () => {
  reset();
  seed('StanTheMan01', '#CF4449', { wool: 1, grain: 1 });
  seed('Thant', '#285FBD', { ore: 1 });
  feed(fixtures.trade_two_for_one);
  assert.equal(res('StanTheMan01', 'wool'), 0);
  assert.equal(res('StanTheMan01', 'grain'), 0);
  assert.equal(res('StanTheMan01', 'ore'), 1);
  assert.equal(res('Thant', 'ore'), 0);
  assert.equal(res('Thant', 'wool'), 1);
  assert.equal(res('Thant', 'grain'), 1);
});

// --- Info lines that must be ignored ----------------------------------------

test('"No player to steal from" is ignored (steal != stole)', () => {
  reset();
  feed(fixtures.no_player_to_steal);
  assert.equal(cst.state.players.size, 0);
});

test('"blocked by the Robber" info line changes nothing and ignores the tile icon', () => {
  reset();
  feed(fixtures.blocked_by_robber);
  assert.equal(cst.state.players.size, 0);
});

test('Monopoly announcement ("used Monopoly") has no resource effect', () => {
  reset();
  feed(fixtures.monopoly_used);
  assert.equal(total('StanTheMan01'), 0);
});

// --- Monopoly result: the amount is in the TEXT, not the icon count ----------
// RED: old code credits the single displayed icon (1) instead of the number 4.

test('Monopoly result: "stole 4 [brick]" credits 4 to actor and zeroes opponents', () => {
  reset();
  seed('StanTheMan01', '#CF4449', {});
  seed('Thant', '#285FBD', { brick: 4 }); // the 4 brick come from opponents
  feed(fixtures.monopoly_result);
  assert.equal(res('StanTheMan01', 'brick'), 4); // not 1
  assert.equal(res('Thant', 'brick'), 0);
});
