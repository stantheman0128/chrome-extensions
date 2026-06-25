'use strict';

// Verification-agent tests for real-game captures (gamelog + frozen oracles).
// Expected values come from tests/fixtures/oracle/* — NOT recomputed from board.js for oracles.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const B = require('../colonist-stats-tracker/board.js');
const { buildStatsOracle } = require('../tools/oracle-from-log');

const ORACLE_DIR = path.join(__dirname, 'fixtures', 'oracle');
const RES = ['', 'lumber', 'brick', 'wool', 'grain', 'ore'];

function loadCapture(gameId, slug, players) {
  const gamelog = require(`./fixtures/${slug}-gamelog.json`);
  const stats = JSON.parse(fs.readFileSync(path.join(ORACLE_DIR, `${gameId}-4p-stats-oracle.json`), 'utf8'));
  const audit = JSON.parse(fs.readFileSync(path.join(ORACLE_DIR, `${gameId}-4p-audit-endstate.json`), 'utf8'));
  return { gamelog, stats, audit, players };
}

function boardFromLog(gamelog, playerUserStates) {
  const payload = {
    gameSettings: { id: gamelog.meta.gameId },
    gameState: {
      playerColor: 1,
      mapState: { tileHexStates: {}, tileCornerStates: {} },
      mechanicRobberState: { locationTileIndex: 0 },
      playerStates: {},
      gameLogState: gamelog.gameLogState,
    },
    playerUserStates,
  };
  const b = B.createBoard();
  B.applyFullState(b, payload);
  return b;
}

function monoResIdToName(monoTook) {
  const out = {};
  for (const [resId, n] of Object.entries(monoTook || {})) {
    out[RES[Number(resId)]] = n;
  }
  return out;
}

function runCaptureSuite(label, gameId, slug, playerUserStates) {
  const { gamelog, stats, audit } = loadCapture(gameId, slug, playerUserStates);

  test(`${label}: gamelog matches audit log type counts`, () => {
    assert.equal(gamelog.meta.gameId, gameId);
    for (const [ty, n] of Object.entries(audit.logTypeCounts)) {
      assert.equal(gamelog.meta.logTypeCounts[ty] || 0, n, `log type ${ty}`);
    }
  });

  test(`${label}: stats oracle re-derives identically from gamelog`, () => {
    const again = buildStatsOracle(gamelog.gameLogState, { gameId });
    assert.deepEqual(again.statsFromLog, stats.statsFromLog);
    assert.deepEqual(again.logTypeCounts, stats.logTypeCounts);
  });

  test(`${label}: board.js wsStats match frozen stats oracle`, () => {
    const b = boardFromLog(gamelog, playerUserStates);
    for (const color of Object.keys(stats.statsFromLog)) {
      const want = stats.statsFromLog[color];
      const got = B.statsOf(b, Number(color));
      assert.ok(got, `color ${color}`);
      assert.equal(got.gained, want.gained, `color ${color} gained`);
      assert.equal(got.discards, want.discards, `color ${color} discard events`);
      assert.equal(got.discardCards, want.discardCards, `color ${color} discardCards`);
      assert.equal(JSON.stringify(got.monoTook || {}), JSON.stringify(want.monoTook || {}), `color ${color} mono`);
    }
  });

  test(`${label}: stats oracle matches audit gained + discardCards + mono`, () => {
    for (const [name, p] of Object.entries(audit.players)) {
      const s = stats.statsFromLog[String(p.color)];
      assert.ok(s, name);
      assert.equal(s.gained, p.stats.gained, `${name} gained`);
      assert.equal(s.discardCards, p.stats.discardCards, `${name} discardCards (audit disc)`);
      assert.equal(s.discards, p.stats.discards, `${name} discard events`);
      const monoName = monoResIdToName(s.monoTook);
      assert.deepEqual(monoName, p.stats.monoTook || {}, `${name} mono`);
    }
  });
}

runCaptureSuite('mine143', 'mine143', 'ws-mine143-4p', [
  { selectedColor: 1, username: 'StanTheMan01' },
  { selectedColor: 2, username: 'Linc' },
  { selectedColor: 3, username: 'Timi' },
  { selectedColor: 4, username: 'Ritch' },
]);

runCaptureSuite('deal2630', 'deal2630', 'ws-deal2630-4p', [
  { selectedColor: 1, username: 'StanTheMan01' },
  { selectedColor: 2, username: 'Orvan' },
  { selectedColor: 3, username: 'Verge' },
  { selectedColor: 4, username: 'Teddi' },
]);

test('deal2630 has type-55 discard events in log (10 total)', () => {
  const { gamelog } = loadCapture('deal2630', 'ws-deal2630-4p', []);
  assert.equal(gamelog.meta.logTypeCounts[55], 10);
  assert.equal(gamelog.meta.logTypeCounts[47], 146);
});

test('deal2630 audit documents blockLoss (manual map fixture pending)', () => {
  const { audit } = loadCapture('deal2630', 'ws-deal2630-4p', []);
  assert.equal(audit.players.Verge.blockLoss, 10);
  assert.equal(audit.players.StanTheMan01.stats.discardCards, 18);
});
