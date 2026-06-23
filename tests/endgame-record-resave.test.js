'use strict';

// Codex pass-10 P1: the Victory record is written at the winner line, but a final DOM
// gain/discard can land just before the last WS frame finishes decoding + relaying — so
// the saved snapshot can be stale (and buildGameRecord can even overwrite a correct DOM
// discard with a not-yet-arrived WS 0). The ENDED tick re-syncs live state each second;
// resaveEndgameRecord mirrors those corrected values back into the stored record so
// history converges too — not just blockLoss.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

const HISTORY_KEY = 'cst-history';

function mockStorage() {
  const store = { [HISTORY_KEY]: [] };
  global.chrome = {
    storage: { local: {
      get(keys, cb) { cb({ [HISTORY_KEY]: store[HISTORY_KEY] }); },
      set(obj) { Object.assign(store, obj); },
    } },
  };
  return store;
}

test('resaveEndgameRecord patches the saved record to the corrected live hands + tally', () => {
  const store = mockStorage();
  cst.resetState();
  cst.state.gameStartTs = 111;
  // a snapshot taken at the winner line, before the final WS frame relayed
  cst.saveGameRecord({
    date: 111, winner: 'Me',
    players: [{ name: 'Me', color: '#c00', hand: { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 }, unknown: 0 }],
    tally: { Me: { gained: 1, discards: 0 } }, blocked: {}, blockEvents: [], blockLoss: { Me: 0 },
  });
  assert.equal(store[HISTORY_KEY][0].players[0].hand.lumber, 1, 'starts stale');

  // the late WS frame lands → live state is now authoritative
  cst.getPlayer('Me', '#c00').resources.lumber = 3;
  cst.state.tally.Me = { gained: 3, discards: 2 };

  cst.resaveEndgameRecord();
  const rec = store[HISTORY_KEY][0];
  assert.equal(rec.players[0].hand.lumber, 3, 'record now carries the corrected hand');
  assert.equal(rec.tally.Me.gained, 3, 'and the corrected gained tally');
  assert.equal(rec.tally.Me.discards, 2, 'and the corrected discard tally (no stale 0)');

  delete global.chrome;
});

test('resaveEndgameRecord only touches THIS game, matched by start date', () => {
  const store = mockStorage();
  store[HISTORY_KEY] = [{ date: 999, players: [{ name: 'Old', color: '#000', hand: { lumber: 7 }, unknown: 0 }], tally: {} }];
  cst.resetState();
  cst.state.gameStartTs = 111;                 // no stored record has date 111
  cst.getPlayer('Me', '#c00').resources.lumber = 3;
  cst.resaveEndgameRecord();
  assert.equal(store[HISTORY_KEY][0].players[0].hand.lumber, 7, 'a different game record is left untouched');
  delete global.chrome;
});
