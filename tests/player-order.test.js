'use strict';

// Verifies the panel orders its player rows to match colonist's own player
// panel (read via the stable data-attributes) and shows each player's avatar.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

test('player rows follow colonist panel order and show each avatar', () => {
  cst.resetState();
  // Seed players in a DIFFERENT order than colonist's panel.
  cst.getPlayer('Zara', '#118811');
  cst.getPlayer('Abe', '#1133cc');
  cst.getPlayer('StanTheMan01', '#CF4449');

  // Fake colonist player panel, top → bottom: Abe, StanTheMan01, Zara.
  const row = (name) =>
    `<div data-player-color="1"><div class="username-AA">${name}</div>` +
    `<img class="avatarImage-BB" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div>`;
  const wrap = document.createElement('div');
  wrap.setAttribute('data-player-information-container', 'true');
  wrap.innerHTML = row('Abe') + row('StanTheMan01') + row('Zara');
  document.body.appendChild(wrap);

  cst.createPanel();
  cst.render();

  const txt = document.querySelector('#cst-resources').textContent;
  assert.ok(txt.indexOf('Abe') >= 0 && txt.indexOf('Abe') < txt.indexOf('StanTheMan01'), 'Abe before Stan');
  assert.ok(txt.indexOf('StanTheMan01') < txt.indexOf('Zara'), 'Stan before Zara');

  // Each player row renders its avatar image.
  assert.equal(document.querySelectorAll('#cst-resources img[src*="icon_bot"]').length, 3);
});
