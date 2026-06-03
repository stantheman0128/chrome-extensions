'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

const reset = () => cst.resetState();
const seed = (name, color, bag) => {
  const p = cst.getPlayer(name, color);
  for (const [r, n] of Object.entries(bag)) cst.giveResource(p, r, n);
  return p;
};

test('bank remaining = 19 minus the sum of all players known holdings', () => {
  reset();
  seed('A', '#111', { brick: 4, wool: 2 });
  seed('B', '#222', { brick: 3 });
  const bank = cst.bankRemaining();
  assert.equal(bank.brick, 19 - 7); // 12
  assert.equal(bank.wool, 19 - 2); // 17
  assert.equal(bank.lumber, 19); // untouched
});

test('bank remaining never goes negative (clamped at 0)', () => {
  reset();
  seed('A', '#111', { ore: 25 }); // not reachable in a real game, but must clamp
  assert.equal(cst.bankRemaining().ore, 0);
});

test('bank remaining ignores unknown cards (reports an upper bound)', () => {
  reset();
  const p = seed('A', '#111', { grain: 2 });
  p.unknown = 3; // 3 stolen cards of unknown type
  // We cannot attribute the unknowns to a resource, so grain stays 19 - 2.
  assert.equal(cst.bankRemaining().grain, 17);
});
