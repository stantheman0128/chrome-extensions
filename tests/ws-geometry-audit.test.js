'use strict';

// Live geometry self-audit. colonist broadcasts the real production each roll
// (gameLog type 47), which is the ground truth. Our geometry independently
// PREDICTS who should produce what on a roll (every building on a numbered tile
// that isn't robbed). Comparing the two every roll proves our corner→tile geometry
// is correct on THIS board — and since blocked-loss uses the SAME geometry on the
// robbed tile (where the server is silent), a clean audit on the un-robbed tiles
// is the evidence that the blocked-loss is trustworthy too. Conflicts are recorded,
// not acted on (collect data first, per Stan).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// tile 7 = (1,1), number 8, ore (type 5). corner 23 = (1,0,z1) touches (1,1)=tile 7.
function fullState(gameId) {
  return { type: 4, payload: {
    gameSettings: { id: gameId },
    gameState: {
      playerColor: 1,
      mapState: {
        tileHexStates: { 7: { x: 1, y: 1, type: 5, diceNumber: 8 } },
        tileCornerStates: { 23: { x: 1, y: 0, z: 1, owner: 1, buildingType: 1 } },
      },
      // no robber → tile 7 produces; tests move it explicitly when needed
      gameLogState: {},
    },
    playerUserStates: [{ selectedColor: 1, username: 'Stan' }],
  } };
}

let idx = 100;
function roll(b, sum) {
  B.applyDiff(b, { gameLogState: { [++idx]: { text: { type: 10, firstDice: 1, secondDice: sum - 1 } } } });
}
function produce(b, color, cards) {   // roll-yield production carries distributionType 1
  B.applyDiff(b, { gameLogState: { [++idx]: { text: { type: 47, playerColor: color, cardsToBroadcast: cards, distributionType: 1 } } } });
}
function produceSetup(b, color, cards) {   // initial-placement production: distributionType 0
  B.applyDiff(b, { gameLogState: { [++idx]: { text: { type: 47, playerColor: color, cardsToBroadcast: cards, distributionType: 0 } } } });
}
function moveRobber(b, tile) { B.applyDiff(b, { mechanicRobberState: { locationTileIndex: tile } }); }
function fresh(id) { const b = B.createBoard(); B.applyFullState(b, fullState(id).payload); return b; }

test('a roll whose production matches the geometry prediction is confirmed', () => {
  const b = fresh('a');
  roll(b, 8);              // geometry predicts colour 1 gets 1 ore
  produce(b, 1, [5]);      // server: colour 1 got 1 ore
  roll(b, 6);              // next roll settles the previous one
  const a = B.auditOf(b);
  assert.equal(a.confirms, 1);
  assert.equal(a.conflicts, 0);
});

test('a roll whose production disagrees with the geometry is a conflict', () => {
  const b = fresh('b');
  roll(b, 8);
  produce(b, 1, [5, 5]);   // server says 2 ore, geometry predicted 1 → geometry is wrong here
  roll(b, 6);
  const a = B.auditOf(b);
  assert.equal(a.confirms, 0);
  assert.equal(a.conflicts, 1);
  assert.equal(a.trail.length, 1);
  assert.equal(a.trail[0].ok, false);
  assert.equal(a.trail[0].roll, 8);
});

test('a blocked roll (nothing predicted, nothing produced) is skipped, not a confirm', () => {
  const b = fresh('c');
  moveRobber(b, 7);        // robber on the ore tile
  roll(b, 8);              // server produces nothing (blocked); geometry predicts nothing too
  roll(b, 6);              // settle
  const a = B.auditOf(b);
  assert.equal(a.confirms, 0, 'empty vs empty is no geometric evidence');
  assert.equal(a.skipped, 1);
  assert.equal(a.conflicts, 0);
  assert.equal(B.blockedLossOf(b, 1), 1, 'and the block was still counted as a loss');
});

