'use strict';

// Verification-agent fixture generator.
//
// Reads a REAL colonist WS full-state JSON and writes frozen oracle files under
// tests/fixtures/oracle/. Expected values come ONLY from:
//   (1) colonist's own gameLog broadcasts (type 47 production, 55 discard, …), or
//   (2) geometry derived here with INDEPENDENT corner→tile offsets (NOT board.js).
//
// Usage:
//   node tools/generate-oracle-fixtures.js [path/to/fullstate.json] [outputDir]
//
// Default input: tests/fixtures/ws-fullstate-2p.json

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_IN = path.join(ROOT, 'tests', 'fixtures', 'ws-fullstate-2p.json');
const DEFAULT_OUT = path.join(ROOT, 'tests', 'fixtures', 'oracle');

// Independently verified offsets (same derivation as tests/ws-geometry-independent.test.js).
// DO NOT import board.js — this file is the verification agent's source of truth.
const OFFSETS = {
  0: [[0, 0], [1, -1], [0, -1]],
  1: [[0, 0], [0, 1], [-1, 1]],
};

const pip = (n) => (n == null || n < 2 || n > 12 || n === 7) ? 0 : 6 - Math.abs(7 - n);

function tilesOfCorner(c, coordToTile) {
  return OFFSETS[c.z].map(([dx, dy]) => coordToTile[(c.x + dx) + ',' + (c.y + dy)]);
}

