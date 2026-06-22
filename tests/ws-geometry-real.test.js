'use strict';

// Real-capture geometry validation — the generation-free oracle.
//
// The fixture is a genuine colonist full state (2-player game, captured from the
// live WebSocket). colonist itself broadcasts, after every roll, exactly which
// player produced which resources (gameLog type 47, distributionType 1). For every
// roll AFTER the last settlement was placed, the final geometry is authoritative,
// so our geometry's predicted production must equal colonist's broadcast — with
// zero mismatches. The expected values ARE colonist's own data, so this test can't
// be satisfied by a convenient hand-authored fixture: it pins the corner->tile
// adjacency (B.tilesOfCorner) against reality.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');
const payload = require('./fixtures/ws-fullstate-2p.json');

const log = payload.gameState.gameLogState;
const idxs = Object.keys(log).map(Number).sort((a, b) => a - b);

// last settlement placement: pieceEnum 2 = settlement (roads are 0). Opening uses
// log type 4, in-play builds use type 5. After it, all buildings exist.
let lastBuild = -1;
for (const i of idxs) {
  const tx = log[i] && log[i].text;
  if (tx && (tx.type === 4 || tx.type === 5) && tx.pieceEnum === 2) lastBuild = i;
}

// map a type-11 robber move (carries tileInfo, not an index) to a tile index
function robberIndexFor(b, tileInfo) {
  if (!tileInfo) return null;
  for (const ti of Object.keys(b.tiles)) {
    if (b.tiles[ti].type === tileInfo.tileType && b.tiles[ti].number === (tileInfo.diceNumber || 0)) return ti;
  }
  return null;
}

// predict { owner: { resType: count } } for a roll, using the geometry under test
function predict(b, roll, robberTile) {
  const out = {};
  for (const ci of Object.keys(b.corners)) {
    const c = b.corners[ci];
    if (c.owner == null || !c.buildingType) continue;
    for (const ti of B.tilesOfCornerIdx(b, ci)) {
      if (String(ti) === String(robberTile)) continue;
      const t = b.tiles[ti];
      if (!t || t.type < 1 || t.type > 5 || t.number !== roll) continue;
      (out[c.owner] = out[c.owner] || {});
      out[c.owner][t.type] = (out[c.owner][t.type] || 0) + (c.buildingType === 2 ? 2 : 1);
    }
  }
  return out;
}

test('geometry predicts colonist\'s real production broadcasts (post-final-geometry rolls)', () => {
  const b = B.createBoard();
  B.applyFullState(b, payload);

  let robber = null, roll = null, actual = {}, checks = 0;
  const mismatches = [];
  const flush = () => {
    if (roll == null) return;
    const pred = predict(b, roll, robber);
    const owners = new Set([...Object.keys(pred), ...Object.keys(actual)]);
    for (const o of owners) {
      const p = pred[o] || {}, a = actual[o] || {};
      const res = new Set([...Object.keys(p), ...Object.keys(a)]);
      for (const r of res) {
        checks += 1;
        if ((p[r] || 0) !== (a[r] || 0)) {
          mismatches.push(`roll ${roll} owner ${o} res ${r}: pred ${p[r] || 0} vs actual ${a[r] || 0}`);
        }
      }
    }
    roll = null; actual = {};
  };
  for (const i of idxs) {
    const tx = log[i] && log[i].text;
    if (!tx) continue;
    if (tx.type === 11) robber = robberIndexFor(b, tx.tileInfo);
    else if (tx.type === 10) { if (i > lastBuild) flush(); roll = (tx.firstDice || 0) + (tx.secondDice || 0); actual = {}; }
    else if (tx.type === 47 && tx.distributionType === 1 && i > lastBuild && roll != null) {
      const o = tx.playerColor;
      actual[o] = actual[o] || {};
      for (const card of (tx.cardsToBroadcast || [])) actual[o][card] = (actual[o][card] || 0) + 1;
    }
  }
  flush();

  assert.ok(checks >= 8, `expected a meaningful number of production checks, got ${checks}`);
  assert.deepEqual(mismatches, [], `geometry must match colonist's own production broadcasts.\n${mismatches.join('\n')}`);
});

test('pipsOf matches the values implied by the validated real geometry', () => {
  const b = B.createBoard();
  B.applyFullState(b, payload);                 // robber ends on tile 4 (desert) → no deduction
  const pips = B.pipsOf(b);
  // golden values derived from the SAME geometry the production oracle above validates
  assert.equal(pips[1].total, 24, 'StanTheMan01 total pips');
  assert.deepEqual(pips[1].byRes, { 1: 1, 2: 7, 3: 9, 4: 5, 5: 2 }, 'Stan per-resource pips');
  assert.equal(pips[2].total, 19, 'Mosley total pips');
  assert.deepEqual(pips[2].byRes, { 1: 5, 2: 2, 3: 2, 4: 9, 5: 1 }, 'Mosley per-resource pips');
});

test('the real full state yields complete geometry with no phantom corners', () => {
  const b = B.createBoard();
  B.applyFullState(b, payload);
  assert.deepEqual(B.cornerDiag(b), { total: 54, geom: 54, built: 6, phantom: 0 });
});
