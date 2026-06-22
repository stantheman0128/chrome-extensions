'use strict';

// Independent verification of board.js corner->tile geometry.
//
// The ground truth here is NOT board.js's formula. It is colonist's own type-47
// production broadcasts in a captured real game: on every roll, colonist tells us
// exactly which player produced which resources. A building on a non-desert tile of
// number N that the robber is not on yields its resource (settlement x1, city x2).
//
// I derived the corner(x,y,z)->tile offset formula by brute-forcing every 3-offset
// set (each containing (0,0)) over the -2..2 grid and keeping only the (z=0, z=1)
// pair that reproduces every post-settlement roll's production with zero mismatch.
// That search returned a SINGLE pair, computed here without reading board.js:
//
//   z=0 -> (x,y), (x+1,y-1), (x,y-1)
//   z=1 -> (x,y), (x,y+1),   (x-1,y+1)
//
// This file pins those independently-derived offsets and the pip values I computed
// from them, then asserts board.js reproduces both.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const B = require('../colonist-stats-tracker/board.js');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'ws-fullstate-2p.json'), 'utf8')
);

// --- my independently-derived offsets (NOT copied from board.js) ---
const OFFSETS = {
  0: [[0, 0], [1, -1], [0, -1]],
  1: [[0, 0], [0, 1], [-1, 1]],
};

// --- pull the raw board out of the fixture, no dependency on board.js ---
const map = fixture.gameState.mapState;
const log = fixture.gameState.gameLogState;

const coordToTile = {};
const tileByIdx = {};
for (const i of Object.keys(map.tileHexStates)) {
  const t = map.tileHexStates[i];
  coordToTile[t.x + ',' + t.y] = Number(i);
  tileByIdx[Number(i)] = { type: t.type, num: t.diceNumber };
}

const builtCorners = [];
for (const i of Object.keys(map.tileCornerStates)) {
  const c = map.tileCornerStates[i];
  if (c.owner != null && c.buildingType != null) {
    builtCorners.push({ idx: Number(i), x: c.x, y: c.y, z: c.z, owner: c.owner, bt: c.buildingType });
  }
}

function myTilesOf(c) {
  return OFFSETS[c.z].map(([dx, dy]) => coordToTile[(c.x + dx) + ',' + (c.y + dy)]);
}

// --- resolve the robber over time from type-11 events (no tile index in them) ---
function resolveRobber(tileType, num) {
  const m = [];
  for (const i of Object.keys(map.tileHexStates)) {
    const t = map.tileHexStates[i];
    if (t.type === tileType && t.diceNumber === num) m.push(Number(i));
  }
  return m;
}

// --- the last settlement build closes the geometry; only rolls after it are
//     authoritative for the final board ---
const logKeys = Object.keys(log).map(Number).sort((a, b) => a - b);
let lastSettle = -1;
for (const k of logKeys) {
  const t = log[String(k)].text;
  if (t && (t.type === 4 || t.type === 5) && t.pieceEnum === 2) lastSettle = k;
}

// --- walk the log: track robber, collect (roll N, robber tile, actual production) ---
let robber = null;
for (const i of Object.keys(map.tileHexStates)) {
  if (map.tileHexStates[i].type === 0) robber = Number(i); // desert at game start
}
const rolls = [];
let cur = null;
for (const k of logKeys) {
  const t = log[String(k)] && log[String(k)].text;
  if (!t) continue;
  if (t.type === 11) {
    const m = resolveRobber(t.tileInfo.tileType, t.tileInfo.diceNumber);
    if (m.length === 1) robber = m[0];
  } else if (t.type === 10) {
    cur = { key: k, N: (t.firstDice || 0) + (t.secondDice || 0), robber, prod: {} };
    rolls.push(cur);
  } else if (t.type === 47 && t.distributionType === 1) {
    if (!cur) continue;
    const p = cur.prod[t.playerColor] || (cur.prod[t.playerColor] = {});
    for (const r of (t.cardsToBroadcast || [])) p[r] = (p[r] || 0) + 1;
  }
}
const postRolls = rolls.filter((r) => r.key > lastSettle);

// --- predict production for a roll given a tilesOf() resolver ---
function predict(tilesOf, roll) {
  const out = {};
  for (const c of builtCorners) {
    for (const ti of tilesOf(c)) {
      if (ti == null) continue;
      const t = tileByIdx[ti];
      if (!t || t.type < 1 || t.type > 5) continue; // desert / off-board
      if (t.num !== roll.N) continue;
      if (ti === roll.robber) continue;             // robber blocks the tile
      const pc = out[c.owner] || (out[c.owner] = {});
      pc[t.type] = (pc[t.type] || 0) + (c.bt === 2 ? 2 : 1);
    }
  }
  return out;
}

