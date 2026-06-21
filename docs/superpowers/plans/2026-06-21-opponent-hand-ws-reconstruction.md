# Opponent hand reconstruction (WS) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recommended) or executing-plans. Steps use `- [ ]` checkboxes. Spec:
> `docs/superpowers/specs/2026-06-21-opponent-hand-ws-reconstruction-design.md`.

**Goal:** Reconstruct every player's per-resource hand from the WS `gameLogState`
in `board.js` (`handRecon`), reconciled to the authoritative WS total, so the
opponent breakdown is reload-proof and DOM-independent.

**Architecture:** Additive `b.handRecon[color] = {1..5, unknown}`, fed by `accrueLog`
event handlers, reconciled to `handCountOf` after each `applyDiff`/`applyFullState`.
Reload-proof via the existing history replay. Monitor-first: Phase A ships with no
display change (audit only); Phase B promotes it into `syncFromWS`.

**Tech stack:** vanilla JS dual-mode module; `node --test tests/*.test.js`, jsdom.

resId: 1=lumber 2=brick 3=wool 4=grain 5=ore. Verify each task:
`cd C:/Users/stans/Projects/chrome-extensions && node --test tests/hand-recon.test.js`

---

## File structure

- Modify `colonist-stats-tracker/board.js` — add `handRecon`, handlers, reconcile, API.
- Modify `colonist-stats-tracker/content.js` — audit line (Phase A); `syncFromWS`
  opponent branch (Phase B).
- Create `tests/hand-recon.test.js` — the engine's unit + integration tests.
- Modify `colonist-stats-tracker/manifest.json` + `CHANGELOG.md` — version bumps.

---

## PHASE A — build + monitor (no display change)

### Task 1: `handRecon` state + the reconcile core

**Files:** Modify `board.js` (`createBoard`, new `ensureRecon`, `reconcileRecon`);
Create `tests/hand-recon.test.js`.

- [ ] **Step 1 — failing test** (`tests/hand-recon.test.js`):

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const board = require('../colonist-stats-tracker/board.js');

// Drive handRecon directly via the (to-be-added) test helpers.
test('reconcile pads unknown when known sum is below the WS total', () => {
  const b = board.createBoard();
  b.hands[2] = { cards: [0, 0, 0, 0, 0] };          // WS total = 5, masked
  board.__setRecon(b, 2, { 1: 2 });                  // we only know 2 lumber
  board.__reconcile(b, 2);
  assert.deepEqual(board.reconBreakdownOf(b, 2), { 1: 2, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 3 });
});

