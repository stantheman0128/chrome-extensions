'use strict';

// The Setup-pip badge renders next to a player's name, sourced from the WS board
// geometry (pipsOf). Total only shows for a colour with buildings on the board.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

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