test('a 7 (no production tile) is safe — skipped, never a conflict', () => {
  const b = fresh('d');
  roll(b, 7);
  roll(b, 8);              // settle the 7
  const a = B.auditOf(b);
  assert.equal(a.conflicts, 0);
  assert.equal(a.skipped, 1);
});

test('a setup-placement type-47 (distributionType 0) during an open roll is ignored', () => {
  const b = fresh('dt');
  roll(b, 6);               // geometry predicts nothing on 6 (no 6-tile) → would be skipped...
  produceSetup(b, 1, [5]);  // ...but a stray distributionType-0 ore must NOT pollute the actual
  roll(b, 8);               // settle the 6: pred {} vs actual {} (the setup 47 was filtered)
  const a = B.auditOf(b);
  assert.equal(a.conflicts, 0, 'the setup production is not counted as a roll yield');
  assert.equal(a.skipped, 1);
});

test('with no loaded geometry the audit stays silent (no false conflict) — Codex pass-5', () => {
  // The board started from diffs (or an empty type-4 shell): tiles/corners are empty,
  // so predictProduction would return {} for every roll while the server still
  // produces. Without a geometry gate this settles as a conflict on the next roll.
  const b = B.createBoard();   // never given a full state
  B.applyDiff(b, { gameLogState: { 200: { text: { type: 10, firstDice: 4, secondDice: 4 } } } });
  B.applyDiff(b, { gameLogState: { 201: { text: { type: 47, playerColor: 1, cardsToBroadcast: [5], distributionType: 1 } } } });
  B.applyDiff(b, { gameLogState: { 202: { text: { type: 10, firstDice: 3, secondDice: 3 } } } }); // settle the first roll
  const a = B.auditOf(b);
  assert.equal(a.conflicts, 0, 'no geometry → no audit → no false conflict');
  assert.equal(a.confirms, 0);
});

test('an empty type-4 shell does not let the audit run either', () => {
  const b = B.createBoard();
  // a type-4 with empty maps: ready=true but geomReady=false
  B.applyFullState(b, { gameSettings: { id: 'shell' }, gameState: { playerColor: 1, mapState: { tileHexStates: {}, tileCornerStates: {} }, gameLogState: {} }, playerUserStates: [] });
  B.applyDiff(b, { gameLogState: { 210: { text: { type: 10, firstDice: 4, secondDice: 4 } } } });
  B.applyDiff(b, { gameLogState: { 211: { text: { type: 47, playerColor: 1, cardsToBroadcast: [5], distributionType: 1 } } } });
  B.applyDiff(b, { gameLogState: { 212: { text: { type: 10, firstDice: 3, secondDice: 3 } } } });
  const a = B.auditOf(b);
  assert.equal(a.conflicts, 0, 'an empty shell is not usable geometry');
});

test('a same-id reconnect mid-roll drops the in-flight prediction (no false conflict)', () => {
  const b = fresh('rc');
  roll(b, 8);                                  // predicts colour 1 gets 1 ore; expect is open
  B.applyFullState(b, fullState('rc').payload); // SAME id reconnect arrives before the type-47
  roll(b, 6);                                   // would have settled 8 against empty actual → conflict
  const a = B.auditOf(b);
  assert.equal(a.conflicts, 0, 'the interrupted round is dropped, not settled as a conflict');
});

test('production split into a later diff than the roll still reconciles', () => {
  const b = fresh('e');
  roll(b, 8);
  // (some unrelated diff with no production could arrive here)
  B.applyDiff(b, {});
  produce(b, 1, [5]);      // arrives after the roll, in its own diff
  roll(b, 6);
  const a = B.auditOf(b);
  assert.equal(a.confirms, 1);
  assert.equal(a.conflicts, 0);
});

test('the final roll is settled on demand (no following roll to trigger it)', () => {
  const b = fresh('f');
  roll(b, 8);
  produce(b, 1, [5]);
  // game ends, no next roll
  B.auditSettle(b);
  const a = B.auditOf(b);
  assert.equal(a.confirms, 1);
  assert.equal(a.conflicts, 0);
});