test('reconcile removes excess: unknown first, then largest known', () => {
  const b = board.createBoard();
  b.hands[2] = { cards: [0, 0] };                     // WS total = 2
  board.__setRecon(b, 2, { 1: 1, 5: 3, unknown: 1 }); // sum 5, need to drop 3
  board.__reconcile(b, 2);
  const r = board.reconBreakdownOf(b, 2);
  assert.equal(r.unknown, 0, 'unknown removed first (1)');
  assert.equal(r[5], 1, 'then 2 off the largest known (ore 3->1)');
  assert.equal(r[1], 1, 'smaller known untouched');
});
```

- [ ] **Step 2 — run, expect fail:** `__setRecon`/`__reconcile`/`reconBreakdownOf` undefined.

- [ ] **Step 3 — implement** in `board.js`:

```js
// in createBoard(): add  handRecon: {},
function ensureRecon(b, color) {
  return b.handRecon[color] || (b.handRecon[color] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 });
}
function reconSum(r) { return r[1] + r[2] + r[3] + r[4] + r[5] + r.unknown; }
// Reconcile a colour's reconstructed hand to colonist's authoritative count.
function reconcileRecon(b, color) {
  const total = handCountOf(b, color);
  if (total == null) return;
  const r = ensureRecon(b, color);
  let diff = total - reconSum(r);
  if (diff > 0) { r.unknown += diff; return; }
  diff = -diff;                                   // remove `diff` cards
  const fromU = Math.min(r.unknown, diff); r.unknown -= fromU; diff -= fromU;
  while (diff > 0) {                              // then largest known
    let big = 0, bk = 0;
    for (let i = 1; i <= 5; i++) if (r[i] > big) { big = r[i]; bk = i; }
    if (!bk) break;
    r[bk] -= 1; diff -= 1;
  }
}
```

Export in the `api` object: `reconBreakdownOf: (b, color) => b.handRecon[color] || null`,
and TEST-ONLY helpers `__setRecon: (b, color, o) => Object.assign(ensureRecon(b, color), o)`,
`__reconcile: reconcileRecon`.

- [ ] **Step 4 — run, expect pass.**
- [ ] **Step 5 — commit:** `git add colonist-stats-tracker/board.js tests/hand-recon.test.js && git commit -m "feat(colonist-stats-tracker): handRecon scaffold + reconcile-to-total"`

### Task 2: production (47) + Year of Plenty (21)

**Files:** Modify `board.js` (`accrueLog`); `tests/hand-recon.test.js`.

- [ ] **Step 1 — failing test:**

```js
const diffLog = (entries) => ({ gameLogState: entries });
test('production (47) and YoP (21) add resIds to handRecon', () => {
  const b = board.createBoard();
  board.applyDiff(b, diffLog({
    '9': { text: { type: 47, playerColor: 3, cardsToBroadcast: [1, 1, 5], distributionType: 0 } },
    '10': { text: { type: 21, playerColor: 3, cardEnums: [4, 4] } },
  }));
  const r = board.reconBreakdownOf(b, 3);
  assert.equal(r[1], 2); assert.equal(r[5], 1); assert.equal(r[4], 2);
});
```

- [ ] **Step 2 — run, expect fail** (handRecon untouched by 47/21).
- [ ] **Step 3 — implement:** in `accrueLog`'s `type 47 || 21` branch, after the
  existing `gained` accrual, also `const rr = ensureRecon(b, text.playerColor); for (const c of cards) rr[c] += 1;`
- [ ] **Step 4 — run, expect pass.** **Step 5 — commit.**

### Task 3: bank trade (116) + player trade (115)

**Files:** Modify `board.js` (`accrueLog`); `tests/hand-recon.test.js`.

- [ ] **Step 1 — failing test:**

```js
test('bank trade (116) deducts given, adds received', () => {
  const b = board.createBoard();
  board.__setRecon(b, 4, { 3: 4 });
  board.applyDiff(b, diffLog({ '5': { text: { type: 116, playerColor: 4, givenCardEnums: [3, 3, 3, 3], receivedCardEnums: [1] } } }));
  const r = board.reconBreakdownOf(b, 4);
  assert.equal(r[3], 0); assert.equal(r[1], 1);
});
test('player trade (115) moves cards both ways', () => {
  const b = board.createBoard();
  board.__setRecon(b, 2, { 5: 1 }); board.__setRecon(b, 4, { 2: 1 });
  board.applyDiff(b, diffLog({ '7': { text: { type: 115, playerColor: 2, acceptingPlayerColor: 4, givenCardEnums: [5], receivedCardEnums: [2] } } }));
  assert.deepEqual(board.reconBreakdownOf(b, 2), { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0, unknown: 0 });
  assert.deepEqual(board.reconBreakdownOf(b, 4), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, unknown: 0 });
});
```

- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement** new `accrueLog` branches. Helper:
  `function reconApply(b, color, cards, sign) { const r = ensureRecon(b, color); for (const c of cards) if (r[c] != null) r[c] = Math.max(0, r[c] + sign); }`
  - `116`: `reconApply(b, text.playerColor, text.givenCardEnums||[], -1); reconApply(b, text.playerColor, text.receivedCardEnums||[], +1);`
  - `115`: offerer `-given +received`; accepter (`text.acceptingPlayerColor`) `-received +given`.
- [ ] **Step 4 — run, expect pass.** **Step 5 — commit.**

### Task 4: discard (55) + build cost (5)

**Files:** Modify `board.js`; `tests/hand-recon.test.js`.

- [ ] **Step 1 — failing test:**

```js
const COST = { road: [1, 2], settlement: [1, 2, 3, 4], city: [4, 4, 5, 5, 5] };
test('discard (55) removes cardEnums', () => {
  const b = board.createBoard();
  board.__setRecon(b, 1, { 1: 1, 3: 1, 5: 2 });
  board.applyDiff(b, diffLog({ '3': { text: { type: 55, playerColor: 1, cardEnums: [1, 3, 5, 5] } } }));
  assert.deepEqual(board.reconBreakdownOf(b, 1), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 });
});
test('build (5) deducts cost by pieceEnum: 0 road, 2 settlement, 3 city', () => {
  const b = board.createBoard();
  board.__setRecon(b, 1, { 1: 1, 2: 1, 3: 1, 4: 3, 5: 3 });
  board.applyDiff(b, diffLog({ '4': { text: { type: 5, playerColor: 1, pieceEnum: 0, isVp: false } } })); // road -1L -1B
  board.applyDiff(b, diffLog({ '8': { text: { type: 5, playerColor: 1, pieceEnum: 3, isVp: true } } }));  // city -2G -3O
  assert.deepEqual(board.reconBreakdownOf(b, 1), { 1: 0, 2: 0, 3: 1, 4: 1, 5: 0, unknown: 0 });
});
```

- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement:** `55` → `reconApply(..., cardEnums, -1)`. `5` → a cost
  table `const BUILD_COST = { 0: [1, 2], 2: [1, 2, 3, 4], 3: [4, 4, 5, 5, 5] };` and
  `reconApply(b, text.playerColor, BUILD_COST[text.pieceEnum] || [], -1);`
- [ ] **Step 4 — run, expect pass.** **Step 5 — commit.**

### Task 5: monopoly (86) — deduct each victim's current holdings

**Files:** Modify `board.js`; `tests/hand-recon.test.js`.

- [ ] **Step 1 — failing test:**

```js
test('monopoly (86) gives the taker amountStolen and zeroes each victim of that resource', () => {
  const b = board.createBoard();
  board.__setRecon(b, 2, { 5: 3 }); board.__setRecon(b, 3, { 5: 2 });  // two victims hold ore
  board.applyDiff(b, diffLog({ '9': { text: { type: 86, playerColor: 1, amountStolen: 5, cardEnum: 5 } } }));
  assert.equal(board.reconBreakdownOf(b, 1)[5], 5, 'taker +5 ore');
  assert.equal(board.reconBreakdownOf(b, 2)[5], 0, 'victim 2 loses its ore');
  assert.equal(board.reconBreakdownOf(b, 3)[5], 0, 'victim 3 loses its ore');
});
```

- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement** in the existing `type 86` branch (after `monoTook`):
  `const rr = ensureRecon(b, text.playerColor); rr[text.cardEnum] += text.amountStolen||0;`
  then for every OTHER colour in `b.handRecon`, set `that[text.cardEnum] = 0`.
  (The taker's gain == the sum of victims' holdings, so reconcile stays consistent.)
- [ ] **Step 4 — run, expect pass.** **Step 5 — commit.**

### Task 6: self steals (14/15) into handRecon

**Files:** Modify `board.js`; `tests/hand-recon.test.js`.

- [ ] **Step 1 — failing test:**

```js
test('self steal (14) and being robbed (15) move the known card in handRecon', () => {
  const b = board.createBoard();
  board.__setRecon(b, 1, { 4: 1 });           // self(1) holds grain
  board.applyDiff(b, diffLog({ '5': { text: { type: 15, playerColor: 3, cardEnums: [4] }, specificRecipients: [1] } }));
  assert.equal(board.reconBreakdownOf(b, 1)[4], 0, 'self lost the grain');
  assert.equal(board.reconBreakdownOf(b, 3)[4], 1, 'thief gained it');
  board.applyDiff(b, diffLog({ '6': { text: { type: 14, playerColor: 3, cardEnums: [2] }, specificRecipients: [1] } }));
  assert.equal(board.reconBreakdownOf(b, 1)[2], 1, 'self gained the stolen brick');
  assert.equal(board.reconBreakdownOf(b, 3)[2], -0 === 0 ? 0 : 0, 'victim 3 -1 brick (floored at 0)');
});
```

- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement** in the existing `14||15` branch (alongside the stat
  accrual): reuse `self`/`thief`/`victim` already computed; `reconApply(b, thief, [card], +1); reconApply(b, victim, [card], -1);`
- [ ] **Step 4 — run, expect pass.** **Step 5 — commit.**

### Task 7: wire reconcile in + reload-proof + full-game integration

**Files:** Modify `board.js` (`applyDiff`, `applyFullState`); `tests/hand-recon.test.js`.

- [ ] **Step 1 — failing tests:**

```js
test('reconcile runs after a diff so type-16 opp steal degrades to unknown', () => {
  const b = board.createBoard();
  b.hands = { 2: { cards: [0, 0, 0] }, 4: { cards: [0] } };  // totals 3 and 1
  board.__setRecon(b, 2, { 1: 3 }); board.__setRecon(b, 4, { 5: 2 });
  // opp steal: thief 2 +1 (total 2->3), victim 4 -1 (total 2->1); masked
  board.applyDiff(b, { playerStates: { 2: { resourceCards: { cards: [0, 0, 0] } }, 4: { resourceCards: { cards: [0] } } },
    gameLogState: { '7': { text: { type: 16, playerColorThief: 2, playerColorVictim: 4, cardBacks: [0] } } } });
  assert.equal(board.reconBreakdownOf(b, 2).unknown, 0); // 3 known == total 3
  assert.equal(board.reconSumOf(b, 2), 3);
  assert.equal(board.reconSumOf(b, 4), 1);               // 2 known -> reconciled to 1
});
test('handRecon is identical whether fed as live diffs or replayed via full-state (reload-proof)', () => {
  const hist = { /* a handful of 47/116/55/5 entries with playerStates */ };
  const live = board.createBoard();   /* feed each as applyDiff */
  const reconnect = board.createBoard(); /* feed all at once via applyFullState */
  for (const c of [1, 2, 3, 4]) assert.deepEqual(board.reconBreakdownOf(live, c), board.reconBreakdownOf(reconnect, c));
});
```

- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement:** call `for (const c of Object.keys(b.handRecon)) reconcileRecon(b, +c)` at the end of `applyDiff` and `applyFullState` (after playerStates/hands are set). Export `reconSumOf: (b, color) => reconSum(ensureRecon(b, color))`.
- [ ] **Step 4 — run, expect pass.** Add a full-4-player replay using the captured game's events; assert each colour's `reconSum == handCountOf`. **Step 5 — commit.**

### Task 8: surface in `__cstAudit` (monitor) + version bump

**Files:** Modify `content.js` (`buildAuditReport`), `manifest.json`, `CHANGELOG.md`.

- [ ] **Step 1 — failing test** (`tests/ws-stats.test.js`): relay a full-state with a
  masked opponent + a 47 for them; assert `buildAuditReport()` contains a `recon:` line
  with the reconstructed breakdown next to the panel breakdown.
- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement:** in the per-player audit block add
  `L.push('  recon: ws=' + JSON.stringify(reconNamed) + ' panel=' + ourBreakdown)` using
  `__cstBoard.reconBreakdownOf`. Bump manifest, add a CHANGELOG "Added" entry
  ("opponent hand WS reconstruction — Phase A, monitored in __cstAudit, no display change").
- [ ] **Step 4 — run full suite green.** **Step 5 — commit.**

**>>> CHECKPOINT: ship Phase A, Stan plays several games, pastes `__cstAudit()`.
Confirm `recon` matches `panel` + survives reload. Only then start Phase B. <<<**

---

## PHASE B — promote (gated on real-game verification)

### Task 9: `syncFromWS` opponent branch uses `handRecon`

**Files:** Modify `content.js` (`syncFromWS`); `tests/ws-stats.test.js` or `resync-ws.test.js`.

- [ ] **Step 1 — failing test:** relay a full-state where an opponent's `handRecon`
  is `{1:2, unknown:1}`; assert `syncFromWS()` writes `resources.lumber=2`, `unknown=1`
  for that opponent (instead of the DOM-inferred values), and self stays exact.
- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement:** in `syncFromWS`'s opponent branch, when
  `reconBreakdownOf` is available, write its resId→name counts + unknown into the
  player; keep `reconcileTotal` as a final guard. DOM path remains the pre-handshake
  fallback.
- [ ] **Step 4 — run full suite green.** Bump version + CHANGELOG (Phase B, promoted).
  **Step 5 — commit.**

---

## Self-review

- **Spec coverage:** every event in the spec table → a task (1 reconcile, 2 prod/YoP,
  3 trades, 4 discard/build, 5 mono, 6 self-steal, 7 wire+reload+integration, 8 audit,
  9 promote). type 16 + dev-buy handled by reconcile (Task 7) per spec.
- **Type consistency:** `reconBreakdownOf` returns `{1..5,unknown}`; `reconSumOf`
  the scalar; `reconcileRecon`/`ensureRecon`/`reconApply` consistent across tasks.
- **No placeholders:** the reload-proof test's `hist` literal is filled in at Task 7
  Step 4 from the captured sample (noted, not a gap).
