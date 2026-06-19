'use strict';

// board.js builds colonist's game model from the WebSocket. These tests use REAL
// coordinates from a captured opening board (id=130 type=4) so the corner↔tile
// geometry is pinned to ground truth.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// A trimmed-but-real opening payload: a few tiles around (0,0)/(1,1) plus corner
// 23 (where a settlement was really built) and the centre-hex corners.
function openingPayload() {
  return {
    gameState: {
      playerColor: 1,
      mapState: {
        tileHexStates: {
          7:  { x: 1, y: 1, type: 2, diceNumber: 2 },
          15: { x: 0, y: 1, type: 4, diceNumber: 9 },
          16: { x: 1, y: 0, type: 3, diceNumber: 10 },
          18: { x: 0, y: 0, type: 4, diceNumber: 11 },
          12: { x: 0, y: -1, type: 5, diceNumber: 6 },
          17: { x: 1, y: -1, type: 5, diceNumber: 3 },
        },
        tileCornerStates: {
          23: { x: 0, y: 1, z: 1 },
          48: { x: 0, y: 0, z: 0 },
          51: { x: 0, y: 0, z: 1 },
        },
      },
      mechanicRobberState: { locationTileIndex: 7, isActive: true },
    },
    playerUserStates: [
      { selectedColor: 1, username: 'StanTheMan01' },
      { selectedColor: 2, username: 'Sancho' },
    ],
  };
}

test('tilesOfCorner uses the verified z=0 / z=1 offsets', () => {
  assert.deepEqual(B.tilesOfCorner({ x: 0, y: 1, z: 1 }), [[0, 1], [1, 1], [1, 0]]);
  assert.deepEqual(B.tilesOfCorner({ x: 0, y: 0, z: 0 }), [[0, 0], [0, -1], [1, -1]]);
});

test('applyFullState indexes tiles, corners, robber and self color', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  assert.equal(B.ready(b), true);
  assert.equal(B.robberTile(b), 7);
  assert.equal(b.selfColor, 1);
  assert.equal(b.tiles['7'].number, 2);
  assert.equal(b.colorToName[1], 'StanTheMan01');
});

test('tilesOfCornerIdx maps corner 23 to its three real adjacent tiles', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  // (0,1)=15, (1,1)=7, (1,0)=16
  assert.deepEqual(B.tilesOfCornerIdx(b, 23).sort(), ['15', '16', '7']);
});

test('cornersByTile is the inverse: tile 7 lists corner 23', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  assert.ok((b.cornersByTile['7'] || []).includes('23'));
});

test('applyDiff records a building placement (owner + buildingType) on an existing corner', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } });
  assert.equal(b.corners['23'].owner, 1);
  assert.equal(b.corners['23'].buildingType, 1);
});

test('applyDiff moves the robber', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  B.applyDiff(b, { mechanicRobberState: { locationTileIndex: 15 } });
  assert.equal(B.robberTile(b), 15);
});

test('a roll on the robber-blocked tile accrues blocked-loss; other rolls and 7s do not', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload()); // robber on tile 7 (number 2)
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } }); // Stan settles corner 23 (adj. tile 7)
  // roll a 2 → tile 7 is blocked → Stan loses 1 (settlement)
  B.applyDiff(b, { gameLogState: { 50: { text: { type: 10, firstDice: 1, secondDice: 1 }, from: 1 } } });
  assert.equal(B.blockedLossOf(b, 1), 1);
  // roll a 10 (different number) → no change
  B.applyDiff(b, { gameLogState: { 51: { text: { type: 10, firstDice: 5, secondDice: 5 }, from: 1 } } });
  assert.equal(B.blockedLossOf(b, 1), 1);
  // a 7 → no production → no change
  B.applyDiff(b, { gameLogState: { 52: { text: { type: 10, firstDice: 3, secondDice: 4 }, from: 1 } } });
  assert.equal(B.blockedLossOf(b, 1), 1);
});

test('a city on the blocked tile loses 2; the same log entry is never counted twice', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 2 } } } }); // city
  const roll = { gameLogState: { 60: { text: { type: 10, firstDice: 1, secondDice: 1 }, from: 1 } } };
  B.applyDiff(b, roll);
  B.applyDiff(b, roll);           // replayed (e.g. re-scrape) — must not double count
  assert.equal(B.blockedLossOf(b, 1), 2);
});

test('a same-number tile WITHOUT the robber is not blocked', () => {
  const b = B.createBoard();
  const p = openingPayload();
  // add a second number-2 tile (index 99) at (5,5) with Stan on an adjacent corner
  p.gameState.mapState.tileHexStates['99'] = { x: 5, y: 5, type: 2, diceNumber: 2 };
  p.gameState.mapState.tileCornerStates['80'] = { x: 5, y: 5, z: 0 }; // touches (5,5)
  B.applyFullState(b, p);         // robber still on tile 7
  B.applyDiff(b, { mapState: { tileCornerStates: { 80: { owner: 1, buildingType: 1 } } } });
  B.applyDiff(b, { gameLogState: { 70: { text: { type: 10, firstDice: 1, secondDice: 1 }, from: 1 } } }); // roll 2
  assert.equal(B.blockedLossOf(b, 1), 0); // tile 99 has number 2 but no robber → not blocked
});
