'use strict';

// Game state survives a page reload via localStorage. This file gets its own
// process (node --test runs each file separately), so the in-memory localStorage
// stub here doesn't leak into the other suites.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst } = require('./helpers/setup');

test('persistState + restoreState round-trip the live game', () => {
  cst.resetState();
  const p = cst.getPlayer('Aria', '#285FBD');
  cst.giveResource(p, 'grain', 3);
  p.unknown = 2;
  cst.state.totalRolls = 7;
  cst.state.diceCounts[8] = 4;
  cst.state.selfName = 'Aria';
  cst.state.seenIndices.add('42');
  cst.persistState();

  // Simulate a page reload: wipe in-memory state, then restore from storage.
  cst.resetState();
  assert.equal(cst.state.totalRolls, 0);
  assert.equal(cst.state.players.size, 0);

  cst.restoreState();
  assert.equal(cst.state.totalRolls, 7);
  assert.equal(cst.state.diceCounts[8], 4);
  assert.equal(cst.state.selfName, 'Aria');
  assert.ok(cst.state.seenIndices.has('42'));
  const a = cst.state.players.get('Aria');
  assert.equal(a.resources.grain, 3);
  assert.equal(a.unknown, 2);
});
