'use strict';

// Self's hand is fully visible — read it as ground truth.
//
// Opponents' breakdowns are hidden (colonist only makes their TOTAL public), so
// the log-only path can mis-attribute a missed `got` and pad it as "unknown".
// But colonist renders YOUR OWN hand as real <img src=card_*> tiles at the
// bottom-left, each with a quantity badge. readSelfHand() reads those tiles so
// we can pin self's per-resource counts exactly and drop the phantom unknowns.
//
// jsdom gives every element a zero-size rect, so the hand tiles here stub
// getBoundingClientRect() to sit in the bottom-left "hand strip" window.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, document } = require('./helpers/setup');

const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const totalOf = (p) => p.unknown + RES.reduce((s, r) => s + p.resources[r], 0);

// One card tile per resource you hold: an <img src=card_<res>> with a quantity
// badge beside it, sized/positioned like colonist's bottom-left hand strip.
function handTile(res, n) {
  const card = document.createElement('div');
  const img = document.createElement('img');
  img.setAttribute('src', `https://cdn.colonist.io/dist/assets/card_${res}.deadbeef99.svg`);
  img.getBoundingClientRect = () => ({
    top: 646, left: 230, right: 260, bottom: 676, width: 30, height: 30, x: 230, y: 646,
  });
  const badge = document.createElement('div');
  badge.textContent = String(n);
  card.appendChild(img);
  card.appendChild(badge);
  return card;
}

// counts: { lumber:11, wool:5, … } — omit a resource to mean you hold zero of it
// (colonist drops the tile entirely when a pile empties).
function mountHand(counts) {
  const strip = document.createElement('div');
  for (const [res, n] of Object.entries(counts)) strip.appendChild(handTile(res, n));
  document.body.appendChild(strip);
  return strip;
}

test('readSelfHand reads each resource pile from the visible hand strip', () => {
  cst.resetState();
  document.body.innerHTML = '';
  mountHand({ lumber: 11, brick: 1, wool: 5, grain: 3 }); // holds no ore
  assert.deepEqual(cst.readSelfHand(), { lumber: 11, brick: 1, wool: 5, grain: 3, ore: 0 });
});

test('readSelfHand returns null when no hand strip is on screen (caller falls back)', () => {
  cst.resetState();
  document.body.innerHTML = '';
  assert.equal(cst.readSelfHand(), null);
});

test('readSelfHand ignores the chat-log inline resource icons (wrong position/size)', () => {
  cst.resetState();
  document.body.innerHTML = '';
  // A resource icon sitting up in the log area, tiny — must NOT be read as hand.
  const img = document.createElement('img');
  img.setAttribute('src', 'https://cdn.colonist.io/dist/assets/card_lumber.x.svg');
  img.getBoundingClientRect = () => ({
    top: 180, left: 980, right: 996, bottom: 196, width: 16, height: 16, x: 980, y: 180,
  });
  document.body.appendChild(img);
  assert.equal(cst.readSelfHand(), null);
});

test('syncFromPanel: self breakdown comes from the visible hand (exact, no unknown); opponents still reconcile by total', () => {
  cst.resetState();
  document.body.innerHTML = '';
  cst.state.selfName = 'StanTheMan01';

  // Our log under-counted self: lumber 9 + wool 3, the shortfall padded as 4
  // unknown (total 16) — exactly the bug Stan reported.
  const me = cst.getPlayer('StanTheMan01', '#CF4449');
  cst.giveResource(me, 'lumber', 9);
  cst.giveResource(me, 'wool', 3);
  me.unknown = 4;

  // An opponent we only know by total (we over-count by 2).
  const opp = cst.getPlayer('Sisson', '#285FBD');
  cst.giveResource(opp, 'ore', 5);

  // colonist's bottom hand strip shows the TRUTH: lumber 11, wool 5 (= 16).
  mountHand({ lumber: 11, wool: 5 });

  // colonist's player panel: self total 16, opponent total 3.
  const mk = (name, count) =>
    `<div data-player-color="1"><div class="username-x">${name}</div>` +
    `<div data-resource-card="true"><div class="count-x">${count}</div></div></div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = mk('StanTheMan01', 16) + mk('Sisson', 3);
  document.body.appendChild(wrap);

  cst.syncFromPanel();

  const self = cst.state.players.get('StanTheMan01');
  assert.equal(self.resources.lumber, 11, 'lumber from the hand, not the log');
  assert.equal(self.resources.wool, 5, 'wool from the hand');
  assert.equal(self.resources.brick, 0, 'piles not in the hand read as zero');
  assert.equal(self.unknown, 0, 'no phantom unknown cards for self');
  assert.equal(totalOf(self), 16, 'self total still matches colonist');

  assert.equal(totalOf(cst.state.players.get('Sisson')), 3, 'opponent still trimmed to its panel total');
});
