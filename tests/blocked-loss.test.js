'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst, makeMessage, feed } = require('./helpers/setup');
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
