'use strict';

// The local player is identified from colonist's player panel: every row has a
// `playerRow…` class, but only opponents also carry `opponentPlayerRow…`, so the
// row without it is YOU. This replaces the avatar guess that mis-tagged an
// opponent as "self" in multi-human games (causing "stole from self" paths).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, feed, document } = require('./helpers/setup');

const panelHTML = (rows) => rows.map(([cls, name, color]) =>
  `<div data-player-color="${color}" class="${cls}"><span class="username-z">${name}</span></div>`).join('');

// "00skiVancity stole [Wool] from you" — victim-side steal with the card revealed.
const STOLE_FROM_YOU =
  '<div class="feedMessage-O8TLknGe"><div class="container-k avatar-y">' +
  '<img class="avatarImage-J" src="https://cdn.colonist.io/dist/assets/icon_bot.x.svg"></div>' +
  '<span class="messagePart-XeUsOgLX"><span style="font-weight:600;color:#CF6B2E">00skiVancity</span> ' +
  'stole <img src="https://cdn.colonist.io/dist/assets/card_wool.17a6dea8d559949f0ccc.svg" alt="Wool" ' +
  'height="20" width="14.25" class="lobbyChatTextIcon"> from you</span></div>';

test('selfFromPanel picks the row WITHOUT opponentPlayerRow', () => {
  document.body.innerHTML = panelHTML([
    ['opponentPlayerRow-AYN playerRow-RMh', 'Shakti23001', '4'],
    ['opponentPlayerRow-AYN playerRow-RMh', 'Duster22001', '3'],
    ['playerRow-RMh', 'StanTheMan01', '1'], // ← me
  ]);
  assert.equal(cst.selfFromPanel(), 'StanTheMan01');
  document.body.innerHTML = '';
});

test('the panel anchor wins over the message author when setting selfName', () => {
  cst.resetState();
  document.body.innerHTML = panelHTML([
    ['opponentPlayerRow-AYN playerRow-RMh', 'Tearle', '2'],
    ['playerRow-RMh', 'StanTheMan01', '1'],
  ]);
  feed(require('./fixtures/game-log').fixtures.got_bot_brick); // authored by Tearle
  assert.equal(cst.state.selfName, 'StanTheMan01', 'self comes from the panel, not the message');
  document.body.innerHTML = '';
});

test('"X stole from you" credits the loss to panel-self — no self-referential path', () => {
  cst.resetState();
  document.body.innerHTML = panelHTML([
    ['opponentPlayerRow-AYN playerRow-RMh', '00skiVancity', '2'],
    ['playerRow-RMh', 'StanTheMan01', '1'], // me
  ]);
  feed(STOLE_FROM_YOU);

  assert.equal(cst.state.selfName, 'StanTheMan01');
  const me = cst.state.tally.StanTheMan01 || {};
  const thief = cst.state.tally['00skiVancity'] || {};
  assert.equal(me.lost, 1, 'I lost 1 card');
  assert.equal((me.lostTo || {})['00skiVancity'], 1, 'lost to the thief');
  assert.ok(!(me.stoleFrom || {}).StanTheMan01, 'no "from self" entry');
  assert.equal((thief.stoleFrom || {}).StanTheMan01, 1, 'thief stole from me');
  document.body.innerHTML = '';
});
