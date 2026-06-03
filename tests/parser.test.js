'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, feed } = require('./helpers/setup');
const { fixtures } = require('./fixtures/game-log');

const player = (name) => cst.state.players.get(name);
const res = (name, r) => player(name).resources[r];

function reset() {
  cst.resetState();
}

// --- Regression: behaviour that already works and must keep working ---------

test('dice roll: "rolled [2] [2]" counts a 4', () => {
  reset();
  feed(fixtures.roll_2_2);
  assert.equal(cst.state.diceCounts[4], 1);
  assert.equal(cst.state.totalRolls, 1);
});

test('gain: "StanTheMan01 got [grain]" adds 1 grain and detects self', () => {
  reset();
  feed(fixtures.got_self_grain);
  assert.equal(res('StanTheMan01', 'grain'), 1);
  assert.equal(cst.state.selfName, 'StanTheMan01');
});

test('gain: "Richia got [brick] [grain]" adds one of each', () => {
  reset();
  feed(fixtures.got_bot_brick_grain);
  assert.equal(res('Richia', 'brick'), 1);
  assert.equal(res('Richia', 'grain'), 1);
});

test('steal: hidden card moves to thief as an unknown card', () => {
  reset();
  // Masera holds 1 grain before being robbed.
  cst.giveResource(cst.getPlayer('Masera', '#285FBD'), 'grain', 1);
  feed(fixtures.steal_hidden);
  assert.equal(player('Tearle').unknown, 1);
  // Victim is down a card; its type is now unknown to us.
  const masera = player('Masera');
  const maseraTotal =
    masera.unknown +
    ['lumber', 'brick', 'wool', 'grain', 'ore'].reduce((s, r) => s + masera.resources[r], 0);
  assert.equal(maseraTotal, 0);
});

test('trade proposal: "wants to give … for …" is ignored', () => {
  reset();
  feed(fixtures.trade_proposal);
  assert.equal(cst.state.players.size, 0);
});

test('build: "built a Road" spends lumber + brick', () => {
  reset();
  const richia = cst.getPlayer('Richia', '#228103');
  cst.giveResource(richia, 'lumber', 1);
  cst.giveResource(richia, 'brick', 1);
  feed(fixtures.built_road);
  assert.equal(res('Richia', 'lumber'), 0);
  assert.equal(res('Richia', 'brick'), 0);
});

// --- The bug: executed player-to-player trade -------------------------------

test('trade executed: actor loses what it gave and gains what it got', () => {
  reset();
  // Pre-state: Richia has the grain it will give; Stan has the lumber he will give.
  cst.giveResource(cst.getPlayer('Richia', '#228103'), 'grain', 1);
  cst.giveResource(cst.getPlayer('StanTheMan01', '#CF4449'), 'lumber', 1);

  feed(fixtures.trade_executed); // "Richia gave [grain] and got [lumber] from StanTheMan01"

  // Actor Richia: -grain, +lumber.
  assert.equal(res('Richia', 'grain'), 0);
  assert.equal(res('Richia', 'lumber'), 1);
  // Counterparty Stan: +grain, -lumber.
  assert.equal(res('StanTheMan01', 'grain'), 1);
  assert.equal(res('StanTheMan01', 'lumber'), 0);

  // A 1-for-1 trade conserves each player's total card count.
  const total = (p) =>
    p.unknown + ['lumber', 'brick', 'wool', 'grain', 'ore'].reduce((s, r) => s + p.resources[r], 0);
  assert.equal(total(player('Richia')), 1);
  assert.equal(total(player('StanTheMan01')), 1);
});
