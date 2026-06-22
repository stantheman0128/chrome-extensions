'use strict';

// Expected-production pips: Σ over a player's BUILDINGS of weight × P(number) per
// adjacent tile, where P(n) = pipDots(n)/36 and weight is 1 (settlement) / 2 (city).
// Unlike the unweighted "coverage" pipsOf, this does NOT dedup a shared tile (each
// building produces independently) and DOES weight a city ×2. The robber tile is
// excluded, same as coverage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// corner 23 = (1,0,z1) really touches tiles at (1,0),(0,1),(1,1) under the fixed
// formula. Numbers chosen for clean pips: wool 6 (5), grain 8 (5), brick 2 (1).
function payload() {
  return {
    gameState: {
      playerColor: 1,
      mapState: {
        tileHexStates: {
          16: { x: 1, y: 0, type: 3, diceNumber: 6 },   // wool, 6 -> 5 pips
          15: { x: 0, y: 1, type: 4, diceNumber: 8 },    // grain, 8 -> 5 pips
          7:  { x: 1, y: 1, type: 2, diceNumber: 2 },    // brick, 2 -> 1 pip
        },
        tileCornerStates: { 23: { x: 1, y: 0, z: 1 } },
      },
      mechanicRobberState: { locationTileIndex: 7, isActive: true },  // robber on the brick tile
    },
    playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
  };
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('expectedPipsOf: a settlement = Σ P(n) over its non-robbed tiles, weight 1', () => {
  const b = B.createBoard();
  B.applyFullState(b, payload());
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } });
  const e = B.expectedPipsOf(b)[1];
  near(e.total, 10 / 36, 'wool 5/36 + grain 5/36 (brick robbed)');
  near(e.byRes[3], 5 / 36, 'wool');
  near(e.byRes[4], 5 / 36, 'grain');
  near(e.byRes[2], 0, 'brick robbed');
});

test('expectedPipsOf: a city doubles the expectation (weight 2)', () => {
  const b = B.createBoard();
  B.applyFullState(b, payload());
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 2 } } } }); // city
  const e = B.expectedPipsOf(b)[1];
  near(e.total, 20 / 36, 'city produces 2 per roll');
  near(e.byRes[3], 10 / 36, 'wool doubled');
});

test('expectedPipsOf: two of a player\'s buildings on the same tile BOTH produce (no dedup)', () => {
  const b = B.createBoard();
  const p = payload();
  p.gameState.mechanicRobberState.locationTileIndex = 99; // robber away — count everything
  // a second settlement on a corner that also touches tile 16 (wool); corner
  // (1,-1,z1) touches (1,-1),(0,0),(1,0) — (1,0) is tile 16.
  p.gameState.mapState.tileCornerStates['51'] = { x: 1, y: -1, z: 1 };
  B.applyFullState(b, p);
  B.applyDiff(b, { mapState: { tileCornerStates: {
    23: { owner: 1, buildingType: 1 },
    51: { owner: 1, buildingType: 1 },
  } } });
  // tile 16 (wool, 6 -> 5 pips) is touched by BOTH buildings -> 2 × 5/36 from wool alone
  const e = B.expectedPipsOf(b)[1];
  near(e.byRes[3], 10 / 36, 'shared wool tile counts for BOTH buildings (unlike coverage)');
});
