'use strict';

// The Setup-pip badge renders next to a player's name, sourced from the WS board
// geometry (pipsOf). Total only shows for a colour with buildings on the board.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, document } = require('./helpers/setup');
const window = global.window;

function relayBoardWithSettlement() {
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1,
        mapState: {
          tileHexStates: {
            7:  { x: 1, y: 1, type: 2, diceNumber: 2 },    // brick 2 (robbed)
            15: { x: 0, y: 1, type: 4, diceNumber: 9 },    // grain 9 → 4
            16: { x: 1, y: 0, type: 3, diceNumber: 10 },   // wool 10 → 3
          },
          tileCornerStates: { 23: { x: 1, y: 0, z: 1, owner: 1, buildingType: 1 } },
        },
        mechanicRobberState: { locationTileIndex: 7 },
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
    } } } },
  }));
}

test('pips show for ALL players by default (no click); the name toggle still filters', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('StanTheMan01', '#CF4449');
  relayBoardWithSettlement();
  cst.render();
  // Default (empty selection) now shows everyone's pips — no clicking required.
  assert.match(document.querySelector('#cst-resources').innerHTML, /⚅7/, 'default: pip badge shows without selecting (grain 4 + wool 3, brick robbed)');
  // Clicking a name still records the explicit selection (the filter path).
  cst.selectPipPlayer('StanTheMan01');
  assert.deepEqual(cst.getUiState().pipPlayers, ['StanTheMan01'], 'the name toggles into the explicit selection');
  assert.match(document.querySelector('#cst-resources').innerHTML, /⚅7/, 'the selected player still shows pips');
});

test('the bank badge reads colonist actual supply (5-6p deck=24), not the hardcoded-19 upper bound', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('StanTheMan01', '#CF4449');
  // relay a full state whose supply is a 24-card (5-6 player) deck, nobody holding cards:
  // the 19-minus-held fallback would show 19, the real supply is 24.
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1,
        bankState: { resourceCards: { 1: 24, 2: 24, 3: 24, 4: 24, 5: 24 } },
        mapState: { tileHexStates: {}, tileCornerStates: {} },
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
    } } } },
  }));
  cst.render();
  const html = document.querySelector('#cst-resources').innerHTML;
  assert.match(html, /Bank: 24 /, 'the badge tooltip reads the WS supply (24), not the 19-derived fallback');
  assert.doesNotMatch(html, /Bank: 19 /, 'no longer shows the hardcoded-19 upper bound when the real deck is 24');
});

test('per-resource pip corners show by default for all players (item C-c)', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('StanTheMan01', '#CF4449');
  relayBoardWithSettlement();   // self: grain pip 4, wool pip 3, brick robbed → none
  cst.render();
  // Default (no selection): the corners are shown for everyone.
  const corners = [...document.querySelectorAll('[data-pip]')].map((el) => el.getAttribute('data-pip')).sort();
  assert.deepEqual(corners, ['3', '4'], 'grain 4 and wool 3 corners shown by default; no brick corner (robbed)');
});
