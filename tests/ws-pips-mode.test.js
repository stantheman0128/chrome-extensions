'use strict';

// The ⚅ pip number has two modes, toggled by clicking it: unweighted coverage pips
// (an integer) and expected cards per roll (a small decimal, city ×2). Clicking the
// number switches the mode without deselecting the player.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, document } = require('./helpers/setup');
const window = global.window;

// corner 23 = (1,0,z1) touches tiles 16,15,7; robber on the brick tile (7).
// unweighted: grain 9 (4) + wool 10 (3) = 7. expected: (4+3)/36 = 7/36 ≈ 0.19.
function relayBoardWithSettlement() {
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload: {
      gameState: {
        playerColor: 1,
        mapState: {
          tileHexStates: {
            7:  { x: 1, y: 1, type: 2, diceNumber: 2 },
            15: { x: 0, y: 1, type: 4, diceNumber: 9 },
            16: { x: 1, y: 0, type: 3, diceNumber: 10 },
          },
          tileCornerStates: { 23: { x: 1, y: 0, z: 1, owner: 1, buildingType: 1 } },
        },
        mechanicRobberState: { locationTileIndex: 7 },
      },
      playerUserStates: [{ selectedColor: 1, username: 'StanTheMan01' }],
    } } } },
  }));
}

function setup() {
  cst.resetState();
  cst.getUiState().pipMode = 'unweighted';   // each test starts on coverage (uiState is a singleton)
  cst.createPanel();
  cst.getPlayer('StanTheMan01', '#CF4449');
  relayBoardWithSettlement();
  cst.selectPipPlayer('StanTheMan01');
  cst.render();
}

test('the ⚅ number toggles between coverage (integer) and expected cards/roll (decimal)', () => {
  setup();
  let html = document.querySelector('#colonist-stats-tracker').innerHTML;
  assert.equal(cst.getUiState().pipMode, 'unweighted', 'starts on coverage');
  assert.match(html, /⚅7/, 'coverage: grain 4 + wool 3 = 7');

  cst.togglePipMode();
  html = document.querySelector('#colonist-stats-tracker').innerHTML;
  assert.equal(cst.getUiState().pipMode, 'expected');
  assert.match(html, /⚅0\.\d/, 'expected mode shows a per-roll decimal (~0.19)');
  assert.doesNotMatch(html, /⚅7/, 'no longer the integer coverage value');
});

test('clicking the ⚅ number toggles the mode WITHOUT deselecting the player', () => {
  setup();
  const badge = document.querySelector('[data-pipmode]');
  assert.ok(badge, 'the ⚅ badge carries data-pipmode');
  badge.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(cst.getUiState().pipMode, 'expected', 'mode switched on click');
  assert.deepEqual(cst.getUiState().pipPlayers, ['StanTheMan01'], 'player stays selected');
});
