'use strict';

// Time-aware recon settle. The opponent hand recon credits public production into
// the right resource, but the read-time projectRecon used to clamp the whole raw
// recon down to colonist's authoritative handCount — so an OLD over-count debt (a
// silent loss we never saw) would eat a freshly-broadcast type-47 production and
// show it as "?". The fix settles the old debt against the CURRENT handCount at the
// start of each live diff, BEFORE the new log is accrued, so stale uncertainty only
// touches stale state and the next public production stays known.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// a live diff carrying a roll + one player's type-47 production + their new hand count
function rollDiff(idxRoll, idxProd, prodColor, cards, newCount) {
  return {
    gameLogState: {
      [idxRoll]: { text: { type: 10, playerColor: 1, firstDice: 3, secondDice: 3 } },
      [idxProd]: { text: { type: 47, playerColor: prodColor, cardsToBroadcast: cards, distributionType: 1 } },
    },
    playerStates: { [prodColor]: { resourceCards: { cards: new Array(newCount).fill(0) } } },
  };
}

test('A — a fresh public production stays known instead of being eaten by old debt (Clover)', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(5).fill(0) };          // Clover handCount = 5
  B.__setRecon(b, 2, { 2: 3, 5: 2, unknown: 2 });          // raw = brick3 ore2 ?2 (sum 7, over by 2)

  // Clover rolls into +grain grain; handCount 5 → 7. The 2-card debt must settle
  // against the pre-production hand, not swallow the new grain.
  B.applyDiff(b, rollDiff(400, 401, 2, [4, 4], 7));

  const proj = B.reconBreakdownOf(b, 2);
  assert.equal(B.handCountOf(b, 2), 7, 'authoritative count followed the diff');
  assert.ok(proj[4] >= 2, `the freshly broadcast 2 grain stay known, got grain=${proj[4]}`);
  // the specific bug shape: brick1 grain0 ore0 unknown6 — must NOT happen
  assert.ok(!(proj[4] === 0 && proj.unknown === 6), 'production not collapsed into unknown');
});

test('B — production credits the broadcast resources as known (Arman)', () => {
  const b = B.createBoard();
  b.hands['4'] = { cards: new Array(4).fill(0) };          // Arman handCount = 4
  B.__setRecon(b, 4, { 5: 2, unknown: 1 });                // raw = ore2 ?1 (sum 3)

  B.applyDiff(b, rollDiff(410, 411, 4, [4, 5, 5], 7));     // +grain +ore +ore, count 4 → 7

  const proj = B.reconBreakdownOf(b, 4);
  assert.equal(proj[4], 1, 'grain1 known');
  assert.equal(proj[5], 4, 'ore4 known (2 prior + 2 produced)');
});

test('C — with no authoritative handCount, settle leaves the raw recon untouched', () => {
  const b = B.createBoard();
  // color 3 has a recon but NO hand entry → handCount is null (DOM-fallback territory)
  B.__setRecon(b, 3, { 1: 2, unknown: 1 });
  const before = JSON.stringify(b.handRecon[3]);

  B.applyDiff(b, { gameLogState: { 420: { text: { type: 10, playerColor: 1, firstDice: 2, secondDice: 2 } } } });

  assert.equal(JSON.stringify(b.handRecon[3]), before, 'no count → no settle, raw kept for the DOM fallback');
});

test('E — count-first / type-47-second: a stale debt must not eat a production that arrives a frame later (Codex)', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(5).fill(0) };          // Clover handCount = 5
  B.__setRecon(b, 2, { 2: 3, 5: 2, unknown: 2 });          // raw = brick3 ore2 ?2 (sum 7, over by 2)

  // frame A: COUNT ONLY — the +2 grain is already in the count (→7) but the type-47 that
  // names it hasn't arrived yet. The stale 2-card debt must settle, but the 2 pending gain
  // cards must NOT be pre-written into unknown.
  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(7).fill(0) } } } });

  // frame B: the type-47 naming "Clover got Grain Grain" lands a frame later.
  B.applyDiff(b, { gameLogState: { 500: { text: { type: 47, playerColor: 2, cardsToBroadcast: [4, 4], distributionType: 1 } } } });

  const proj = B.reconBreakdownOf(b, 2);
  assert.equal(B.handCountOf(b, 2), 7);
  assert.ok(proj[4] >= 2, `grain survives the split count/log frames, got grain=${proj[4]}`);
  assert.ok(!(proj[4] === 0 && proj.unknown === 7), 'not collapsed back to all-unknown');
});

