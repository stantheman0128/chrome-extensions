'use strict';

// Live stats tally (steals / discards / income / dev cards), the robber-blocked
// counter, and the "X stole [resource] from you" parse — including the
// regression where that message used to fall into the Monopoly branch and
// zero every OTHER player's pile.

const { test } = require('node:test');
const assert = require('node:assert/strict');

// node --test runs each file in its own process, so this in-memory stub
// (needed by the persist/restore round-trip test) doesn't leak elsewhere.

const { cst, feed } = require('./helpers/setup');

const CARD = (r) =>
  `<img src="https://cdn.colonist.io/dist/assets/card_${r}.abc123.svg" alt="${r}">`;
const NAME = (n, c = '#c00') => `<span style="color:${c}">${n}</span>`;
const MSG = (inner) =>
  `<div class="feedMessage-x"><span class="messagePart-x">${inner}</span></div>`;

test('"Itin stole Brick from you": thief gains, self loses, others untouched', () => {
  cst.resetState();
  cst.state.selfName = 'Me';
  const me = cst.getPlayer('Me', '#00c');
  const bystander = cst.getPlayer('Karl', '#0c0');
  cst.giveResource(me, 'brick', 2);
  cst.giveResource(bystander, 'brick', 3);

  feed(MSG(`${NAME('Itin')} stole ${CARD('brick')} from you`));

  assert.equal(cst.state.players.get('Itin').resources.brick, 1, 'thief +1');
  assert.equal(me.resources.brick, 1, 'victim −1');
  assert.equal(bystander.resources.brick, 3, 'REGRESSION: bystander must keep his bricks');
  assert.equal(cst.state.tally.Itin.stole, 1);
  assert.equal(cst.state.tally.Itin.stoleFrom.Me, 1);
  assert.equal(cst.state.tally.Me.lost, 1);
  assert.equal(cst.state.tally.Me.lostTo.Itin, 1);
});

test('"stole from you" WITHOUT a card img still moves one unknown card', () => {
  cst.resetState();
  cst.state.selfName = 'Me';
  const me = cst.getPlayer('Me', '#00c');
  cst.giveResource(me, 'ore', 2);

  feed(MSG(`${NAME('Itin')} stole from you`));   // no revealed card

  const itin = cst.state.players.get('Itin');
  assert.equal(itin.unknown, 1, 'thief gains one unknown card');
  assert.equal(me.resources.ore, 1, 'victim loses one card (best pile)');
  assert.equal(cst.state.tally.Itin.stoleFrom.Me, 1);
  assert.equal(cst.state.tally.Me.lostTo.Itin, 1);
});

test('knight steal "X stole from Y" updates the tally matrix', () => {
  cst.resetState();
  const victim = cst.getPlayer('Bob', '#0c0');
  cst.giveResource(victim, 'wool', 1);
  feed(MSG(`${NAME('Ann')} stole from ${NAME('Bob', '#0c0')}`));
  assert.equal(cst.state.tally.Ann.stole, 1);
  assert.equal(cst.state.tally.Bob.lostTo.Ann, 1);
});

test('robber-blocked message increments the global counter with tile key', () => {
  cst.resetState();
  feed(MSG(`<img src="https://cdn.colonist.io/dist/assets/prob_6.def.svg" alt="6"> brick tile is blocked by the Robber. No resources produced`));
  feed(MSG(`<img src="https://cdn.colonist.io/dist/assets/prob_6.def.svg" alt="6"> brick tile is blocked by the Robber. No resources produced`));
  feed(MSG(`<img src="https://cdn.colonist.io/dist/assets/prob_8.def.svg" alt="8"> grain tile is blocked by the Robber. No resources produced`));
  assert.equal(cst.state.blocked.count, 3);
  assert.equal(cst.state.blocked.byKey['6 brick'], 2);
  assert.equal(cst.state.blocked.byKey['8 grain'], 1);
  // a blocked line must not create phantom players
  assert.equal(cst.state.players.size, 0);
});

test('discards, gains and dev-card buys are tallied per player', () => {
  cst.resetState();
  feed(
    MSG(`${NAME('Ann')} got ${CARD('grain')}${CARD('grain')}`),
    MSG(`${NAME('Ann')} discarded ${CARD('grain')}${CARD('grain')}`),
    MSG(`${NAME('Ann')} bought ${CARD('wool')}${CARD('grain')}${CARD('ore')}`)
  );
  const t = cst.state.tally.Ann;
  assert.equal(t.gained, 2);
  assert.equal(t.discards, 1);
  assert.equal(t.discardCards, 2);
  assert.equal(t.devCards, 1);
});

test('tally and blocked counters survive a persist/restore round-trip', () => {
  cst.resetState();
  cst.getPlayer('Ann', '#c00');
  cst.state.tally.Ann = {
    stole: 2, lost: 1, stoleFrom: { Bob: 2 }, lostTo: { Bob: 1 },
    discards: 1, discardCards: 3, gained: 9, devCards: 2,
  };
  cst.state.blocked = { count: 2, byKey: { '6 brick': 2 } };
  cst.persistState();
  cst.resetState();
  cst.restoreState();
  assert.equal(cst.state.tally.Ann.stoleFrom.Bob, 2);
  assert.equal(cst.state.blocked.byKey['6 brick'], 2);
});
