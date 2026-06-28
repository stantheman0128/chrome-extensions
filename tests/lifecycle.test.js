'use strict';

// Game lifecycle state machine (LOBBY / PLAYING / ENDED): the auto
// collapse-expand driver, the game clock, and the winner-line detection.
// This file gets its own process (node --test runs each file separately),
// so the lifecycle module state evolving across tests here is deliberate —
// the tests run top-to-bottom as one boot-to-rematch story.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, makeMessage, document } = require('./helpers/setup');

// Mount a colonist player panel (the in-game DOM signal for inGameNow()).
function mountGame(names) {
  document.body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.innerHTML = names
    .map((n) => `<div data-player-color="1"><div class="username-x">${n}</div></div>`)
    .join('');
  document.body.appendChild(wrap);
}

function unmountGame() {
  document.body.innerHTML = '';
}

const WINNER_MSG = '<div class="feedMessage-x"><span class="messagePart-x">' +
  'Bradly won the game!</span></div>';

test('boot in the lobby adopts LOBBY without a game clock', () => {
  cst.resetState();
  cst.state.gameStartTs = null;          // resetState stamps "now"; boot has none
  unmountGame();
  cst.evalLifecycle();                   // first evaluation = boot adoption
  assert.equal(cst.getLifecycle(), cst.LIFE.LOBBY);
  assert.equal(cst.timerText(), '');     // no game, no clock
});

test('entering a game flips LOBBY → PLAYING and starts the clock', () => {
  mountGame(['Aria', 'Bradly']);
  cst.evalLifecycle();
  assert.equal(cst.getLifecycle(), cst.LIFE.PLAYING);
  assert.ok(cst.state.gameStartTs > 0, 'clock should start on game entry');
  assert.match(cst.timerText(), /^\d+:\d{2}$/);   // m:ss while under an hour
});

test('the winner line freezes the clock and flips PLAYING → ENDED', () => {
  cst.processMessage(makeMessage(WINNER_MSG));
  assert.equal(cst.getLifecycle(), cst.LIFE.ENDED);
  assert.ok(cst.state.gameEndTs >= cst.state.gameStartTs, 'end stamp recorded');
  const frozen = cst.timerText();
  assert.equal(cst.timerText(), frozen, 'ended clock must not tick');
  // The winner line is pure lifecycle — it must not invent a "Bradly" player row.
  assert.ok(!cst.state.players.has('Bradly'));
});

test('a second winner line is idempotent', () => {
  const end = cst.state.gameEndTs;
  cst.processMessage(makeMessage(WINNER_MSG));
  assert.equal(cst.state.gameEndTs, end, 'gameEndTs must not move');
});

test('startNextGame wipes stats and restarts the clock', () => {
  const p = cst.getPlayer('Aria', '#c00');
  cst.giveResource(p, 'grain', 3);
  const prevStart = cst.state.gameStartTs;
  cst.startNextGame();
  assert.equal(cst.getLifecycle(), cst.LIFE.PLAYING);
  assert.equal(cst.state.players.size, 0, 'stats cleared for the new game');
  assert.equal(cst.state.gameEndTs, null, 'clock unfrozen');
  assert.ok(cst.state.gameStartTs >= prevStart, 'clock restarted');
});

test('leaving the game needs two settled ticks before LOBBY', () => {
  unmountGame();
  cst.evalLifecycle();                   // one flicker tick — still PLAYING
  assert.equal(cst.getLifecycle(), cst.LIFE.PLAYING);
  cst.evalLifecycle();                   // settled → LOBBY
  assert.equal(cst.getLifecycle(), cst.LIFE.LOBBY);
});

test('the game clock survives a persist/restore round-trip', () => {
  cst.resetState();
  const start = cst.state.gameStartTs;   // resetState stamped "now"
  cst.getPlayer('Aria', '#c00');
  cst.persistState();
  cst.resetState();                      // "page reload" wipes memory
  cst.state.gameStartTs = null;
  cst.restoreState();
  assert.equal(cst.state.gameStartTs, start, 'clock continues across reloads');
});

test('timerText formats hours as h:mm:ss', () => {
  cst.state.gameStartTs = 1_000_000;
  cst.state.gameEndTs = 1_000_000 + (1 * 3600 + 2 * 60 + 34) * 1000;
  assert.equal(cst.timerText(), '1:02:34');
  cst.state.gameEndTs = 1_000_000 + 5 * 60 * 1000 + 7000;
  assert.equal(cst.timerText(), '5:07');
});
