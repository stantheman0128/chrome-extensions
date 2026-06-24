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
const window = global.window;

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

function relaySelf(id, cards) {
  window.dispatchEvent(new window.MessageEvent('message', { data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
    gameSettings: { id },
    gameState: { playerColor: 1, mapState: { tileHexStates: {}, tileCornerStates: {} }, playerStates: { 1: { resourceCards: { cards } } } },
    playerUserStates: [{ selectedColor: 1, username: 'Me' }],
  } } } } }));
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

test('real flow: a late WS frame after the winner line flags + patches the saved record', () => {
  const store = mockStorage();
  cst.resetState();
  cst.createPanel();
  cst.startNextGame();                            // a clean PLAYING lifecycle so onGameWon runs (not an ENDED re-entry)
  cst.getPlayer('Me', '#c00');
  cst.state.gameStartTs = 50000;                  // so the record's date matches for the re-save lookup
  relaySelf('g1', [1]);                            // board ready; the immediate handler syncs self → 1 lumber
  assert.equal(cst.getPlayer('Me', '#c00').resources.lumber, 1);

  // winner line: the record is snapshotted here (hand lumber=1) and saved
  cst.onGameWon('Me');
  assert.equal(cst.getLifecycle(), cst.LIFE.ENDED, 'the game is now ENDED');
  cst.resaveEndgameRecord();                       // the first ENDED tick clears the initial dirty flag
  assert.equal(cst.getEndgameRecordDirty(), false);
  let rec = store[HISTORY_KEY].find((g) => g.date === 50000);
  assert.equal(rec.players.find((p) => p.name === 'Me').hand.lumber, 1, 'archived at the winner-line value');

  // a LATE WS frame lands AFTER the winner line — self actually held 3 cards (2 lumber, 1 brick)
  relaySelf('g1', [1, 1, 2]);
  assert.equal(cst.getPlayer('Me', '#c00').resources.lumber, 2, 'the immediate handler corrected live state…');
  assert.equal(cst.getEndgameRecordDirty(), true, '…and flagged the record for re-save (the wiring fix)');

  // the next ENDED tick re-saves the now-behind record
  cst.resaveEndgameRecord();
  rec = store[HISTORY_KEY].find((g) => g.date === 50000);
  assert.equal(rec.players.find((p) => p.name === 'Me').hand.lumber, 2, 'history converged to the corrected hand');
  assert.equal(rec.players.find((p) => p.name === 'Me').hand.brick, 1);
  assert.equal(cst.getEndgameRecordDirty(), false, 'and the flag clears once it patched');

  delete global.chrome;
});

test('resaveEndgameRecord stays dirty (retries) when the initial save has not landed yet', () => {
  const store = mockStorage();
  store[HISTORY_KEY] = [];                          // the async saveGameRecord hasn't written yet
  cst.resetState();
  cst.createPanel();
  cst.startNextGame();
  cst.getPlayer('Me', '#c00');
  cst.state.gameStartTs = 60000;
  relaySelf('g2', [1]);
  cst.onGameWon('Me');
  store[HISTORY_KEY] = [];                          // simulate the record not yet visible to a racing resave
  cst.resaveEndgameRecord();
  assert.equal(cst.getEndgameRecordDirty(), true, 'no record found → stays dirty so a later tick retries');
  delete global.chrome;
});

test('a new game (different gameId) never patches the previous game record', () => {
  const store = mockStorage();
  cst.resetState();
  cst.createPanel();
  cst.startNextGame();
  cst.getPlayer('Me', '#c00');
  cst.state.gameStartTs = 70000;
  relaySelf('g1', [1, 1]);                          // game g1: self holds 2 lumber
  cst.onGameWon('Me');
  cst.resaveEndgameRecord();
  let rec = store[HISTORY_KEY].find((g) => g.date === 70000);
  assert.equal(rec.players.find((p) => p.name === 'Me').hand.lumber, 2, 'g1 archived at 2 lumber');
  assert.equal(rec.gameId, 'g1', 'and tagged with its gameId');

  // a NEW game arrives over the WS BEFORE the DOM lifecycle resets — same player name, an
  // empty hand. Live state flips to the new game, but the OLD record must NOT be patched.
  relaySelf('g2', []);
  assert.equal(cst.getEndgameRecordDirty(), false, 'a different-gameId frame stops flagging the ended record');
  cst.resaveEndgameRecord();                         // a racing re-save before the DOM reset
  rec = store[HISTORY_KEY].find((g) => g.date === 70000);
  assert.equal(rec.players.find((p) => p.name === 'Me').hand.lumber, 2, 'the previous game record is left intact');
});

test('F5: the record.gameId guard rejects a cross-game patch even when the module anchor is lost', () => {
  // After a reload mid-Victory, endgameRecordGameId is null (onGameWon early-returns on
  // ENDED, so it isn't re-captured), but the stored record still carries its gameId — that
  // anchor, not the module variable, is what protects the record.
  const store = mockStorage();
  cst.resetState();                                 // endgameRecordGameId → null, as after a reload
  cst.createPanel();
  cst.getPlayer('Me', '#c00');
  cst.state.gameStartTs = 90000;
  cst.saveGameRecord({ date: 90000, gameId: 'g1', winner: 'Me',
    players: [{ name: 'Me', color: '#c00', hand: { lumber: 2, brick: 0, wool: 0, grain: 0, ore: 0 }, unknown: 0 }],
    tally: {}, blocked: {}, blockEvents: [], blockLoss: {} });
  relaySelf('g2', []);                              // the board is now a DIFFERENT game; live self empty
  cst.resaveEndgameRecord();                        // module anchor is null, but record.gameId === 'g1'
  const rec = store[HISTORY_KEY].find((g) => g.date === 90000);
  assert.equal(rec.players.find((p) => p.name === 'Me').hand.lumber, 2, 'cross-game patch rejected by record.gameId');
  assert.equal(cst.getEndgameRecordDirty(), false, 'and the dirty flag is cleared');
  delete global.chrome;
});

test('a same-game ENDED frame re-flags the record even when the UI sync sees no change', () => {
  mockStorage();
  cst.resetState();
  cst.createPanel();
  cst.startNextGame();
  cst.getPlayer('Me', '#c00');
  cst.state.gameStartTs = 80000;
  relaySelf('g3', [1]);
  cst.onGameWon('Me');
  cst.resaveEndgameRecord();
  assert.equal(cst.getEndgameRecordDirty(), false, 'clean after the first re-save');
  // an identical same-game frame: hands/dice unchanged (ch=false). A late *blocked* roll
  // would move board.blockedLoss with the same ch=false, so frame arrival alone must re-flag.
  relaySelf('g3', [1]);
  assert.equal(cst.getEndgameRecordDirty(), true, 'frame arrival for the ended game re-flags it (covers blocked-only)');
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
