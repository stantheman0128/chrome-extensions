'use strict';

// New-game detection. The local player is in EVERY game, so the old
// "no players in common" rule never fired. These lock the correct behaviour:
// reset when a tracked player is no longer on the live panel, or when the live
// roster settles on a different set.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

function panel(names) {
  document.body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.setAttribute('data-player-information-container', 'true');
  wrap.innerHTML = names
    .map((n) => `<div data-player-color="1"><div class="username-x">${n}</div></div>`)
    .join('');
  document.body.appendChild(wrap);
}

test('stale restored roster is dropped even though self overlaps', () => {
  cst.resetState();
  // a restored PREVIOUS game (self + three others)
  cst.getPlayer('StanTheMan01', '#c00');
  cst.getPlayer('Lipp', '#0c0');
  cst.getPlayer('Bird', '#00c');
  cst.getPlayer('Wilton', '#cc0');
  cst.giveResource(cst.state.players.get('Lipp'), 'grain', 3);
  // live panel = a DIFFERENT game; only StanTheMan01 is in common
  panel(['Easton', 'Lukin', 'Hertha', 'StanTheMan01']);
  cst.maybeNewGame();
  assert.equal(cst.state.players.size, 0, 'stale players should be cleared');
});

test('the same game roster is NOT reset', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#c00');
  cst.getPlayer('Easton', '#0c0'); // we've only seen 2 of 4 act so far
  panel(['Easton', 'Lukin', 'Hertha', 'StanTheMan01']);
  cst.maybeNewGame(); // tracked players are all present → keep
  assert.equal(cst.state.players.size, 2);
  cst.maybeNewGame(); // stable → still keep
  assert.equal(cst.state.players.size, 2);
});

test('mid-session new game resets once the new roster settles', () => {
  cst.resetState();
  cst.getPlayer('Easton', '#0c0');
  cst.getPlayer('StanTheMan01', '#c00');
  panel(['Easton', 'StanTheMan01']);
  cst.maybeNewGame(); // baseline
  assert.equal(cst.state.players.size, 2);

  panel(['Marco', 'Polo', 'StanTheMan01']); // a new game begins
  cst.maybeNewGame(); // first sighting — not settled yet, no reset
  assert.equal(cst.state.players.size, 2);
  cst.maybeNewGame(); // same roster two ticks running → reset
  assert.equal(cst.state.players.size, 0);
});
