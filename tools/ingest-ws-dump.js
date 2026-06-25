'use strict';

// Ingest a colonist WS dump saved by ws-inspector save():
//   { frames, log, fullState, savedAtFrame }
//
// Writes:
//   tests/fixtures/<basename>-gamelog.json
//   tests/fixtures/oracle/<gameId>-4p-stats-oracle.json
//
// If tests/fixtures/oracle/<gameId>-4p-audit-endstate.json exists, log type counts
// MUST match (verification gate). Audit endstate files are committed separately —
// this script never overwrites them.
//
// Usage:
//   node tools/ingest-ws-dump.js path/to/cst-ws-frames.json [basename]

const fs = require('node:fs');
const path = require('node:path');
const { buildStatsOracle, countLogTypes } = require('./oracle-from-log');

const ROOT = path.join(__dirname, '..');
const capturePath = process.argv[2];
const baseName = process.argv[3];

if (!capturePath) {
  console.error('Usage: node tools/ingest-ws-dump.js <cst-ws-frames.json> [basename]');
  process.exit(1);
}

function loadDump(filePath) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  if (Array.isArray(raw)) return { frames: raw, log: null, fullState: null };
  return raw;
}

function gameIdFromDump(dump) {
  const fs0 = dump.fullState;
  if (fs0 && fs0.data && fs0.data.payload && fs0.data.payload.gameSettings) {
    return fs0.data.payload.gameSettings.id;
  }
  for (const fr of dump.frames || []) {
    const msg = fr.data;
    const p = msg && msg.data && msg.data.payload;
    if (String(msg && msg.id) === '130' && msg.data && msg.data.type === 4 && p && p.gameSettings) {
      return p.gameSettings.id;
    }
  }
  return null;
}

function auditManifestPath(gameId) {
  return path.join(ROOT, 'tests', 'fixtures', 'oracle', `${gameId}-4p-audit-endstate.json`);
}

function validateAgainstAudit(gameId, logTypes) {
  const auditPath = auditManifestPath(gameId);
  if (!fs.existsSync(auditPath)) {
    console.log('No audit manifest at', path.relative(ROOT, auditPath), '— skip log cross-check');
    return;
  }
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  for (const [ty, n] of Object.entries(audit.logTypeCounts)) {
    if ((logTypes[ty] || 0) !== n) {
      console.error(`log type ${ty}: dump has ${logTypes[ty] || 0}, audit expects ${n}`);
      process.exit(1);
    }
  }
  console.log('log type counts match', path.basename(auditPath), '✓');
}

function main() {
  const dump = loadDump(capturePath);
  if (!dump.log || typeof dump.log !== 'object' || !Object.keys(dump.log).length) {
    console.error('Dump has no uncapped `log` object — need ws-inspector save() with logEntries.');
    process.exit(1);
  }

  const gameId = gameIdFromDump(dump) || baseName || `capture-${Date.now()}`;
  const slug = baseName || `ws-${gameId}-4p`;
  const logTypes = countLogTypes(dump.log);
  const oracleDir = path.join(ROOT, 'tests', 'fixtures', 'oracle');
  const fixDir = path.join(ROOT, 'tests', 'fixtures');
  fs.mkdirSync(oracleDir, { recursive: true });

  validateAgainstAudit(gameId, logTypes);

  const gamelogRel = `tests/fixtures/${slug}-gamelog.json`;
  const gamelogPath = path.join(fixDir, `${slug}-gamelog.json`);
  fs.writeFileSync(gamelogPath, JSON.stringify({
    meta: {
      gameId,
      sourceCapture: path.basename(capturePath),
      logEntryCount: Object.keys(dump.log).length,
      logTypeCounts: logTypes,
      savedAtFrame: dump.savedAtFrame || null,
    },
    gameLogState: dump.log,
  }, null, 2) + '\n');
  console.log('Wrote', gamelogRel);

  const statsOracle = buildStatsOracle(dump.log, {
    id: `${gameId}-4p-stats-oracle`,
    gameId,
    source: gamelogRel,
    generatedAt: new Date().toISOString(),
  });
  const statsPath = path.join(oracleDir, `${gameId}-4p-stats-oracle.json`);
  fs.writeFileSync(statsPath, JSON.stringify(statsOracle, null, 2) + '\n');
  console.log('Wrote', path.relative(ROOT, statsPath));
}

main();
