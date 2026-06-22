'use strict';

// Independently derives Colonist corner -> adjacent-tile offsets from a real
// id=130/type=4 WebSocket snapshot. It does not import board.js or use a
// hand-authored expected formula: Colonist's type-47 production broadcasts are
// the oracle.

const fs = require('node:fs');

const DEFAULT_CAPTURE = 'C:/Users/stans/Downloads/cst-ws-frames (1).json';
const capturePath = process.argv[2] || DEFAULT_CAPTURE;

function canonical(production) {
  return Object.keys(production)
    .sort((a, b) => Number(a) - Number(b))
    .map((owner) => {
      const resources = Object.keys(production[owner])
        .sort((a, b) => Number(a) - Number(b))
        .map((resource) => `${resource}x${production[owner][resource]}`)
        .join(',');
      return `${owner}:${resources}`;
    })
    .join('|');
}

function findSnapshot(frames) {
  for (const frame of frames) {
    const message = frame && frame.data;
    const data = message && message.data;
    if (String(message && message.id) === '130' && data && data.type === 4) return data.payload;
  }
  throw new Error('No id=130, data.type=4 full snapshot was found');
}

function combinations(items, size, start = 0, prefix = [], out = []) {
  if (prefix.length === size) {
    out.push(prefix.slice());
    return out;
  }
  for (let i = start; i < items.length; i += 1) {
    prefix.push(items[i]);
    combinations(items, size, i + 1, prefix, out);
    prefix.pop();
  }
  return out;
}

