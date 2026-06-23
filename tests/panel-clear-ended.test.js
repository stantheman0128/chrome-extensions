'use strict';

// A manual reload (🔄) at the lobby / main screen, with a finished game still on the
// panel, wipes it back to idle instead of leaving the stale data (raised by Stan).
// The reload button routes to clearEndedGame() when the lifecycle is LOBBY; here we
// test that clear directly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

test('clearEndedGame wipes players, the Victory override, and returns to lobby', () => {
  cst.resetState();
  cst.getPlayer('Alice', '#c00');
  cst.getPlayer('Bob', '#00c');
  cst.state.endgameBlocked = { Alice: 3 };
  cst.state.endgameBlockedGid = 'g1';

  cst.clearEndedGame();

  assert.equal(cst.state.players.size, 0, 'the roster is cleared');
  assert.equal(cst.state.endgameBlocked, null, 'the Victory override is cleared');
  assert.equal(cst.state.endgameBlockedGid, null);
  assert.equal(cst.getLifecycle(), 'lobby', 'back to an idle lobby, ready for the next game');
});