// count mismatched (color,resource) cells between two production maps
function diffCells(a, b) {
  let checks = 0, mism = 0;
  const colors = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const col of colors) {
    const x = a[col] || {}, y = b[col] || {};
    const res = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const r of res) { checks++; if ((x[r] || 0) !== (y[r] || 0)) mism++; }
  }
  return { checks, mism };
}

// independently computed pips: sum pip(n) over each DISTINCT tile a player's
// buildings touch, robber tile excluded, desert/sea excluded.
const pip = (n) => (n == null || n < 2 || n > 12 || n === 7) ? 0 : 6 - Math.abs(7 - n);
function myPips() {
  const finalRobber = fixture.gameState.mechanicRobberState.locationTileIndex;
  const byOwner = {};
  for (const c of builtCorners) {
    const set = byOwner[c.owner] || (byOwner[c.owner] = new Set());
    for (const ti of myTilesOf(c)) if (ti != null) set.add(ti);
  }
  const out = {};
  for (const owner of Object.keys(byOwner)) {
    const o = (out[owner] = { total: 0, byRes: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    for (const ti of byOwner[owner]) {
      if (ti === finalRobber) continue;
      const t = tileByIdx[ti];
      if (!t || t.type < 1 || t.type > 5) continue;
      const p = pip(t.num);
      o.total += p;
      o.byRes[t.type] += p;
    }
  }
  return out;
}

// ===========================================================================

test('my independent offsets reproduce every post-settlement production (0 mismatch)', () => {
  let checks = 0, mism = 0;
  for (const roll of postRolls) {
    const d = diffCells(predict(myTilesOf, roll), roll.prod);
    checks += d.checks; mism += d.mism;
  }
  // sanity: we actually exercised the geometry
  assert.ok(postRolls.length >= 5, 'expected several post-settlement rolls');
  assert.ok(checks >= 10, 'expected a non-trivial number of production checks');
  assert.equal(mism, 0, 'my derived geometry must explain every broadcast');
});

test('board.js geometry reproduces my independently-derived production (0 mismatch)', () => {
  const b = B.createBoard();
  B.applyFullState(b, fixture);

  // resolve board.js's tilesOf via its public tilesOfCorner, keyed by raw coords
  const boardTilesOf = (c) =>
    B.tilesOfCorner({ x: c.x, y: c.y, z: c.z }).map(([x, y]) => coordToTile[x + ',' + y]);

  let checks = 0, mism = 0;
  for (const roll of postRolls) {
    const d = diffCells(predict(boardTilesOf, roll), roll.prod);
    checks += d.checks; mism += d.mism;
  }
  assert.equal(mism, 0, 'board.js geometry must match colonist broadcasts');
  assert.ok(checks >= 10);
});

test('board.js tilesOfCorner resolves to the same tile SET as my offsets', () => {
  const norm = (pairs) =>
    pairs
      .map(([x, y]) => coordToTile[x + ',' + y])
      .filter((t) => t != null)
      .sort((a, c) => a - c)
      .join(',');
  for (const c of builtCorners) {
    const mine = myTilesOf(c).filter((t) => t != null).sort((a, b) => a - b).join(',');
    const theirs = norm(B.tilesOfCorner({ x: c.x, y: c.y, z: c.z }));
    assert.equal(theirs, mine, `corner ${c.idx} (z=${c.z}) tile set mismatch`);
  }
});

test('board.js pips equal my independently-computed pips', () => {
  const b = B.createBoard();
  B.applyFullState(b, fixture);
  const got = B.pipsOf(b);
  const want = myPips();

  // my numbers, pinned as literals so a regression in either side is caught
  assert.deepEqual(want['1'], { total: 24, byRes: { 1: 1, 2: 7, 3: 9, 4: 5, 5: 2 } });
  assert.deepEqual(want['2'], { total: 19, byRes: { 1: 5, 2: 2, 3: 2, 4: 9, 5: 1 } });

  for (const owner of Object.keys(want)) {
    assert.equal(got[owner].total, want[owner].total, `color ${owner} total pips`);
    assert.deepEqual(got[owner].byRes, want[owner].byRes, `color ${owner} pips by resource`);
  }
});
