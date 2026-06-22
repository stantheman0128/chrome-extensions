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

test('pips are hidden until a player name is clicked, then the badge shows', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('StanTheMan01', '#CF4449');
  relayBoardWithSettlement();
  cst.render();
  assert.doesNotMatch(document.querySelector('#colonist-stats-tracker').innerHTML, /⚅/, 'no pip badge before selecting');
  cst.selectPipPlayer('StanTheMan01');
  const html = document.querySelector('#colonist-stats-tracker').innerHTML;
  assert.match(html, /⚅7/, 'after selecting: pip badge = grain 4 + wool 3 (brick robbed → excluded)');
});

test('the selected player\'s cells carry per-resource pip corners (item C-c)', () => {
  cst.resetState();
  cst.createPanel();
  cst.getPlayer('StanTheMan01', '#CF4449');
  relayBoardWithSettlement();   // self: grain pip 4, wool pip 3, brick robbed → none
  cst.render();
  assert.equal(document.querySelectorAll('[data-pip]').length, 0, 'no corners before selecting');
  cst.selectPipPlayer('StanTheMan01');
  const corners = [...document.querySelectorAll('[data-pip]')].map((el) => el.getAttribute('data-pip')).sort();
  assert.deepEqual(corners, ['3', '4'], 'grain 4 and wool 3 corners; no brick corner (robbed)');
});
