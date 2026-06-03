'use strict';

// Reconciling our tracked counts against colonist's authoritative player panel.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const reset = () => cst.resetState();
const seed = (name, color, bag) => {
  const p = cst.getPlayer(name, color);
  for (const [r, n] of Object.entries(bag)) cst.giveResource(p, r, n);
  return p;
};
const total = (p) => p.unknown + RES.reduce((s, r) => s + p.resources[r], 0);

test('reconcileTotal: a shortfall becomes unknown cards', () => {
  reset();
  const p = seed('A', '#111', { grain: 2 }); // total 2
  assert.equal(cst.reconcileTotal(p, 5), true);
  assert.equal(p.unknown, 3);
  assert.equal(total(p), 5);
});

test('reconcileTotal: excess is removed from unknown, then the largest pile', () => {
  reset();
  const p = seed('A', '#111', { grain: 4, ore: 1 }); // known 5
  p.unknown = 2; // total 7
  cst.reconcileTotal(p, 3); // must drop 4
  assert.equal(p.unknown, 0); // -2 unknown first
  assert.equal(p.resources.grain, 2); // then -2 from the biggest pile (grain)
  assert.equal(p.resources.ore, 1);
  assert.equal(total(p), 3);
});

test('reconcileTotal: no-op when already equal', () => {
  reset();
  const p = seed('A', '#111', { grain: 3 });
  assert.equal(cst.reconcileTotal(p, 3), false);
});

test('syncFromPanel: each player is reconciled to the panel hand total', () => {
  reset();
  seed('Gile', '#285FBD', { brick: 1 }); // ours: 1
  seed('Yelich', '#118811', { ore: 5 }); // ours: 5

  // Fake colonist player panel: Gile holds 4 resource cards, Yelich holds 3.
  const mk = (name, count) =>
    `<div data-player-color="1"><div class="username-x">${name}</div>` +
    `<div data-resource-card="true"><div class="cardContainer-x">` +
    `<img class="cardImage-x" src="x"><div class="countBadge-x"><div class="count-x">${count}</div></div>` +
    `</div></div></div>`;
  const wrap = document.createElement('div');
  wrap.setAttribute('data-player-information-container', 'true');
  wrap.innerHTML = mk('Gile', 4) + mk('Yelich', 3);
  document.body.appendChild(wrap);

  assert.equal(cst.syncFromPanel(), true);
  assert.equal(total(cst.state.players.get('Gile')), 4); // 1 → 4 (+3 unknown)
  assert.equal(total(cst.state.players.get('Yelich')), 3); // 5 → 3 (-2 from ore)
});
