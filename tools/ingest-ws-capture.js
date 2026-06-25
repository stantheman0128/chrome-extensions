'use strict';

// Legacy entry — prefer tools/ingest-ws-dump.js for { frames, log, fullState } saves.
// This wrapper still supports plain frame arrays (first type-4 snapshot only).

const { execSync } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, 'ingest-ws-dump.js');
const capture = process.argv[2];
const base = process.argv[3];

if (!capture) {
  console.error('Usage: node tools/ingest-ws-capture.js <dump.json> [basename]');
  console.error('See tools/ingest-ws-dump.js');
  process.exit(1);
}

execSync(`node "${script}" "${capture}" ${base || ''}`, { stdio: 'inherit' });