test('D — settling is idempotent and never runs the hand below the authoritative count', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(4).fill(0) };          // handCount = 4
  B.__setRecon(b, 2, { 2: 3, 5: 3, unknown: 0 });          // raw = brick3 ore3 (sum 6, over by 2)

  B.applyDiff(b, {});                                       // a bare diff just settles
  const after1 = JSON.stringify(b.handRecon[2]);
  B.applyDiff(b, {});
  B.applyDiff(b, {});
  const after3 = JSON.stringify(b.handRecon[2]);

  assert.equal(after1, after3, 'repeated settles converge — no runaway erosion');
  const sum = [1, 2, 3, 4, 5].reduce((s, r) => s + b.handRecon[2][r], 0) + b.handRecon[2].unknown;
  assert.equal(sum, 4, 'settled raw matches the authoritative handCount, not below');
});

// ---- the pending hand-delta buffer: count/log SPLIT frames in BOTH directions ----
// A count change can arrive a frame before its naming log. The buffer holds the residual
// so a stale settle never degrades a known card that the very next log will name.

const sum = (o) => [1, 2, 3, 4, 5].reduce((s, r) => s + (o[r] || 0), 0) + (o.unknown || 0);

test('F — loss-split discard: count drops first, the type-55 names the card a frame later', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(5).fill(0) };          // handCount 5
  B.__setRecon(b, 2, { 2: 3, 4: 2 });                      // brick3 grain2 (matches, no debt)

  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(4).fill(0) } } } }); // count 5→4, no log
  B.applyDiff(b, { gameLogState: { 600: { text: { type: 55, playerColor: 2, cardEnums: [2] } } } }); // discard [brick]

  const got = B.reconBreakdownOf(b, 2);
  assert.deepEqual({ ...got }, { 1: 0, 2: 2, 3: 0, 4: 2, 5: 0, unknown: 0 }, 'brick2 grain2, not brick1 grain1 ?2');
});

test('G — loss-split build: count drops first, the type-5 road cost is named a frame later', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(4).fill(0) };          // handCount 4
  B.__setRecon(b, 2, { 1: 1, 2: 1, 4: 2 });                // lumber1 brick1 grain2

  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(2).fill(0) } } } }); // count 4→2, no log
  B.applyDiff(b, { gameLogState: { 610: { text: { type: 5, playerColor: 2, pieceEnum: 0 } } } }); // build road (−lumber −brick)

  const got = B.reconBreakdownOf(b, 2);
  assert.deepEqual({ ...got }, { 1: 0, 2: 0, 3: 0, 4: 2, 5: 0, unknown: 0 }, 'grain2 survives, road cost taken from the right cards');
});

test('H — loss-split bank trade: count drops first, the type-116 give/get is named a frame later', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(4).fill(0) };          // handCount 4
  B.__setRecon(b, 2, { 4: 4 });                            // grain4

  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(1).fill(0) } } } }); // count 4→1, no log
  B.applyDiff(b, { gameLogState: { 620: { text: { type: 116, playerColor: 2, givenCardEnums: [4, 4, 4, 4], receivedCardEnums: [5] } } } });

  const got = B.reconBreakdownOf(b, 2);
  assert.deepEqual({ ...got }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, unknown: 0 }, 'ore1 — the 4-grain give and 1-ore get both land');
});

test('I — a positive count-only move with no naming log times out into unknown', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: [] };                            // handCount 0
  B.__setRecon(b, 2, {});                                  // empty recon

  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(2).fill(0) } } } }); // count 0→2, no log
  for (let i = 0; i < 4; i++) B.applyDiff(b, {});          // age the pending past its ttl

  const got = B.reconBreakdownOf(b, 2);
  assert.equal(got.unknown, 2, 'an unclaimed gain becomes honest unknown');
  assert.equal(sum(got), 2);
});

test('J — a negative count-only move with no loss log times out into an honest loss', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(5).fill(0) };          // handCount 5
  B.__setRecon(b, 2, { 2: 3, 4: 2 });                      // brick3 grain2 (sum 5)

  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(4).fill(0) } } } }); // count 5→4, no log
  for (let i = 0; i < 4; i++) B.applyDiff(b, {});          // age the pending past its ttl

  const got = B.reconBreakdownOf(b, 2);
  assert.equal(sum(got), 4, 'total clamps to the authoritative count');
  assert.ok(got.unknown >= 1, 'the ambiguous lost card is honestly unknown, never a wrong named card');
});

