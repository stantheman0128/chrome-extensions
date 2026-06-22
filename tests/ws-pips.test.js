'use strict';

// Setup pip strength from the WS board geometry: for each player, sum the pips of
// every numbered tile their buildings touch. City weight is ×1 (Stan's choice),
// and the robber-blocked tile is deducted. Uses the real captured opening board.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

function openingPayload() {
  return {
    gameState: {
      playerColor: 1,
      mapState: {
        tileHexStates: {
          7:  { x: 1, y: 1, type: 2, diceNumber: 2 },    // brick, 2 → 1 pip
          15: { x: 0, y: 1, type: 4, diceNumber: 9 },    // grain, 9 → 4 pips
          16: { x: 1, y: 0, type: 3, diceNumber: 10 },   // wool,  10 → 3 pips
          18: { x: 0, y: 0, type: 4, diceNumber: 11 },
          12: { x: 0, y: -1, type: 5, diceNumber: 6 },
          17: { x: 1, y: -1, type: 5, diceNumber: 3 },
        },
        tileCornerStates: { 23: { x: 0, y: 1, z: 1 } },  // touches tiles 15, 7, 16
      },
      mechanicRobberState: { locationTileIndex: 7, isActive: true },   // robber on tile 7
    },
    playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
  };
}

test('pipsOf sums a settlement\'s tile pips and deducts the robber-blocked tile', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());                                  // robber on tile 7
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } });
  const p = B.pipsOf(b)[1];
  assert.equal(p.total, 7, 'grain 9 (4) + wool 10 (3); brick 2 robbed → 0');
  assert.equal(p.byRes[4], 4, 'grain pips');
  assert.equal(p.byRes[3], 3, 'wool pips');
  assert.equal(p.byRes[2], 0, 'brick robbed → 0');
});

test('a city counts the same as a settlement (×1) and the robber moving off restores the tile', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  B.applyDiff(b, { mechanicRobberState: { locationTileIndex: 99 } });     // robber off these tiles
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 2 } } } }); // CITY
  const p = B.pipsOf(b)[1];
  assert.equal(p.total, 8, 'grain 4 + brick 1 + wool 3; city is NOT doubled');
  assert.equal(p.byRes[2], 1, 'brick now counts (robber gone)');
});

test('a tile touched by two of a player\'s buildings counts its pips once, not twice', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());   // robber on tile 7
  // Player 1 builds on corner 23 (touches tiles 15,7,16) AND corner 51 (touches
  // 18,16,17). Tile 16 (wool 10) is shared — Stan: count the tile once.
  B.applyDiff(b, { mapState: { tileCornerStates: {
    23: { owner: 1, buildingType: 1 },
    51: { x: 0, y: 0, z: 1, owner: 1, buildingType: 1 },
  } } });
  const p = B.pipsOf(b)[1];
  // distinct tiles {15,7,16,18,17}; tile 7 robbed → excluded.
  assert.equal(p.byRes[3], 3, 'shared wool tile counted ONCE, not 6');
  assert.equal(p.byRes[4], 6, 'two DIFFERENT grain tiles both count (15=4 + 18=2)');
  assert.equal(p.byRes[5], 2, 'ore tile 17');
  assert.equal(p.total, 11, '4 + 2 + 3 + 2 (tile 7 robbed, wool not doubled)');
});

test('an empty/unowned corner contributes nothing', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());           // corner 23 exists but has no owner yet
  assert.deepEqual(B.pipsOf(b), {}, 'no buildings → no pips for anyone');
});