test('a new game resets the audit', () => {
  const b = fresh('g1');
  roll(b, 8); produce(b, 1, [5, 5]); roll(b, 6);
  assert.equal(B.auditOf(b).conflicts, 1);
  B.applyFullState(b, fullState('g2').payload);   // new game id
  const a = B.auditOf(b);
  assert.equal(a.confirms, 0);
  assert.equal(a.conflicts, 0);
  assert.equal(a.trail.length, 0);
});

// ---- incomplete geometry must not audit (Codex P2 defensive gap) ----
// geomReady checked only that tiles AND corners were non-empty, never that the
// geometry was COMPLETE for what's built. A real captured full state with one
// built corner missing its hex geometry still passed, and the audit then settled a
// FALSE conflict: predictProduction silently under-counts the missing building, so
// when colonist broadcasts that building's owner producing, the prediction is short.
// The map-agnostic fix: a BUILT corner that resolves to zero tiles (or carries a
// building with no coordinates) is a phantom → geometry incomplete → don't audit.
// We use the real fixture so the "complete" leg is genuine colonist data, not a
// hand-authored board, and prove the two legs diverge.
const realPayload = require('./fixtures/ws-fullstate-2p.json');

// In the captured 2p board, corner 33 (owner 2, settlement) is the only building on
// a number-11 tile. So a roll of 11 produces exactly one ore-side card for colour 2
// from THAT corner — the cleanest single-building probe of one corner's geometry.
function realRoll(b, sum) {
  B.applyDiff(b, { gameLogState: { [++idx]: { text: { type: 10, firstDice: 1, secondDice: sum - 1 } } } });
}
function realProduce(b, color, cards) {
  B.applyDiff(b, { gameLogState: { [++idx]: { text: { type: 47, playerColor: color, cardsToBroadcast: cards, distributionType: 1 } } } });
}

test('a real complete board audits roll-11 production as a confirm', () => {
  const b = B.createBoard();
  B.applyFullState(b, JSON.parse(JSON.stringify(realPayload)));
  assert.equal(B.geomReady(b), true, 'a complete capture is usable geometry');
  assert.deepEqual(B.cornerDiag(b), { total: 54, geom: 54, built: 6, phantom: 0 });

  realRoll(b, 11);            // geometry predicts colour 2 gets 1 of the 11-tile resource
  realProduce(b, 2, [2]);     // colonist's real broadcast: colour 2 produced exactly that
  realRoll(b, 6);            // settle the 11
  const a = B.auditOf(b);
  assert.equal(a.confirms, 1, 'the complete board confirms the production it predicted');
  assert.equal(a.conflicts, 0);
});

test('the SAME board with one built corner omitted does NOT audit (no false conflict)', () => {
  // identical to the complete board, except corner 33's hex geometry is omitted from
  // the full state and the building then lands via an index-only placement diff —
  // exactly how colonist sends placements (the diff carries the corner index, no
  // coordinates). That leaves corner 33 built but coordinate-less → a phantom.
  const partial = JSON.parse(JSON.stringify(realPayload));
  delete partial.gameState.mapState.tileCornerStates['33'];
  const b = B.createBoard();
  B.applyFullState(b, partial);
  B.applyDiff(b, { mapState: { tileCornerStates: { 33: { owner: 2, buildingType: 1 } } } });

  assert.equal(B.cornerDiag(b).phantom, 1, 'the omitted-but-built corner is a phantom');
  assert.equal(B.geomReady(b), false, 'incomplete geometry is not usable — even though tiles and corners are non-empty');

  realRoll(b, 11);            // colour 2 WOULD produce from the missing corner...
  realProduce(b, 2, [2]);     // ...and colonist broadcasts it — under the old gate this settled a false conflict
  realRoll(b, 6);            // settle the 11
  const a = B.auditOf(b);
  assert.equal(a.conflicts, 0, 'incomplete geometry stays silent — no false conflict from the missing building');
  assert.equal(a.confirms, 0, 'and it is not counted as a confirmation either');
});
