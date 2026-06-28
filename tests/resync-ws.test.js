'use strict';

// Resync (the 🔄 button → deepRescrape) used to resetState() and re-scrape the
// virtualised chat log. That loses opponents' early history (colonist only mounts
// on-screen rows) and pads the shortfall as "unknown". When the WebSocket board
// is ready there is NO gap to recover — the board holds a complete live snapshot.
// deepRescrape() should then reconcile from WS (self exact, every total correct)
// and KEEP opponents' continuously-inferred breakdown instead of wiping it.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst } = require('./helpers/setup');
const window = global.window;
const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const totalOf = (p) => p.unknown + RES.reduce((s, r) => s + p.resources[r], 0);

function relayFullState() {
  const payload = {
    gameState: {
      playerColor: 1,
      mapState: {},
      playerStates: {
        1: { resourceCards: { cards: [1, 1, 4] } },       // self: 2 lumber + 1 grain
        2: { resourceCards: { cards: [0, 0, 0, 0, 0] } },  // opponent: 5 hidden
      },
    },
    playerUserStates: [
      { selectedColor: 1, username: 'StanTheMan01' },
      { selectedColor: 2, username: 'Sancho' },
    ],
  };
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { __cstWS: 'state', msg: { id: '130', data: { type: 4, payload } } },
  }));
}

test('Resync with a ready WS board keeps opponent breakdown and pulls self from WS', async () => {
  cst.resetState();
  const me = cst.getPlayer('StanTheMan01', '#CF4449');
  const opp = cst.getPlayer('Sancho', '#285FBD');
  // self carries a stale value a log re-scrape can't fix in jsdom (no hand strip)
  me.resources.lumber = 9;
  // opponent has a fully-inferred breakdown summing to 5 — it must survive resync
  opp.resources.brick = 3;
  opp.resources.wool = 2;

  relayFullState();              // board becomes ready: self exact, opp total = 5

  await cst.deepRescrape();

  assert.equal(me.resources.lumber, 2, 'self lumber re-read from WS');
  assert.equal(me.resources.grain, 1, 'self grain from WS');
  assert.equal(me.unknown, 0, 'self has no phantom unknown after resync');
  assert.equal(opp.resources.brick, 3, 'opponent inferred breakdown not wiped');
  assert.equal(opp.resources.wool, 2, 'opponent inferred breakdown not wiped');
  assert.equal(totalOf(opp), 5, 'opponent total still matches the WS count');
});