test('K — same-diff count + log creates NO pending and matches the plain result', () => {
  const b = B.createBoard();
  b.hands['2'] = { cards: new Array(3).fill(0) };          // handCount 3
  B.__setRecon(b, 2, { 2: 3 });                            // brick3

  // count and the naming type-47 in the SAME diff
  B.applyDiff(b, {
    gameLogState: { 630: { text: { type: 47, playerColor: 2, cardsToBroadcast: [4], distributionType: 1 } } },
    playerStates: { 2: { resourceCards: { cards: new Array(4).fill(0) } } },
  });

  assert.equal(b.pendingHandDelta['2'], undefined, 'no pending for a same-diff count+log');
  assert.deepEqual({ ...B.reconBreakdownOf(b, 2) }, { 1: 0, 2: 3, 3: 0, 4: 1, 5: 0, unknown: 0 }, 'brick3 grain1');
});

// a minimal same-game full state (reconnect) carrying a gap log + the final hand count
function fullState(gameId, color, handCount, gapLog) {
  return {
    gameSettings: { id: gameId },
    gameState: {
      playerColor: 1,
      mapState: { tileHexStates: {}, tileCornerStates: {} },
      playerStates: { [color]: { resourceCards: { cards: new Array(handCount).fill(0) } } },
      gameLogState: gapLog,
    },
    playerUserStates: [],
  };
}

test('N — F5 + same-game full-state replay CLAIMS a restored GAIN pending (Codex)', () => {
  const b = B.createBoard();
  b.gameId = 'g1';
  b.hands['2'] = { cards: new Array(3).fill(0) };          // handCount 3
  B.__setRecon(b, 2, { 2: 3 });                            // brick3
  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(5).fill(0) } } } }); // count 3→5, no log → pending +2

  const snap = B.accrualSnapshot(b);
  const b2 = B.createBoard();
  B.restoreAccrual(b2, snap);                              // raw brick3 + pending +2

  // the reconnect full-state replays the gap: the type-47 that names the +2 grain
  B.applyFullState(b2, fullState('g1', 2, 5, { 700: { text: { type: 47, playerColor: 2, cardsToBroadcast: [4, 4], distributionType: 1 } } }));
  assert.equal(b2.pendingHandDelta['2'], undefined, 'the replayed gain log claimed the restored pending');

  B.applyDiff(b2, {});                                     // the next live diff must NOT re-degrade
  assert.deepEqual({ ...B.reconBreakdownOf(b2, 2) }, { 1: 0, 2: 3, 3: 0, 4: 2, 5: 0, unknown: 0 }, 'brick3 grain2 holds after F5');
});

test('O — F5 + same-game full-state replay CLAIMS a restored LOSS pending (Codex)', () => {
  const b = B.createBoard();
  b.gameId = 'g1';
  b.hands['2'] = { cards: new Array(5).fill(0) };          // handCount 5
  B.__setRecon(b, 2, { 2: 3, 4: 2 });                      // brick3 grain2
  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(4).fill(0) } } } }); // count 5→4, no log → pending −1

  const snap = B.accrualSnapshot(b);
  const b2 = B.createBoard();
  B.restoreAccrual(b2, snap);                              // raw brick3 grain2 + pending −1

  // the reconnect full-state replays the gap: the type-55 discard that names the lost brick
  B.applyFullState(b2, fullState('g1', 2, 4, { 710: { text: { type: 55, playerColor: 2, cardEnums: [2] } } }));
  assert.equal(b2.pendingHandDelta['2'], undefined, 'the replayed loss log claimed the restored pending');

  B.applyDiff(b2, {});
  assert.deepEqual({ ...B.reconBreakdownOf(b2, 2) }, { 1: 0, 2: 2, 3: 0, 4: 2, 5: 0, unknown: 0 }, 'brick2 grain2 holds after F5');
});

test('L — pending survives F5: snapshot → restore → the later log claims it, no double count', () => {
  const b = B.createBoard();
  b.gameId = 'g1';
  b.hands['2'] = { cards: new Array(3).fill(0) };          // handCount 3
  B.__setRecon(b, 2, { 2: 3 });                            // brick3
  B.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: new Array(5).fill(0) } } } }); // count 3→5, no log → pending +2

  const snap = B.accrualSnapshot(b);
  assert.ok(snap.pendingHandDelta && snap.pendingHandDelta['2'], 'pending is snapshotted');

  // F5: a fresh board, restore, the reconnect re-supplies the count, then the type-47 lands
  const b2 = B.createBoard();
  B.restoreAccrual(b2, snap);
  b2.hands['2'] = { cards: new Array(5).fill(0) };          // reconnect count
  B.applyDiff(b2, { gameLogState: { 640: { text: { type: 47, playerColor: 2, cardsToBroadcast: [4, 4], distributionType: 1 } } } });

  assert.deepEqual({ ...B.reconBreakdownOf(b2, 2) }, { 1: 0, 2: 3, 3: 0, 4: 2, 5: 0, unknown: 0 }, 'brick3 grain2 — claimed once, not doubled');
});
