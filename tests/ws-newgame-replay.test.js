'use strict';

// Regression contract derived from the real new-game capture:
//   C:\Users\stans\Downloads\cst-ws-frames (2).json
// id=130 frame 62: type 1, gameSettingId=tile2830, reset=true, reconnect=false
// id=130 frame 65: type 4, gameSettings.id=tile2830, 19 tiles, 54 positioned
// corners, zero buildings
// id=130 frame 89: first placement diff, corner 26={owner:1,buildingType:1}
// with no x/y/z. The map constants below are copied from frame 65; no expected
// board behaviour is imported from production code.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

const CAPTURED_TILES = {
  0: { x: 0, y: -2, type: 2, diceNumber: 8 },
  1: { x: -1, y: -1, type: 4, diceNumber: 10 },
  2: { x: -2, y: 0, type: 3, diceNumber: 5 },
  3: { x: -2, y: 1, type: 4, diceNumber: 2 },
  4: { x: -2, y: 2, type: 3, diceNumber: 6 },
  5: { x: -1, y: 2, type: 2, diceNumber: 3 },
  6: { x: 0, y: 2, type: 1, diceNumber: 8 },
  7: { x: 1, y: 1, type: 1, diceNumber: 10 },
  8: { x: 2, y: 0, type: 5, diceNumber: 9 },
  9: { x: 2, y: -1, type: 4, diceNumber: 12 },
  10: { x: 2, y: -2, type: 3, diceNumber: 11 },
  11: { x: 1, y: -2, type: 4, diceNumber: 4 },
  12: { x: 0, y: -1, type: 3, diceNumber: 3 },
  13: { x: -1, y: 0, type: 5, diceNumber: 9 },
  14: { x: -1, y: 1, type: 1, diceNumber: 4 },
  15: { x: 0, y: 1, type: 2, diceNumber: 5 },
  16: { x: 1, y: 0, type: 0, diceNumber: 0 },
  17: { x: 1, y: -1, type: 5, diceNumber: 6 },
  18: { x: 0, y: 0, type: 1, diceNumber: 11 },
};

const CAPTURED_CORNERS = {
  0: { x: 0, y: -2, z: 0 }, 1: { x: 1, y: -3, z: 1 },
  2: { x: 0, y: -1, z: 0 }, 3: { x: 0, y: -2, z: 1 },
  4: { x: -1, y: -1, z: 0 }, 5: { x: 0, y: -3, z: 1 },
  6: { x: -1, y: 0, z: 0 }, 7: { x: -1, y: -1, z: 1 },
  8: { x: -2, y: 0, z: 0 }, 9: { x: -1, y: -2, z: 1 },
  10: { x: -2, y: 1, z: 0 }, 11: { x: -2, y: 0, z: 1 },
  12: { x: -3, y: 1, z: 0 }, 13: { x: -2, y: -1, z: 1 },
  14: { x: -1, y: 0, z: 1 }, 15: { x: -2, y: 2, z: 0 },
  16: { x: -2, y: 1, z: 1 }, 17: { x: -3, y: 2, z: 0 },
  18: { x: -1, y: 1, z: 1 }, 19: { x: -2, y: 3, z: 0 },
  20: { x: -2, y: 2, z: 1 }, 21: { x: -3, y: 3, z: 0 },
  22: { x: -1, y: 2, z: 0 }, 23: { x: 0, y: 1, z: 1 },
  24: { x: -1, y: 3, z: 0 }, 25: { x: -1, y: 2, z: 1 },
  26: { x: 0, y: 2, z: 0 }, 27: { x: 1, y: 1, z: 1 },
  28: { x: 0, y: 3, z: 0 }, 29: { x: 0, y: 2, z: 1 },
  30: { x: 1, y: 1, z: 0 }, 31: { x: 2, y: 0, z: 1 },
  32: { x: 1, y: 2, z: 0 }, 33: { x: 1, y: 0, z: 1 },
  34: { x: 2, y: 0, z: 0 }, 35: { x: 3, y: -1, z: 1 },
  36: { x: 2, y: 1, z: 0 }, 37: { x: 2, y: -1, z: 1 },
  38: { x: 2, y: -1, z: 0 }, 39: { x: 3, y: -2, z: 1 },
  40: { x: 1, y: 0, z: 0 }, 41: { x: 2, y: -2, z: 1 },
  42: { x: 2, y: -2, z: 0 }, 43: { x: 3, y: -3, z: 1 },
  44: { x: 1, y: -1, z: 0 }, 45: { x: 2, y: -3, z: 1 },
  46: { x: 1, y: -2, z: 0 }, 47: { x: 1, y: -2, z: 1 },
  48: { x: 0, y: 0, z: 0 }, 49: { x: 0, y: -1, z: 1 },
  50: { x: -1, y: 1, z: 0 }, 51: { x: 0, y: 0, z: 1 },
  52: { x: 0, y: 1, z: 0 }, 53: { x: 1, y: -1, z: 1 },
};

