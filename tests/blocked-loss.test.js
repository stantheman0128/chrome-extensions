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

test('block loss = Σ blocked-count × my yield for that number+resource', () => {
  cst.resetState();
  feed(fixtures.roll_2_2);              // Richia rolled 4
  feed(fixtures.got_bot_brick_grain);   // produces[Richia][4] = {brick:1, grain:1}
  cst.state.blocked.byKey['4 brick'] = 3;   // 3 blocks of 4-brick cost Richia 1 each
  assert.equal(cst.blockLossOf('Richia'), 3);
  cst.state.blocked.byKey['4 ore'] = 5;     // Richia gets no ore on 4 → costs nothing
  assert.equal(cst.blockLossOf('Richia'), 3);
});

test('block loss backfills once the number warms up', () => {
  cst.resetState();
  cst.state.blocked.byKey['4 brick'] = 2;   // blocked BEFORE we know the yield
  assert.equal(cst.blockLossOf('Richia'), 0);
  feed(fixtures.roll_2_2);
  feed(fixtures.got_bot_brick_grain);       // now produces[Richia][4].brick = 1
  assert.equal(cst.blockLossOf('Richia'), 2); // retroactively credited
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
