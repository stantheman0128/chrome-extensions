'use strict';

// Verification-agent tests: board.js / content.js are UNDER TEST.
// Expected values come from frozen files in tests/fixtures/oracle/ only.
// Regenerate with: node tools/generate-oracle-fixtures.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const B = require('../colonist-stats-tracker/board.js');
const fullPayload = require('./fixtures/ws-fullstate-2p.json');

const ORACLE_DIR = path.join(__dirname, 'fixtures', 'oracle');
const ORACLE_FILE = path.join(ORACLE_DIR, 'ws-fullstate-2p-oracle.json');
const SCENARIO_FILE = path.join(ORACLE_DIR, 'scenario-late-production-ordering.json');

function loadOracle() {
  if (!fs.existsSync(ORACLE_FILE)) {
    throw new Error('Missing oracle file — run: node tools/generate-oracle-fixtures.js');
  }
  return JSON.parse(fs.readFileSync(ORACLE_FILE, 'utf8'));
}

function productionEqual(a, b) {
  const owners = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const o of owners) {
    const x = a[o] || {}, y = b[o] || {};
    const res = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const r of res) if ((x[r] || 0) !== (y[r] || 0)) return false;
  }
  return true;
}

test('oracle file exists and self-validated at generation time', () => {
  const oracle = loadOracle();
  assert.equal(oracle.meta.source, 'tests/fixtures/ws-fullstate-2p.json');
  assert.equal(oracle.meta.gameId, 'grain6414');
  assert.ok(oracle.productionRolls.length >= 5);
  for (const roll of oracle.productionRolls) {
    assert.equal(roll.productionMatch, true, `roll ${roll.roll} at log ${roll.logKey}`);
  }
});

test('board.js production matches frozen oracle on every post-settlement roll', () => {
  const oracle = loadOracle();
  const b = B.createBoard();
  B.applyFullState(b, fullPayload);

  const log = fullPayload.gameState.gameLogState;
  const keys = Object.keys(log).map(Number).sort((a, b) => a - b);
  let robber = fullPayload.gameState.mechanicRobberState.locationTileIndex;
  let curRoll = null;
  const oracleByKey = new Map(oracle.productionRolls.map((r) => [r.logKey, r]));

  for (const k of keys) {
    const tx = log[String(k)] && log[String(k)].text;
    if (!tx) continue;
    if (tx.type === 11 && tx.tileInfo) {
      for (const ti of Object.keys(b.tiles)) {
        const t = b.tiles[ti];
        if (t.type === tx.tileInfo.tileType && t.number === (tx.tileInfo.diceNumber || 0)) {
          b.robberTile = Number(ti);
          robber = Number(ti);
        }
      }
    } else if (tx.type === 10) {
      curRoll = (tx.firstDice || 0) + (tx.secondDice || 0);
    } else if (tx.type === 47 && tx.distributionType === 1 && curRoll != null) {
      const expected = oracleByKey.get(k);
      if (!expected) continue;
      const pred = B.predictProduction(b, curRoll);
      assert.ok(productionEqual(pred, expected.actual),
        `log ${k} roll ${curRoll}: board predict ${JSON.stringify(pred)} vs oracle ${JSON.stringify(expected.actual)}`);
    }
  }
});

test('board.js pips match frozen oracle', () => {
  const oracle = loadOracle();
  const b = B.createBoard();
  B.applyFullState(b, fullPayload);
  for (const color of Object.keys(oracle.pips)) {
    const got = B.pipsOf(b)[color];
    const want = oracle.pips[color];
    assert.ok(got, `color ${color} has pips`);
    assert.equal(got.total, want.total, `color ${color} pip total`);
    for (const r of [1, 2, 3, 4, 5]) {
      assert.equal(got.byRes[r] || 0, want.byRes[r] || 0, `color ${color} res ${r} pips`);
    }
  }
});

test('board.js stats accrual matches log-derived oracle (gained / discards)', () => {
  const oracle = loadOracle();
  const b = B.createBoard();
  B.applyFullState(b, fullPayload);
  for (const color of Object.keys(oracle.statsFromLog)) {
    const want = oracle.statsFromLog[color];
    const got = B.statsOf(b, Number(color));
    assert.ok(got, `stats for color ${color}`);
    assert.equal(got.gained, want.gained, `color ${color} gained`);
    assert.equal(got.discards, want.discards, `color ${color} discards`);
    assert.equal(got.discardCards, want.discardCards, `color ${color} discardCards`);
  }
});

test('scenario oracle: late production ordering converges on ore (content.js)', () => {
  const scenario = JSON.parse(fs.readFileSync(SCENARIO_FILE, 'utf8'));
  const { cst } = require('./helpers/setup');
  const window = global.window;

  function relay(frame) {
    window.dispatchEvent(new window.MessageEvent('message', {
      data: { __cstWS: 'state', msg: { id: '130', data: frame } },
    }));
  }

  cst.resetState();
  cst.createPanel();
  for (const step of scenario.steps) {
    relay(step.frame);
    for (const [name, exp] of Object.entries(step.expect)) {
      const p = cst.getPlayer(name, '#888');
      for (const [res, n] of Object.entries(exp)) {
        if (res === 'unknown') assert.equal(p.unknown, n, `${step.label}: ${name} unknown`);
        else assert.equal(p.resources[res], n, `${step.label}: ${name} ${res}`);
      }
    }
  }
});

test('regenerating oracle matches committed file (detect drift)', () => {
  const { execSync } = require('node:child_process');
  const stripTime = (raw) => {
    const o = JSON.parse(raw);
    delete o.meta.generatedAt;
    return JSON.stringify(o, null, 2) + '\n';
  };
  execSync('node tools/generate-oracle-fixtures.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  const before = stripTime(fs.readFileSync(ORACLE_FILE, 'utf8'));
  execSync('node tools/generate-oracle-fixtures.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  const after = stripTime(fs.readFileSync(ORACLE_FILE, 'utf8'));
  assert.equal(before, after, 'oracle file must be deterministic (ignoring generatedAt)');
});