const INITIAL_LOG = {
  0: { text: { type: 2, isDiscord: false } },
  1: { text: { type: 44 } },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fullState(gameId, gameLogState = INITIAL_LOG) {
  return {
    gameSettings: { id: gameId },
    gameState: {
      mapState: {
        tileHexStates: clone(CAPTURED_TILES),
        tileCornerStates: clone(CAPTURED_CORNERS),
      },
      mechanicRobberState: { locationTileIndex: 16, isActive: true },
      gameLogState: clone(gameLogState),
    },
    playerUserStates: [
      { selectedColor: 1, username: 'StanTheMan01' },
      { selectedColor: 2, username: 'Eal' },
    ],
  };
}

function builtCount(board) {
  return Object.values(board.corners)
    .filter((corner) => corner.owner != null && corner.buildingType).length;
}

test('a new gameSettings.id replaces geometry and resets every prior-game accumulator', () => {
  const board = B.createBoard();
  B.applyFullState(board, fullState('A'));

  // Real placement shape from frame 89: index + occupancy only, no coordinates.
  // Put the robber on adjacent tile 6 and feed a roll/gain so all accumulator
  // families have observable game-A data to clear.
  B.applyDiff(board, {
    mapState: { tileCornerStates: { 26: { owner: 1, buildingType: 1 } } },
    mechanicRobberState: { locationTileIndex: 6 },
    gameLogState: {
      10: { text: { type: 10, playerColor: 1, firstDice: 4, secondDice: 4 } },
      11: { text: { type: 47, playerColor: 1, cardsToBroadcast: [5, 5], distributionType: 1 } },
    },
  });
  assert.equal(B.diceOf(board).total, 1, 'game A setup must actually populate dice');
  assert.equal(B.statsOf(board, 1).gained, 2, 'game A setup must actually populate stats');
  assert.equal(B.blockedLossOf(board, 1), 1, 'game A setup must actually populate blocked loss');
  assert.equal(builtCount(board), 1, 'game A setup must actually contain a building');

  B.applyFullState(board, fullState('B'));

  assert.deepEqual({
    seenLog: board.seenLog,
    diceTotal: B.diceOf(board).total,
    stats: B.statsOf(board, 1),
    recon: B.reconBreakdownOf(board, 1),
    blocked: B.blockedLossOf(board, 1),
    cornerCount: Object.keys(board.corners).length,
    built: builtCount(board),
    corner26: board.corners[26],
  }, {
    seenLog: 1, // B's captured initial log 0..1, not A's index 11
    diceTotal: 0,
    stats: null,
    recon: null,
    blocked: 0,
    cornerCount: 54,
    built: 0,
    corner26: { x: 0, y: 2, z: 0, owner: undefined, buildingType: undefined },
  });
});

test('reapplying a full state with the same gameSettings.id does not double-count history', () => {
  const board = B.createBoard();
  const reconnectSnapshot = fullState('A', {
    ...INITIAL_LOG,
    2: { text: { type: 10, playerColor: 1, firstDice: 3, secondDice: 5 } },
    3: { text: { type: 47, playerColor: 1, cardsToBroadcast: [1, 1], distributionType: 1 } },
  });

  B.applyFullState(board, reconnectSnapshot);
  B.applyFullState(board, reconnectSnapshot);

  assert.equal(board.seenLog, 3);
  assert.equal(B.diceOf(board).total, 1, 'the replayed roll is counted once');
  assert.equal(B.statsOf(board, 1).gained, 2, 'the replayed production is counted once');
  assert.deepEqual(B.reconBreakdownOf(board, 1), {
    1: 2, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0,
  }, 'the replayed hand reconstruction is counted once');
});

test('a coordinate-free placement diff reuses the 54-corner full-state geometry', () => {
  const board = B.createBoard();
  B.applyFullState(board, fullState('tile2830'));

  assert.equal(Object.keys(board.corners).length, 54);
  assert.equal(builtCount(board), 0);
  assert.deepEqual(board.corners[26], {
    x: 0, y: 2, z: 0, owner: undefined, buildingType: undefined,
  });

  B.applyDiff(board, {
    mapState: { tileCornerStates: { 26: { owner: 1, buildingType: 1 } } },
  });

  assert.deepEqual(board.corners[26], {
    x: 0, y: 2, z: 0, owner: 1, buildingType: 1,
  }, 'the partial diff must preserve x/y/z from the full snapshot');
  assert.ok(B.tilesOfCornerIdx(board, 26).length > 0, 'the placed building is not a phantom');
});