function resolveRobber(tileHexStates, tileInfo) {
  const matches = [];
  for (const i of Object.keys(tileHexStates)) {
    const t = tileHexStates[i];
    if (t.type === tileInfo.tileType && t.diceNumber === (tileInfo.diceNumber || 0)) {
      matches.push(Number(i));
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function predictProduction(builtCorners, tileByIdx, coordToTile, rollN, robberTile) {
  const out = {};
  for (const c of builtCorners) {
    for (const ti of tilesOfCorner(c, coordToTile)) {
      if (ti == null) continue;
      const t = tileByIdx[ti];
      if (!t || t.type < 1 || t.type > 5 || t.num !== rollN) continue;
      if (ti === robberTile) continue;
      const pc = out[c.owner] || (out[c.owner] = {});
      pc[t.type] = (pc[t.type] || 0) + (c.bt === 2 ? 2 : 1);
    }
  }
  return out;
}

function predictBlocked(builtCorners, tileByIdx, coordToTile, rollN, robberTile) {
  const t = tileByIdx[robberTile];
  if (!t || t.num !== rollN || t.type < 1 || t.type > 5) return {};
  const out = {};
  for (const c of builtCorners) {
    for (const ti of tilesOfCorner(c, coordToTile)) {
      if (ti !== robberTile) continue;
      out[c.owner] = (out[c.owner] || 0) + (c.bt === 2 ? 2 : 1);
    }
  }
  return out;
}

function accrueStatsFromLog(log) {
  const stats = {};
  const ensure = (color) => stats[color] || (stats[color] = {
    gained: 0, gainedRes: {},
    discards: 0, discardCards: 0, discardRes: {},
  });

  for (const key of Object.keys(log).map(Number).sort((a, b) => a - b)) {
    const text = log[String(key)] && log[String(key)].text;
    if (!text) continue;
    if (text.type === 55) {
      const cards = text.cardEnums || [];
      if (!cards.length) continue;
      const s = ensure(text.playerColor);
      s.discards += 1;
      s.discardCards += cards.length;
      for (const c of cards) s.discardRes[c] = (s.discardRes[c] || 0) + 1;
    } else if (text.type === 47 || text.type === 21) {
      const cards = text.cardsToBroadcast || text.cardEnums || [];
      if (!cards.length) continue;
      const s = ensure(text.playerColor);
      for (const c of cards) {
        s.gained += 1;
        s.gainedRes[c] = (s.gainedRes[c] || 0) + 1;
      }
    }
  }
  return stats;
}

function buildOracle(payload, sourceRel) {
  const gameState = payload.gameState;
  const map = gameState.mapState;
  const log = gameState.gameLogState || {};

  const coordToTile = {};
  const tileByIdx = {};
  for (const i of Object.keys(map.tileHexStates || {})) {
    const t = map.tileHexStates[i];
    coordToTile[t.x + ',' + t.y] = Number(i);
    tileByIdx[Number(i)] = { type: t.type, num: t.diceNumber };
  }

  const builtCorners = [];
  for (const i of Object.keys(map.tileCornerStates || {})) {
    const c = map.tileCornerStates[i];
    if (c.owner != null && c.buildingType != null) {
      builtCorners.push({ idx: Number(i), x: c.x, y: c.y, z: c.z, owner: c.owner, bt: c.buildingType });
    }
  }

  let lastSettle = -1;
  for (const k of Object.keys(log).map(Number).sort((a, b) => a - b)) {
    const t = log[String(k)] && log[String(k)].text;
    if (t && (t.type === 4 || t.type === 5) && t.pieceEnum === 2) lastSettle = k;
  }

  let robber = gameState.mechanicRobberState && gameState.mechanicRobberState.locationTileIndex;
  if (robber == null) {
    for (const i of Object.keys(map.tileHexStates || {})) {
      if (map.tileHexStates[i].type === 0) { robber = Number(i); break; }
    }
  }

  const productionRolls = [];
  let cur = null;
  for (const k of Object.keys(log).map(Number).sort((a, b) => a - b)) {
    const t = log[String(k)] && log[String(k)].text;
    if (!t) continue;
    if (t.type === 11 && t.tileInfo) {
      const idx = resolveRobber(map.tileHexStates, t.tileInfo);
      if (idx != null) robber = idx;
    } else if (t.type === 10) {
      if (cur) productionRolls.push(cur);
      cur = {
        logKey: k,
        roll: (t.firstDice || 0) + (t.secondDice || 0),
        robberTile: robber,
        actual: {},
        postSettlement: k > lastSettle,
      };
    } else if (t.type === 47 && t.distributionType === 1 && cur) {
      const p = cur.actual[t.playerColor] || (cur.actual[t.playerColor] = {});
      for (const r of (t.cardsToBroadcast || [])) p[r] = (p[r] || 0) + 1;
    }
  }
  if (cur) productionRolls.push(cur);

  const postRolls = productionRolls.filter((r) => r.postSettlement);
  for (const roll of postRolls) {
    roll.predicted = predictProduction(builtCorners, tileByIdx, coordToTile, roll.roll, roll.robberTile);
    roll.blocked = predictBlocked(builtCorners, tileByIdx, coordToTile, roll.roll, roll.robberTile);
    let mism = 0;
    const owners = new Set([...Object.keys(roll.predicted || {}), ...Object.keys(roll.actual || {})]);
    for (const o of owners) {
      const p = roll.predicted[o] || {}, a = roll.actual[o] || {};
      const res = new Set([...Object.keys(p), ...Object.keys(a)]);
      for (const r of res) if ((p[r] || 0) !== (a[r] || 0)) mism += 1;
    }
    roll.productionMatch = mism === 0;
  }

  const finalRobber = gameState.mechanicRobberState && gameState.mechanicRobberState.locationTileIndex;
  const pipsByOwner = {};
  for (const c of builtCorners) {
    const set = pipsByOwner[c.owner] || (pipsByOwner[c.owner] = new Set());
    for (const ti of tilesOfCorner(c, coordToTile)) if (ti != null) set.add(ti);
  }
  const pips = {};
  for (const owner of Object.keys(pipsByOwner)) {
    const o = (pips[owner] = { total: 0, byRes: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    for (const ti of pipsByOwner[owner]) {
      if (ti === finalRobber) continue;
      const t = tileByIdx[ti];
      if (!t || t.type < 1 || t.type > 5) continue;
      const p = pip(t.num);
      o.total += p;
      o.byRes[t.type] += p;
    }
  }

  const snapshotHands = {};
  for (const color of Object.keys(gameState.playerStates || {})) {
    const cards = (gameState.playerStates[color].resourceCards || {}).cards;
    snapshotHands[color] = {
      count: Array.isArray(cards) ? cards.length : null,
      exactCards: Array.isArray(cards) && cards.some((c) => c >= 1 && c <= 5) ? cards.slice() : null,
    };
  }

  return {
    meta: {
      generator: 'tools/generate-oracle-fixtures.js',
      source: sourceRel,
      gameId: (payload.gameSettings && payload.gameSettings.id) || null,
      generatedAt: new Date().toISOString(),
      oraclePolicy: 'colonist gameLog broadcasts + independent geometry offsets (no board.js)',
    },
    geometry: { offsets: OFFSETS, lastSettlementLogKey: lastSettle },
    productionRolls: postRolls,
    pips,
    statsFromLog: accrueStatsFromLog(log),
    snapshotHands,
    devCards: gameState.mechanicDevelopmentCardsState && gameState.mechanicDevelopmentCardsState.players,
  };
}

function writeScenarioOrdering(outDir) {
  // Minimal replay sequence: hand total arrives before type-47 names the resource.
  // Expected values are stated explicitly (verification agent), not from board.js.
  const scenario = {
    meta: {
      id: 'late-production-ordering',
      description: 'playerStates hand count before gameLog type-47; ore must land on ore not unknown',
      oraclePolicy: 'explicit expected panel state after each relay step',
    },
    steps: [
      {
        label: 'full state',
        frame: { type: 4, payload: {
          gameSettings: { id: 'oracle-order-A' },
          gameState: {
            playerColor: 1,
            mapState: { tileHexStates: {}, tileCornerStates: {} },
            mechanicRobberState: { locationTileIndex: 0 },
            playerStates: { 1: { resourceCards: { cards: [1] } }, 2: { resourceCards: { cards: [] } } },
            gameLogState: {},
          },
          playerUserStates: [
            { selectedColor: 1, username: 'Stan' },
            { selectedColor: 2, username: 'Mosley' },
          ],
        } },
        expect: { Mosley: { ore: 0, unknown: 0 } },
      },
      {
        label: 'hand total only',
        frame: { type: 91, payload: { diff: { playerStates: { 2: { resourceCards: { cards: [0, 0] } } } } } },
        expect: { Mosley: { ore: 0, unknown: 2 } },
      },
      {
        label: 'production names ore',
        frame: { type: 91, payload: { diff: { gameLogState: {
          1: { text: { type: 47, playerColor: 2, cardsToBroadcast: [5, 5], distributionType: 1 } },
        } } } },
        expect: { Mosley: { ore: 2, unknown: 0 } },
      },
    ],
  };
  fs.writeFileSync(
    path.join(outDir, 'scenario-late-production-ordering.json'),
    JSON.stringify(scenario, null, 2) + '\n'
  );
}

function main() {
  const inputPath = path.resolve(process.argv[2] || DEFAULT_IN);
  const outDir = path.resolve(process.argv[3] || DEFAULT_OUT);
  fs.mkdirSync(outDir, { recursive: true });

  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const sourceRel = path.relative(ROOT, inputPath).replace(/\\/g, '/');
  const oracle = buildOracle(payload, sourceRel);

  const mismRolls = oracle.productionRolls.filter((r) => !r.productionMatch);
  if (mismRolls.length) {
    console.error('Oracle self-check FAILED:', mismRolls.length, 'production mismatches');
    for (const r of mismRolls.slice(0, 3)) {
      console.error('  roll', r.roll, 'logKey', r.logKey, 'actual', r.actual, 'predicted', r.predicted);
    }
    process.exit(1);
  }

  const outFile = path.join(outDir, `${path.basename(inputPath, '.json')}-oracle.json`);
  fs.writeFileSync(outFile, JSON.stringify(oracle, null, 2) + '\n');
  writeScenarioOrdering(outDir);

  console.log('Wrote', path.relative(ROOT, outFile));
  console.log('  production rolls (post-settlement):', oracle.productionRolls.length);
  console.log('  stats players:', Object.keys(oracle.statsFromLog).length);
  console.log('Wrote scenario-late-production-ordering.json');
}

main();
