'use strict';

// Locks the remaining development-card / award event types against real DOM
// fixtures. These pass without any code change — the parser already handled
// them — but the tests guard against silent regressions.

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

// --- Year of Plenty: "took from bank [A][B]" is a free +2 ---------------------

test('Year of Plenty: "took from bank [grain][grain]" adds 2 grain', () => {
  reset();
  feed(fixtures.year_of_plenty_took);
  assert.equal(res('StanTheMan01', 'grain'), 2);
});

test('Year of Plenty announcement ("used Year of Plenty") has no resource effect', () => {
  reset();
  feed(fixtures.year_of_plenty_used);
  assert.equal(total('StanTheMan01'), 0);
});

// --- Road Building: announcement ignored; granted roads are free -------------

test('Road Building announcement ("used Road Building") changes nothing', () => {
  reset();
  feed(fixtures.road_building_used);
  assert.equal(total('StanTheMan01'), 0);
});

test('free "placed a Road" is not charged like "built a Road"', () => {
  reset();
  seed('StanTheMan01', '#CF4449', { lumber: 1, brick: 1 });
  feed(fixtures.placed_road);
  assert.equal(res('StanTheMan01', 'lumber'), 1); // unchanged — placement is free
  assert.equal(res('StanTheMan01', 'brick'), 1);
});

// --- Largest Army award: VP only, no resources ------------------------------

test('"received Largest Army" awards no resources', () => {
  reset();
  feed(fixtures.received_largest_army);
  assert.equal(total('Frazer'), 0);
});
