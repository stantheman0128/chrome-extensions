'use strict';

// New-game lifecycle for the WS board. A fresh game sends a type-4 full state with
// a NEW gameSettings.id (confirmed from a real capture: reset:true, reconnect:false,
// the full state arrives BEFORE any placement diff). The board must reset its
// per-game ACCRUALS on a new id, but NOT on a reconnect (same id) — and crucially
// `resetAccrual` must no longer wipe the GEOMETRY, because the full state already
// rebuilds it and the DOM-driven resetState fires ~1s AFTER the full state. Wiping
// it there orphaned every later placement (placement diffs carry only the corner
// index, no coordinates) into coordinate-less phantoms → pips/⛔ blank until F5.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

function fullState(id, opts = {}) {
  const corners = opts.built
    ? { 23: { x: 1, y: 0, z: 1, owner: 1, buildingType: 1 } }
    : { 23: { x: 1, y: 0, z: 1 } };
  const gameLogState = {};
  for (const [idx, roll] of (opts.rolls || [])) {
    const a = Math.min(6, Math.max(1, roll - 1));
    gameLogState[String(idx)] = { text: { type: 10, firstDice: a, secondDice: roll - a } };
  }
  return {
    gameSettings: { id },
    gameState: {
      playerColor: 1,
      mapState: { tileHexStates: { 7: { x: 1, y: 1, type: 2, diceNumber: 8 } }, tileCornerStates: corners },
      mechanicRobberState: { locationTileIndex: 99 },
      gameLogState,
    },
    playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
  };
}

test('a new gameSettings.id resets the board accruals; a reconnect (same id) does not double-count', () => {
  const b = B.createBoard();
  B.applyFullState(b, fullState('gameA', { rolls: [[1, 8]] }));
  assert.equal(B.diceOf(b).total, 1, 'game A roll accrued');
  B.applyFullState(b, fullState('gameA', { rolls: [[1, 8]] }));   // reconnect: same log replayed
  assert.equal(B.diceOf(b).total, 1, 'reconnect deduped — no double count');
  B.applyFullState(b, fullState('gameB'));                        // a genuinely new game
  assert.equal(B.diceOf(b).total, 0, 'new game id cleared the dice');
});

test('resetAccrual clears accruals but PRESERVES geometry (so a DOM reset cannot orphan placements)', () => {
  const b = B.createBoard();
  B.applyFullState(b, fullState('gameA', { built: true, rolls: [[1, 8]] }));
  assert.ok(B.tilesOfCornerIdx(b, 23).length > 0, 'corner 23 resolves to a tile after the full state');
  assert.equal(B.diceOf(b).total, 1, 'a roll accrued');
  B.resetAccrual(b);
  assert.equal(B.diceOf(b).total, 0, 'resetAccrual still clears the accruals (dice)');
  assert.ok(B.tilesOfCornerIdx(b, 23).length > 0, 'geometry SURVIVES resetAccrual — no phantom');
});

test('a placement diff after the full state keeps its coordinates (no phantom), even across a resetAccrual', () => {
  const b = B.createBoard();
  B.applyFullState(b, fullState('gameB'));                        // 54-corner topology, no buildings yet
  B.resetAccrual(b);                                             // the DOM new-game reset fires here
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } }); // index-only placement
  assert.ok(B.tilesOfCornerIdx(b, 23).length > 0, 'the placed corner still has coordinates from the full state');
  assert.ok((B.pipsOf(b)[1] || { total: 0 }).total > 0, 'pips compute live, no F5 needed');
});
