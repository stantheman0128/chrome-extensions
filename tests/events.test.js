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
  return p.unknown + RES.reduce((s, r) => s + p.resources[r], 0);
};
const reset = () => cst.resetState();
const seed = (name, color, bag) => {
  const p = cst.getPlayer(name, color);
  for (const [r, n] of Object.entries(bag)) cst.giveResource(p, r, n);
  return p;
};

// --- Bank trade (4:1) -------------------------------------------------------

test('bank trade: "gave bank [brick]x4 and took [wool]" debits 4 brick, credits 1 wool', () => {
  reset();
  seed('Docila', '#285FBD', { brick: 4 });
  feed(fixtures.bank_trade);
  assert.equal(res('Docila', 'brick'), 0);
  assert.equal(res('Docila', 'wool'), 1);
});

// --- Builds -----------------------------------------------------------------

test('build city: "built a City (+1 VP)" spends ore*3 + grain*2', () => {
  reset();
  seed('Docila', '#285FBD', { ore: 3, grain: 2 });
  feed(fixtures.built_city);
  assert.equal(res('Docila', 'ore'), 0);
  assert.equal(res('Docila', 'grain'), 0);
});

// --- Discards ---------------------------------------------------------------

test('discard: "discarded [ore][ore][grain][grain][ore]" removes those cards', () => {
  reset();
  seed('StanTheMan01', '#CF4449', { ore: 3, grain: 2 });
  feed(fixtures.discard_self);
  assert.equal(res('StanTheMan01', 'ore'), 0);
  assert.equal(res('StanTheMan01', 'grain'), 0);
});

test('discard announcement ("selecting cards to discard for X") changes nothing', () => {
  reset();
  feed(fixtures.discard_announce);
  // Aletha may be created as an empty player, but no cards move.
  assert.equal(total('Aletha'), 0);
});

// --- Dice (a 7 still counts) ------------------------------------------------

test('dice roll: "rolled [2] [5]" counts a 7', () => {
  reset();
  feed(fixtures.roll_2_5);
  assert.equal(cst.state.diceCounts[7], 1);
  assert.equal(cst.state.totalRolls, 1);
});

// --- Robber move: no resource effect, no tile false-positive ----------------

test('robber move does not change resources or miscount the tile icon', () => {
  reset();
  feed(fixtures.robber_move);
  assert.equal(total('StanTheMan01'), 0);
  assert.equal(res('StanTheMan01', 'lumber'), 0); // generated_tile_lumber must not leak
});

// --- Local human steal: revealed card is recorded as known ------------------

test('you-stole: with self known, the revealed card credits self and debits victim', () => {
  reset();
  feed(fixtures.got_self_grain); // establishes selfName = StanTheMan01
  seed('Zinn', '#CF6B2E', { wool: 1 });
  feed(fixtures.you_stole_wool);
  assert.equal(res('StanTheMan01', 'wool'), 1);
  assert.equal(res('Zinn', 'wool'), 0);
  assert.equal(cst.state.selfName, 'StanTheMan01');
});

// RED: a "You stole … from <Victim>" message must NOT be used to infer selfName.
// The only coloured name there is the victim, so the old heuristic (first
// coloured name + icon_player avatar) would wrongly set selfName to the victim.
test('you-stole: must not infer selfName from the victim when self is unknown', () => {
  reset();
  feed(fixtures.you_stole_wool); // first message ever; selfName still unknown
  assert.notEqual(cst.state.selfName, 'Zinn');
});
