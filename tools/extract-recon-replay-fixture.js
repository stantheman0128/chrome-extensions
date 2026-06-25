'use strict';

// Build a hand-recon replay fixture (inputs only) from a ws-inspector save() dump.
// The fixture stores opening fullState, pre-buffer log catch-up range, dev-state
// timeline extracted from buffer frames, and slim type-91 diffs — NO expected breakdowns.
//
// Usage:
//   node tools/extract-recon-replay-fixture.js path/to/cst-ws-frames.json [gameId]

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadDump(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function slimDiff(diff) {
  if (!diff) return null;
  const out = {};
  if (diff.gameLogState) out.gameLogState = diff.gameLogState;
  if (diff.playerStates) out.playerStates = diff.playerStates;
  if (diff.mechanicDevelopmentCardsState) out.mechanicDevelopmentCardsState = diff.mechanicDevelopmentCardsState;
  return Object.keys(out).length ? out : null;
}

function firstBufferLogIndex(frames) {
  let min = null;
  for (const fr of frames) {
    const msg = fr.data;
    if (String(msg && msg.id) !== '130' || msg.data?.type !== 91) continue;
    const gl = msg.data.payload?.diff?.gameLogState;
    if (!gl) continue;
    for (const k of Object.keys(gl)) {
      const n = parseInt(k, 10);
      if (min == null || n < min) min = n;
    }
  }
  return min;
}

function extractDevAtLogIndex(frames) {
  const devAt = {};
  for (const fr of frames) {
    const msg = fr.data;
    if (String(msg?.id) !== '130' || msg.data?.type !== 91) continue;
    const diff = msg.data.payload?.diff;
    if (!diff?.mechanicDevelopmentCardsState || !diff.gameLogState) continue;
    const idx = Math.max(...Object.keys(diff.gameLogState).map((k) => parseInt(k, 10)));
    devAt[String(idx)] = diff.mechanicDevelopmentCardsState;
  }
  return devAt;
}

function extractSteps(frames) {
  const steps = [];
  for (const fr of frames) {
    const msg = fr.data;
    if (String(msg?.id) !== '130' || msg.data?.type !== 91) continue;
    const diff = slimDiff(msg.data.payload?.diff);
    if (!diff) continue;
    steps.push({ kind: 'diff', diff });
  }
  return steps;
}

function main() {
  const capturePath = process.argv[2];
  const gameIdArg = process.argv[3];
  if (!capturePath) {
    console.error('Usage: node tools/extract-recon-replay-fixture.js <cst-ws-frames.json> [gameId]');
    process.exit(1);
  }

  const dump = loadDump(capturePath);
  if (!dump.fullState?.data?.payload) {
    console.error('Dump has no fullState.data.payload — need ws-inspector save()');
    process.exit(1);
  }

  const payload = dump.fullState.data.payload;
  const gameId = gameIdArg || payload.gameSettings?.id || 'capture';
  const firstLog = firstBufferLogIndex(dump.frames || []);
  if (firstLog == null) {
    console.error('No type-91 buffer frames with gameLogState found');
    process.exit(1);
  }

  const fixture = {
    meta: {
      id: `${gameId}-4p-recon-replay`,
      gameId,
      players: (payload.playerUserStates || []).length || 4,
      oraclePolicy: 'protocol invariants only — no expected opponent breakdown',
      sourceCapture: path.basename(capturePath),
      preCatchUpGamelogFixture: `ws-${gameId}-4p-gamelog.json`,
      firstBufferLogIndex: firstLog,
    },
    opening: { kind: 'fullState', payload },
    preCatchUp: { from: 6, to: firstLog - 1 },
    devAtLogIndex: extractDevAtLogIndex(dump.frames || []),
    steps: extractSteps(dump.frames || []),
  };

  const outPath = path.join(ROOT, 'tests', 'fixtures', 'oracle', `${gameId}-4p-recon-replay.json`);
  fs.writeFileSync(outPath, JSON.stringify(fixture));
  console.log('Wrote', path.relative(ROOT, outPath));
  console.log('  steps:', fixture.steps.length, 'preCatchUp: 6..', firstLog - 1, 'devAt:', Object.keys(fixture.devAtLogIndex).length);
}

main();