function main() {
  const frames = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  const payload = findSnapshot(frames);
  const gameState = payload.gameState;
  const tileEntries = Object.entries(gameState.mapState.tileHexStates || {});
  const cornerEntries = Object.entries(gameState.mapState.tileCornerStates || {});
  const builtCorners = cornerEntries.filter(([, c]) => c.owner != null && c.buildingType);
  const logEntries = Object.entries(gameState.gameLogState || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  const tileAt = new Map();
  for (const [index, tile] of tileEntries) {
    tileAt.set(`${tile.x},${tile.y}`, { index, ...tile });
  }

  let lastSettlement = -1;
  for (const [index, entry] of logEntries) {
    const text = entry && entry.text;
    if (text && (text.type === 4 || text.type === 5) && text.pieceEnum === 2) {
      lastSettlement = Math.max(lastSettlement, Number(index));
    }
  }
  if (lastSettlement < 0) throw new Error('No settlement event was found');

  function tileIndexForRobberMove(tileInfo) {
    const matches = tileEntries.filter(([, tile]) => (
      tile.type === tileInfo.tileType && tile.diceNumber === (tileInfo.diceNumber || 0)
    ));
    if (matches.length !== 1) {
      throw new Error(`Robber tileInfo is not unique: ${JSON.stringify(tileInfo)} (${matches.length} matches)`);
    }
    return matches[0][0];
  }

  // The robber starts on the only desert. A type-11/pieceEnum-5 entry moves it.
  const deserts = tileEntries.filter(([, tile]) => tile.type === 0);
  if (deserts.length !== 1) throw new Error(`Expected one desert, got ${deserts.length}`);
  let robberTile = deserts[0][0];
  let currentRoll = null;
  const checks = [];

  function flushRoll() {
    if (currentRoll) checks.push(currentRoll);
    currentRoll = null;
  }

  for (const [indexText, entry] of logEntries) {
    const index = Number(indexText);
    const text = entry && entry.text;
    if (!text) continue;

    if (text.type === 10) {
      flushRoll();
      if (index > lastSettlement) {
        currentRoll = {
          index,
          sum: (text.firstDice || 0) + (text.secondDice || 0),
          robberTile,
          actual: {},
        };
      }
    } else if (text.type === 47 && text.distributionType === 1 && currentRoll) {
      const owner = String(text.playerColor);
      currentRoll.actual[owner] ||= {};
      for (const resource of text.cardsToBroadcast || []) {
        currentRoll.actual[owner][resource] = (currentRoll.actual[owner][resource] || 0) + 1;
      }
    } else if (text.type === 11 && text.pieceEnum === 5 && text.tileInfo) {
      robberTile = tileIndexForRobberMove(text.tileInfo);
    }
  }
  flushRoll();

  function predict(check, z0Offsets, z1Offsets) {
    const out = {};
    if (check.sum === 7) return out;

    for (const [, corner] of builtCorners) {
      const offsets = corner.z === 0 ? z0Offsets : z1Offsets;
      for (const [dx, dy] of offsets) {
        const tile = tileAt.get(`${corner.x + dx},${corner.y + dy}`);
        if (!tile || tile.type === 0 || tile.diceNumber !== check.sum) continue;
        if (String(tile.index) === String(check.robberTile)) continue;

        const owner = String(corner.owner);
        out[owner] ||= {};
        out[owner][tile.type] = (out[owner][tile.type] || 0)
          + (corner.buildingType === 2 ? 2 : 1);
      }
    }
    return out;
  }

  function score(z0Offsets, z1Offsets) {
    const mismatches = [];
    for (const check of checks) {
      const predicted = predict(check, z0Offsets, z1Offsets);
      if (canonical(predicted) !== canonical(check.actual)) {
        mismatches.push({
          logIndex: check.index,
          roll: check.sum,
          robberTile: check.robberTile,
          predicted: canonical(predicted) || '(none)',
          actual: canonical(check.actual) || '(none)',
        });
      }
    }
    return mismatches;
  }

  // A corner's adjacent hexes must be within one axial-coordinate step. Search a
  // deliberately broad 3x3 offset neighborhood: C(9,3)=84 triples per z branch.
  const localOffsets = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) localOffsets.push([dx, dy]);
  }
  const triples = combinations(localOffsets, 3);
  const winners = [];
  let bestWrong = Number.POSITIVE_INFINITY;

  for (const z0Offsets of triples) {
    for (const z1Offsets of triples) {
      const wrong = score(z0Offsets, z1Offsets).length;
      if (wrong < bestWrong) {
        bestWrong = wrong;
        winners.length = 0;
        winners.push({ z0Offsets, z1Offsets });
      } else if (wrong === bestWrong) {
        winners.push({ z0Offsets, z1Offsets });
      }
    }
  }

  const winner = winners[0];
  const legacyZ1 = [[0, 0], [1, 0], [1, -1]];
  const legacyMismatches = score(winner.z0Offsets, legacyZ1);

  console.log(`capture: ${capturePath}`);
  console.log(`tiles=${tileEntries.length}, corners=${cornerEntries.length}, built=${builtCorners.length}`);
  console.log(`last settlement log index=${lastSettlement}, post-settlement rolls checked=${checks.length}`);
  console.log(`candidate triples per branch=${triples.length}, pairs searched=${triples.length ** 2}`);
  console.log(`best mismatch count=${bestWrong}, equally-best pairs=${winners.length}`);
  console.log(`z=0 offsets: ${JSON.stringify(winner.z0Offsets)}`);
  console.log(`z=1 offsets: ${JSON.stringify(winner.z1Offsets)}`);
  console.log(`z=0 validation (unique z=1 winner held fixed): ${checks.length} checked, ${score(winner.z0Offsets, winner.z1Offsets).length} wrong`);
  console.log(`z=1 validation (unique z=0 winner held fixed): ${checks.length} checked, ${score(winner.z0Offsets, winner.z1Offsets).length} wrong`);
  console.log(`legacy z=1 ${JSON.stringify(legacyZ1)}: ${checks.length} checked, ${legacyMismatches.length} wrong`);

  if (legacyMismatches.length) {
    console.log('legacy mismatches:');
    for (const mismatch of legacyMismatches) console.log(`  ${JSON.stringify(mismatch)}`);
  }

  if (bestWrong !== 0 || winners.length !== 1) process.exitCode = 1;
}

main();
