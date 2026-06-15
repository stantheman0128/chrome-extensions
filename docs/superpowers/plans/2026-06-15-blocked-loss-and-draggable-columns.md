# Blocked Card Loss + Draggable Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-player "cards lost to the robber blocking your tiles" stat (replacing the ⚔️ stolen column) and make both table views' columns drag-reorderable by their header icons — shipped together as v1.34.0.

**Architecture:** Pure log-derived: learn each player's `produces[number][resource]` yield from clean (un-blocked) rolls, then derive block-loss as `Σ blocked.byKey[N res] × produces[N][res]` (backfill is automatic because loss is a derived value, never an accumulator). Columns are reordered by mutating per-view order arrays in `uiState`, rendered by iterating those arrays, and dragged via pointer events that translate whole `data-res` column groups.

**Tech Stack:** Vanilla JS content script (IIFE with a CommonJS export branch for tests), `node --test` + jsdom, Chrome i18n `_locales`.

---

## File Structure

- `colonist-stats-tracker/content.js` — all live logic (tally yield map, block parsing, derived loss, stats column swap, hover, column order + drag, persistence). Large single file by existing convention; we follow it.
- `colonist-stats-tracker/popup.js` — lifetime aggregation (swap stole→blockLoss) + per-game history bits.
- `colonist-stats-tracker/_locales/{en,zh_TW}/messages.json` — i18n strings.
- `colonist-stats-tracker/manifest.json` — version bump.
- `colonist-stats-tracker/ROADMAP.md` — shipped entry.
- `tests/blocked-loss.test.js` — NEW, Part A.
- `tests/column-order.test.js` — NEW, Part B.
- Existing tests touched: `tests/live-stats.test.js`, `tests/popup-aggregate.test.js`, `tests/view-switch.test.js`, `tests/ui-smoke.test.js` (any that assert `s-stole` / `stole` aggregates).

**Reference anchors in `content.js` (verify before editing — line numbers drift):**
- `RESOURCES` const: 17
- `tallyOf` tally object: 167-182
- roll branch: 504-520 · gain ("got") branch: 545-562 · block branch: 438-457 · `getMessagePart`: 360
- `RES_HL`: 1905-1913 · `STAT_COLS`: 1919-1926
- `renderCardsView`: 1981-2012 · `renderStatsView`: 2136-2178 (`vals` 2156-2164, cells map 2165-2172)
- tooltip `mousemove` dispatch (`data-bd`): 1481-1498 · `stealReportHTML`: 2064
- `countsSnapshot`: 2189-2199 · `BAD_UP`: 2221 · float reset snapshot: 2229
- `uiState`: 890 · `restoreDefaults`: 1160-1170 · UI restore (`ui.*`): 1184-1190 · `saveUI(patch)` (existing)
- `persistState`: 2384-2405 · `restoreState`: 2412-2445 · `buildGameRecord`: 2565-2580
- CommonJS export object: 3012-3063

---

# PART A — Blocked Card Loss

## Task A1: Learn per-player yield map from clean rolls

**Files:**
- Modify: `colonist-stats-tracker/content.js` (tally object ~182; add `lastRoll` near other module vars; roll branch ~504; gain branch ~545)
- Test: `tests/blocked-loss.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/blocked-loss.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { cst, makeMessage, feed } = require('./helpers/setup');
const { fixtures } = require('./fixtures/game-log');

// Build a "X rolled" message for an arbitrary sum by cloning a known roll and
// swapping the dice number imgs is overkill — instead reuse fixtures whose sums
// we know: roll_2_2 = sum 4, roll_2_5 = sum 7.
// For yield learning we need a controllable (roller, sum) + a following "got".
// roll_2_2 (Richia rolled 4) then got_bot_brick_grain (Richia got brick+grain)
// means: produces[Richia][4] = { brick:1, grain:1 }.

test('clean roll teaches the roller-independent yield map for the gainer', () => {
  cst.resetState();
  feed(fixtures.roll_2_2);             // Richia rolled sum 4
  feed(fixtures.got_bot_brick_grain);  // Richia got brick + grain
  const ty = cst.state.tally['Richia'] || {};
  assert.deepEqual(ty.produces && ty.produces[4], { brick: 1, grain: 1 });
});

test('starting resources are NOT learned as a numbered yield', () => {
  cst.resetState();
  feed(fixtures.starting_resources);   // "received starting resources" — no roll
  const ty = cst.state.tally['StanTheMan01'] || {};
  assert.equal(ty.produces == null || Object.keys(ty.produces).length, 0);
});

test('Year-of-Plenty take is NOT learned as a yield', () => {
  cst.resetState();
  feed(fixtures.roll_2_2);             // a real roll sets lastRoll = 4
  feed(fixtures.year_of_plenty_took);  // "took from bank" must be excluded
  const ty = cst.state.tally['StanTheMan01'] || {};
  assert.equal(ty.produces == null || (ty.produces[4] == null), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/blocked-loss.test.js`
Expected: FAIL — `produces` is undefined.

- [ ] **Step 3: Add `produces` to the tally object**

In `content.js` `tallyOf` (the object literal ~170-182), add after the `tradeGave`/`tradeGot` line:

```js
        tradeGave: {}, tradeGot: {}, // executed-trade cards per opponent (flow)
        // Per-number yield learned from CLEAN rolls (no block on that number):
        // number -> { resource -> cards }. Feeds the ⛔ block-loss derivation.
        produces: {},
```

- [ ] **Step 4: Add the `lastRoll` cursor**

Find where module-level mutable cursors live (near `let selfLocked`, `let rescraping`, etc. — same scope as `state`). Add:

```js
  // Most recent rolled sum (2..12). Drives produces-learning: a bare "got"
  // production message is attributed to this number. Reset on new game.
  let lastRoll = null;
```

In `resetState()` (the block that clears `state.tally` etc., ~2360-2377) add:

```js
    lastRoll = null;
```

- [ ] **Step 5: Set `lastRoll` in the roll branch**

In the dice-roll branch (~506, inside `if (sum != null && sum >= 2 && sum <= 12) {`), after `state.rollHistory.push(sum);` add:

```js
        lastRoll = sum;
```

- [ ] **Step 6: Learn yield in the gain branch**

In the gain branch (~552, inside `if (total > 0 && player) {`, AFTER the `gainedRes` loop and BEFORE `renderSoon()`), add a guarded learn. Roll production is a **bare "got"** — exclude initial placement ("received"/"starting") and Year of Plenty ("took from bank"):

```js
        // Learn the yield map ONLY from bare-"got" roll production (not initial
        // "received starting resources", not YoP "took from bank"). Per-resource
        // assignment: a partially-blocked roll simply omits the blocked resource,
        // so it never clobbers a previously-learned clean value.
        const isRollYield = lastRoll != null &&
          !text.includes('received') && !text.includes('took from bank');
        if (isRollYield) {
          ty.produces[lastRoll] = ty.produces[lastRoll] || {};
          for (const r of RESOURCES) if (counts[r]) ty.produces[lastRoll][r] = counts[r];
        }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tests/blocked-loss.test.js`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add colonist-stats-tracker/content.js tests/blocked-loss.test.js
git commit -m "feat(colonist): learn per-player yield map from clean rolls"
```

---

## Task A2: Extract the blocked tile's resource and key by "N res"

**Files:**
- Modify: `colonist-stats-tracker/content.js` block branch (~438-457)
- Test: `tests/blocked-loss.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/blocked-loss.test.js`:

```js
test('block message records "N res" key (resource read from the tile image)', () => {
  cst.resetState();
  feed(fixtures.blocked_by_robber);    // prob_11 + generated_tile_wool
  assert.equal(cst.state.blocked.count, 1);
  assert.equal(cst.state.blocked.byKey['11 wool'], 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/blocked-loss.test.js`
Expected: FAIL — current key is `"11 tile"` (resource not parsed; `text.includes('wool')` is false because "wool" lives only in the tile img alt).

- [ ] **Step 3: Read the resource from the tile image**

Replace the resource-detection lines in the block branch. Current (~450-451):

```js
      let res = null;
      for (const r of RESOURCES) if (text.includes(r)) { res = r; break; }
```

Replace with image-based detection (the tile is `generated_tile_<res>`; fall back to text just in case):

```js
      let res = null;
      getMessagePart(msgEl).querySelectorAll('img').forEach((img) => {
        const blob = (img.getAttribute('src') || '') + ' ' + (img.getAttribute('alt') || '');
        const m = blob.match(/generated_tile_(\w+)/i) || blob.match(/\b(lumber|brick|wool|grain|ore)\b/i);
        if (m && RESOURCES.includes(m[1].toLowerCase())) res = m[1].toLowerCase();
      });
      if (!res) for (const r of RESOURCES) if (text.includes(r)) { res = r; break; }
```

(The `num` extraction immediately above already loops imgs for `prob_N`; this is a second small loop for the tile resource. The existing `key`/`byKey` lines below stay as-is — they already build `` `${num != null ? num + ' ' : ''}${res || 'tile'}` ``, which now yields `"11 wool"`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/blocked-loss.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the existing live-stats suite (it asserts blocked counting)**

Run: `node --test tests/live-stats.test.js`
Expected: PASS (if a test asserts the old `"11 tile"`/key shape, update it to `"11 wool"` and re-run).

- [ ] **Step 6: Commit**

```bash
git add colonist-stats-tracker/content.js tests/blocked-loss.test.js tests/live-stats.test.js
git commit -m "feat(colonist): parse blocked tile resource into the N-res block key"
```

---

## Task A3: Derive block-loss per player + hover breakdown

**Files:**
- Modify: `colonist-stats-tracker/content.js` (add `blockLossOf` + `blockReportHTML` near `stealReportHTML` ~2076; export both ~3044)
- Test: `tests/blocked-loss.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/blocked-loss.test.js`:

```js
test('block loss = Σ blocked-count × my yield for that number+resource', () => {
  cst.resetState();
  feed(fixtures.roll_2_2);              // Richia rolled 4
  feed(fixtures.got_bot_brick_grain);   // produces[Richia][4] = {brick:1, grain:1}
  // Three blocks of "4 brick" would each cost Richia 1 brick:
  cst.state.blocked.byKey['4 brick'] = 3;
  assert.equal(cst.blockLossOf('Richia'), 3);
  // Richia produces no ore on 4 → an ore block costs nothing:
  cst.state.blocked.byKey['4 ore'] = 5;
  assert.equal(cst.blockLossOf('Richia'), 3);
});

test('block loss backfills once the number warms up', () => {
  cst.resetState();
  cst.state.blocked.byKey['4 brick'] = 2;   // blocked BEFORE we know the yield
  assert.equal(cst.blockLossOf('Richia'), 0);
  feed(fixtures.roll_2_2);
  feed(fixtures.got_bot_brick_grain);       // now produces[Richia][4].brick = 1
  assert.equal(cst.blockLossOf('Richia'), 2); // retroactively credited
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/blocked-loss.test.js`
Expected: FAIL — `cst.blockLossOf` is not a function.

- [ ] **Step 3: Implement `blockLossOf` and `blockReportHTML`**

In `content.js`, immediately AFTER `stealReportHTML` (~2076), add:

```js
  // Cards a player would have collected but didn't, because the robber sat on a
  // tile they build on. DERIVED (never accumulated) from the global blocked-tile
  // counter × that player's learned yield for the tile's number+resource — so a
  // tile blocked before its number warmed up is credited retroactively once the
  // yield is learned. Numbers never rolled clean stay uncredited (honest floor).
  function blockLossOf(name) {
    const ty = state.tally[name] || {};
    const prod = ty.produces || {};
    let total = 0;
    for (const [key, times] of Object.entries(state.blocked.byKey || {})) {
      const sp = key.indexOf(' ');
      if (sp < 0) continue;                       // legacy "tile"-only key: no resource
      const num = +key.slice(0, sp);
      const res = key.slice(sp + 1);
      total += times * ((prod[num] && prod[num][res]) || 0);
    }
    return total;
  }

  // Hover for the ⛔ cell: one line per "N res ×times = cards", biggest first.
  function blockReportHTML(name) {
    const ty = state.tally[name] || {};
    const prod = ty.produces || {};
    const rows = [];
    for (const [key, times] of Object.entries(state.blocked.byKey || {})) {
      const sp = key.indexOf(' ');
      if (sp < 0) continue;
      const num = +key.slice(0, sp);
      const res = key.slice(sp + 1);
      const per = (prod[num] && prod[num][res]) || 0;
      if (per * times <= 0) continue;             // not this player's tile
      rows.push({ num, res, times, cards: per * times });
    }
    if (!rows.length) return '';
    rows.sort((a, b) => b.cards - a.cards);
    const lines = rows.map((r) =>
      `<span style="white-space:nowrap;display:inline-flex;align-items:center;gap:3px;">` +
      `${iconImg(r.res, 1.15)} <b>${r.num}</b> ×${r.times} = ${r.cards}</span>`);
    const header = escapeHtml(t('blockReportTitle', 'Lost to robber-blocked tiles'));
    return `<span style="display:flex;flex-direction:column;gap:2px;">` +
      `<b style="margin-bottom:1px;">${header}</b>${lines.join('')}</span>`;
  }
```

- [ ] **Step 4: Export both functions**

In the CommonJS export object (~3044, near `stealReportHTML,`) add:

```js
      stealReportHTML,
      blockLossOf,
      blockReportHTML,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/blocked-loss.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add colonist-stats-tracker/content.js tests/blocked-loss.test.js
git commit -m "feat(colonist): derive per-player robber-blocked card loss with backfill"
```

---

## Task A4: Swap the ⚔️ stolen column for the ⛔ block-loss column

**Files:**
- Modify: `colonist-stats-tracker/content.js` (`RES_HL` ~1910, `STAT_COLS` ~1920, `renderStatsView` `vals` ~2157 + cells, tooltip dispatch ~1491, `countsSnapshot` ~2196, `BAD_UP` ~2221, reset snapshot ~2229)
- Modify: `colonist-stats-tracker/_locales/{en,zh_TW}/messages.json`
- Test: `tests/blocked-loss.test.js` (render assertion) + `tests/view-switch.test.js`

- [ ] **Step 1: Write the failing test (render shows ⛔, not ⚔️)**

Append to `tests/blocked-loss.test.js`:

```js
const { document } = require('./helpers/setup');

test('Stats header shows the block column (s-block) and not the stolen column', () => {
  cst.resetState();
  cst.createPanel();
  // Switch the player table to the Stats view, then render.
  cst.getUiState().resView = 'stats';
  cst.render();
  const heads = [...document.querySelectorAll('#cst-res-wrap [data-colhead]')]
    .map((el) => el.getAttribute('data-res'));
  assert.ok(heads.includes('s-block'), 'has s-block header');
  assert.ok(!heads.includes('s-stole'), 'no s-stole header');
});
```

(Note: `data-colhead` is added in Task B2 Step 3; if running Part A before B, temporarily assert on `[data-res^="s-"]` headers instead. Keep this test — it also guards Part B.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/blocked-loss.test.js`
Expected: FAIL — `s-stole` still present / `s-block` absent.

- [ ] **Step 3: Swap the column definition + highlight colour**

`RES_HL` (~1910): rename the `s-stole` key to `s-block`:

```js
    's-block': '138,103,194', 's-lost': '138,103,194',
```

`STAT_COLS` (~1920): replace the first entry:

```js
    { key: 's-block', icon: '⛔', tip: t('statBlock', 'Cards lost to robber-blocked tiles (precise after warm-up)') },
```

- [ ] **Step 4: Swap the value + hover wiring in `renderStatsView`**

In `vals` (~2157) replace the `'s-stole'` entry. Drop the now-unused `hasStole` line (~2152-2153) and add a `hasBlock`:

```js
      const hasBlock = blockLossOf(p.name) > 0;
```

```js
        's-block': { v: blockLossOf(p.name), bd: hasBlock ? 'block' : null },
        's-lost':  { v: ty.lost || 0, bd: hasLost ? 'lost' : null },
```

- [ ] **Step 5: Route the `block` hover kind**

In the tooltip `mousemove` `data-bd` dispatch (~1491), extend the kind switch:

```js
        const html = kind === 'trade' ? tradeBreakdownHTML(who)
          : kind === 'block' ? blockReportHTML(who)
          : stealReportHTML(who, kind);
```

- [ ] **Step 6: Update the float snapshot keys**

`countsSnapshot` (~2196): replace `'s-stole': t.stole || 0,` with:

```js
        's-block': blockLossOf(p.name), 's-lost': t.lost || 0, 's-disc': t.discardCards || 0,
```

`BAD_UP` (~2221) — block loss going up is bad (red float):

```js
    const BAD_UP = { 's-block': true, 's-lost': true, 's-disc': true };
```

Reset snapshot object (~2229): replace `'s-stole': 0,` with `'s-block': 0,`.

- [ ] **Step 7: i18n — add `statBlock` + `blockReportTitle`, drop `statStole`**

In `_locales/en/messages.json`: remove the `statStole` block; add:

```json
  "statBlock": { "message": "Cards lost to robber-blocked tiles (precise after warm-up)" },
  "blockReportTitle": { "message": "Lost to robber-blocked tiles" },
```

In `_locales/zh_TW/messages.json`: remove the `statStole` block; add:

```json
  "statBlock": { "message": "被搶匪卡田少收的牌（暖機後精準）" },
  "blockReportTitle": { "message": "被搶匪卡田的損失" },
```

- [ ] **Step 8: Run tests**

Run: `node --test tests/blocked-loss.test.js tests/view-switch.test.js`
Expected: PASS. If `view-switch.test.js` asserts `s-stole`, change it to `s-block` and re-run.

- [ ] **Step 9: Commit**

```bash
git add colonist-stats-tracker/content.js colonist-stats-tracker/_locales tests
git commit -m "feat(colonist): replace stolen column with robber-blocked loss column"
```

---

## Task A5: Lifetime popup — aggregate block loss instead of steals

**Files:**
- Modify: `colonist-stats-tracker/content.js` `buildGameRecord` (~2577)
- Modify: `colonist-stats-tracker/popup.js` (`aggregate` ~70/89/107, history bits ~264)
- Modify: `colonist-stats-tracker/_locales/{en,zh_TW}/messages.json`
- Test: `tests/popup-aggregate.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/popup-aggregate.test.js`, add (match its existing `require`/`test` style — it imports `aggregate` from `../colonist-stats-tracker/popup.js`):

```js
test('aggregate averages per-game block loss for the self player', () => {
  const history = [
    { selfName: 'Me', winner: 'Me', diceCounts: {}, tally: { Me: {} }, blockLoss: { Me: 4 } },
    { selfName: 'Me', winner: 'X',  diceCounts: {}, tally: { Me: {} }, blockLoss: { Me: 6 } },
  ];
  const agg = aggregate(history);
  assert.equal(agg.avgBlockLoss, 5);   // (4 + 6) / 2
});

test('aggregate tolerates legacy records without blockLoss', () => {
  const agg = aggregate([{ selfName: 'Me', diceCounts: {}, tally: { Me: {} } }]);
  assert.equal(agg.avgBlockLoss, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/popup-aggregate.test.js`
Expected: FAIL — `avgBlockLoss` is undefined.

- [ ] **Step 3: Store a precomputed per-player block loss in the game record**

In `content.js` `buildGameRecord` (~2577), add a `blockLoss` map next to `tally`/`blocked` so the popup never re-derives:

```js
      tally: JSON.parse(JSON.stringify(state.tally)),
      blocked: JSON.parse(JSON.stringify(state.blocked)),
      blockLoss: [...state.players.keys()].reduce((m, n) => {
        m[n] = blockLossOf(n); return m;
      }, {}),
```

- [ ] **Step 4: Aggregate block loss in the popup**

In `popup.js` `aggregate`:

Add an accumulator next to `stoleSum` (~70):

```js
  let incomeSum = 0, turnMsSum = 0, turnsSum = 0, lostSum = 0, blockLossSum = 0;
```

(Remove `stoleSum` since the panel no longer surfaces steals; keep `lostSum`.)

In the loop, replace the `stoleSum += +t.stole || 0;` line (~89) with:

```js
    blockLossSum += +(g.blockLoss && g.blockLoss[self]) || 0;
```

In the returned object, replace `avgSteals` (~107) with:

```js
    avgBlockLoss: played ? blockLossSum / played : null,
    avgLosses: played ? lostSum / played : null,
```

- [ ] **Step 5: Update the popup UI label + per-game history bit**

Find where `avgSteals` is rendered in the popup summary (search `avgSteals` in `popup.js`) and rename to `avgBlockLoss`; update its label key from `histStole`/steal wording to a block key. For the per-game list bit (~264), replace:

```js
        if (t.stole) bits.push(M('histStole', { n: t.stole }) || `stole ${t.stole}`);
```

with (per-game block loss is in `g.blockLoss`, not `t`):

```js
        const bl = (g.blockLoss && g.blockLoss[p.name]) || 0;
        if (bl) bits.push(M('histBlock', { n: bl }) || `blocked −${bl}`);
```

- [ ] **Step 6: i18n — popup summary + history keys**

Add to BOTH locales (replace any `histStole`/steal-summary keys you renamed). Identify the summary label key used beside `avgSteals` (e.g. `lifeSteals`) and add a parallel block key. en:

```json
  "histBlock": { "message": "blocked −{n}" },
  "lifeBlockLoss": { "message": "Avg cards lost to blocked tiles" },
```

zh_TW:

```json
  "histBlock": { "message": "被卡田 −{n}" },
  "lifeBlockLoss": { "message": "平均被卡田損失" },
```

(Wire `lifeBlockLoss` wherever the old steals summary label was referenced; delete the obsolete steals label keys.)

- [ ] **Step 7: Run tests**

Run: `node --test tests/popup-aggregate.test.js tests/popup-render.test.js`
Expected: PASS. Update any popup test asserting `avgSteals`/`histStole`.

- [ ] **Step 8: Commit**

```bash
git add colonist-stats-tracker tests/popup-aggregate.test.js tests/popup-render.test.js
git commit -m "feat(colonist): lifetime popup aggregates robber-blocked loss"
```

---

## Task A6: Part A regression sweep

- [ ] **Step 1: Run the full suite**

Run: `node --test`
Expected: all green. Fix any test still referencing `stole`/`s-stole`/`avgSteals`/`statStole` by switching to the block equivalents. Do NOT change tests for the 💔 `lost` column — that stat is unchanged.

- [ ] **Step 2: Commit any test fixes**

```bash
git add tests
git commit -m "test(colonist): align suite with block-loss column rename"
```

---

# PART B — Draggable Columns

## Task B1: Per-view order arrays + reconcile + persistence

**Files:**
- Modify: `colonist-stats-tracker/content.js` (order defaults near `STAT_COLS` ~1926; `uiState` ~890; `restoreDefaults` ~1162; UI restore ~1187; export ~3059)
- Test: `tests/column-order.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/column-order.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { cst } = require('./helpers/setup');

test('reconcileOrder drops unknown keys and appends missing canonical keys', () => {
  const canon = ['a', 'b', 'c'];
  assert.deepEqual(cst.reconcileOrder(['c', 'a'], canon), ['c', 'a', 'b']);
  assert.deepEqual(cst.reconcileOrder(['x', 'b'], canon), ['b', 'a', 'c']);
  assert.deepEqual(cst.reconcileOrder(null, canon), ['a', 'b', 'c']);
});

test('legacy stat order with s-stole is reconciled to include s-block, drop s-stole', () => {
  const out = cst.reconcileOrder(
    ['s-stole', 's-lost', 's-disc'],
    ['s-block', 's-lost', 's-disc', 's-gain', 's-turn', 's-trade']);
  assert.ok(!out.includes('s-stole'));
  assert.ok(out.includes('s-block'));
  assert.equal(out.length, 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/column-order.test.js`
Expected: FAIL — `cst.reconcileOrder` is not a function.

- [ ] **Step 3: Add order defaults + reconcile**

In `content.js`, immediately AFTER `STAT_COLS` (~1926), add:

```js
  // Canonical column orders (the drag-reorder baseline). RES order includes the
  // unknown/stolen-card column so it reorders like any other.
  const RES_ORDER_DEF = ['lumber', 'brick', 'wool', 'grain', 'ore', 'unknown'];
  const STAT_ORDER_DEF = STAT_COLS.map((c) => c.key);
  const COL_BY_KEY = STAT_COLS.reduce((m, c) => { m[c.key] = c; return m; }, {});

  // Keep a saved order forward-compatible across versions that add/remove a
  // column: keep saved keys that still exist (in their saved order), then append
  // any canonical key the save is missing. Garbage/empty input → canonical.
  function reconcileOrder(saved, canonical) {
    const ok = new Set(canonical);
    const kept = (Array.isArray(saved) ? saved : []).filter((k) => ok.has(k));
    for (const k of canonical) if (!kept.includes(k)) kept.push(k);
    return kept;
  }
```

- [ ] **Step 4: Seed `uiState` with the orders**

`uiState` (~890): add `resOrder`/`statOrder`:

```js
  const uiState = { panelCollapsed: false, diceCollapsed: false, resCollapsed: false, resView: 'cards', mode: 'large', fontScale: 1, diceMode: 'auto', resOrder: RES_ORDER_DEF.slice(), statOrder: STAT_ORDER_DEF.slice() };
```

(`uiState` is declared after `STAT_ORDER_DEF`? If `uiState` is at ~890 and `STAT_ORDER_DEF` at ~1926, `uiState` runs first and `RES_ORDER_DEF`/`STAT_ORDER_DEF` are not yet defined. To avoid a TDZ/order bug, initialise the arrays in `uiState` to literals and reconcile on load instead:)

```js
  const uiState = { panelCollapsed: false, diceCollapsed: false, resCollapsed: false, resView: 'cards', mode: 'large', fontScale: 1, diceMode: 'auto',
    resOrder: ['lumber', 'brick', 'wool', 'grain', 'ore', 'unknown'],
    statOrder: ['s-block', 's-lost', 's-disc', 's-gain', 's-turn', 's-trade'] };
```

- [ ] **Step 5: Reconcile on UI restore**

In the UI restore block (~1187, where `uiState.resView = ...` etc.) add:

```js
    uiState.resOrder = reconcileOrder(ui.resOrder, RES_ORDER_DEF);
    uiState.statOrder = reconcileOrder(ui.statOrder, STAT_ORDER_DEF);
```

- [ ] **Step 6: Reset orders in `restoreDefaults`**

In `restoreDefaults` (~1162-1166) add the resets and include them in its `saveUI({...})`:

```js
    uiState.resOrder = RES_ORDER_DEF.slice();
    uiState.statOrder = STAT_ORDER_DEF.slice();
```

and extend the `saveUI({ ... })` call with `resOrder: RES_ORDER_DEF.slice(), statOrder: STAT_ORDER_DEF.slice(),`.

- [ ] **Step 7: Export `reconcileOrder`**

In the export object (~3059, near `getUiState`) add:

```js
      reconcileOrder,
```

- [ ] **Step 8: Run tests**

Run: `node --test tests/column-order.test.js`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add colonist-stats-tracker/content.js tests/column-order.test.js
git commit -m "feat(colonist): per-view column order arrays with forward-compatible reconcile"
```

---

## Task B2: Render both views by the order arrays

**Files:**
- Modify: `colonist-stats-tracker/content.js` `renderCardsView` (~1995-2011) + `renderStatsView` (~2140-2172)
- Test: `tests/column-order.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/column-order.test.js`:

```js
const { document } = require('./helpers/setup');

function headKeys() {
  return [...document.querySelectorAll('#cst-res-wrap [data-colhead]')]
    .map((el) => el.getAttribute('data-res'));
}

test('stats header renders in statOrder', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().resView = 'stats';
  cst.getUiState().statOrder = ['s-trade', 's-block', 's-lost', 's-disc', 's-gain', 's-turn'];
  cst.render();
  assert.deepEqual(headKeys(), ['s-trade', 's-block', 's-lost', 's-disc', 's-gain', 's-turn']);
});

test('cards header renders in resOrder (unknown reorderable)', () => {
  cst.resetState();
  cst.createPanel();
  cst.getUiState().resView = 'cards';
  cst.getUiState().resOrder = ['unknown', 'lumber', 'brick', 'wool', 'grain', 'ore'];
  cst.render();
  assert.deepEqual(headKeys(), ['unknown', 'lumber', 'brick', 'wool', 'grain', 'ore']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/column-order.test.js`
Expected: FAIL — no `[data-colhead]` nodes / fixed order.

- [ ] **Step 3: Render Cards view by `resOrder`, tag headers**

In `renderCardsView` (~1981), refactor the header + body to iterate `uiState.resOrder`. Replace the `head`/`return` construction so each value column is produced by key.

Header — build a per-key header cell (resource icon+bank badge, or the unknown `?` cell). Replace the `tableHead(... RESOURCES.map(iconCell) ... + unknown span ...)` with:

```js
    const unknownHead = `<span data-res="unknown" data-colhead="1" data-tip="${t('tipUnknownCards', 'Unknown (stolen) cards')}" style="${HEAD_SLOT}border-radius:5px;cursor:grab;">${iconImg('unknown', 1.85)}</span>`;
    const headCell = (r) => (r === 'unknown' ? unknownHead
      : iconCell(r).replace('<span data-res="' + r + '"', '<span data-res="' + r + '" data-colhead="1" style="cursor:grab;"').replace('style="' + HEAD_SLOT, 'data-keep="' + HEAD_SLOT));
    const head = tableHead(uiState.resOrder.map(headCell).join(''), CARDS_GRID);
```

The `.replace` juggling above is fragile. CLEANER: edit `iconCell` itself (~1983) to accept the key and emit `data-colhead="1"` + `cursor:grab`, and add an `unknown` branch inside it:

```js
    const iconCell = (r) => {
      if (r === 'unknown') {
        return `<span data-res="unknown" data-colhead="1" data-tip="${t('tipUnknownCards', 'Unknown (stolen) cards')}" style="${HEAD_SLOT}border-radius:5px;cursor:grab;">${iconImg('unknown', 1.85)}</span>`;
      }
      const low = bank[r] <= 2;
      return `<span data-res="${r}" data-colhead="1" data-tip="${t('bankLeft', 'Bank: {n} {res} left', { n: bank[r], res: RESOURCE_LABEL[r] })}" style="${HEAD_SLOT}border-radius:5px;cursor:grab;">
        <span style="position:relative;display:inline-block;line-height:0;">
          ${iconImg(r, 2.0)}
          <span style="position:absolute;top:-0.5em;right:-0.65em;min-width:1.2em;padding:0 0.25em;text-align:center;
                background:#fbf9f4;color:${low ? THEME.bad : THEME.text};border:1px solid ${THEME.border};
                border-radius:0.7em;font-size:0.6em;font-weight:700;line-height:1.5;
                box-shadow:0 1px 2px rgba(0,0,0,.2);">${bank[r]}</span>
        </span>
      </span>`;
    };
    const head = tableHead(uiState.resOrder.map(iconCell).join(''), CARDS_GRID);
```

Body — replace the row `cells` builder (~2005-2009) to iterate `uiState.resOrder` with an `unknown` branch:

```js
      const cells = nameCell(p, prof, active) +
        uiState.resOrder.map((r) => {
          if (r === 'unknown') {
            return `<span data-res="unknown" class="${actCls}" style="text-align:center;border-radius:5px;font-variant-numeric:tabular-nums;color:${p.unknown ? THEME.accent : THEME.textDim};${p.unknown ? '' : 'opacity:.4;'}">${p.unknown}</span>`;
          }
          return `<span data-res="${r}" class="${actCls}" style="text-align:center;border-radius:5px;font-variant-numeric:tabular-nums;${p.resources[r] === 0 ? `color:${THEME.textDim};opacity:.4;` : ''}">${p.resources[r]}</span>`;
        }).join('');
```

- [ ] **Step 4: Render Stats view by `statOrder`, tag headers**

In `renderStatsView` header (~2140), iterate `uiState.statOrder`:

```js
    const head = tableHead(uiState.statOrder.map((key) => {
      const c = COL_BY_KEY[key];
      return `<span data-res="${c.key}" data-colhead="1" data-tip="${c.tip}" style="${HEAD_SLOT}border-radius:5px;cursor:grab;">` +
        `<span style="font-size:1.5em;line-height:1;">${c.icon}</span></span>`;
    }).join(''), STATS_GRID);
```

In the body cells map (~2165), iterate `uiState.statOrder` instead of `STAT_COLS`:

```js
      const cells = nameCell(p, prof, active) + uiState.statOrder.map((key) => {
        const c = COL_BY_KEY[key];
        const { v, disp, tip, pie, bd } = vals[c.key];
        return `<span data-res="${c.key}" class="${actCls}" ` +
          `${pie ? `data-pie="${escapeHtml(pie)}" ` : ''}` +
          `${bd ? `data-bd="${escapeHtml(p.name)}|${bd}" ` : ''}` +
          `${tip ? `data-tip="${escapeHtml(tip)}" ` : ''}` +
          `style="text-align:center;border-radius:5px;font-variant-numeric:tabular-nums;${v ? '' : `color:${THEME.textDim};opacity:.4;`}">${disp != null ? escapeHtml(disp) : v}</span>`;
      }).join('');
```

- [ ] **Step 5: Run tests**

Run: `node --test tests/column-order.test.js tests/blocked-loss.test.js tests/ui-smoke.test.js`
Expected: PASS. (`ui-smoke` renders the panel; ensure no crash.)

- [ ] **Step 6: Commit**

```bash
git add colonist-stats-tracker/content.js tests
git commit -m "feat(colonist): render both table views by per-view column order"
```

---

## Task B3: Pointer drag-reorder with live column shift

**Files:**
- Modify: `colonist-stats-tracker/content.js` (add a `wireColumnDrag(host)` and call it where panel events are wired, ~1290-1360; add a module `dragging` flag near `lastRoll`)
- Test: `tests/column-order.test.js` (pure `reorder` unit) + MANUAL gesture test

- [ ] **Step 1: Write the failing test (pure reorder helper)**

Append to `tests/column-order.test.js`:

```js
test('reorderKeys moves a key forward and backward', () => {
  const a = ['a', 'b', 'c', 'd'];
  assert.deepEqual(cst.reorderKeys(a, 0, 2), ['b', 'c', 'a', 'd']); // a → index 2
  assert.deepEqual(cst.reorderKeys(a, 3, 1), ['a', 'd', 'b', 'c']); // d → index 1
  assert.deepEqual(cst.reorderKeys(a, 1, 1), ['a', 'b', 'c', 'd']); // no-op
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/column-order.test.js`
Expected: FAIL — `cst.reorderKeys` is not a function.

- [ ] **Step 3: Add the pure reorder helper + module flag**

Near `reconcileOrder`, add:

```js
  function reorderKeys(arr, from, to) {
    const next = arr.slice();
    const [k] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, k);
    return next;
  }
```

Near `let lastRoll = null;` add:

```js
  let dragging = false;   // true while a column is being dragged (suppresses tooltips/highlight)
```

Export `reorderKeys` (export object, near `reconcileOrder`):

```js
      reconcileOrder,
      reorderKeys,
```

- [ ] **Step 4: Implement `wireColumnDrag(host)`**

Add this function (e.g. just below `restoreDefaults` or near the other panel wiring). It uses pointer events, a 4px threshold, and translates whole `data-res` column groups live.

```js
  // Drag-reorder the value columns by their header icons. Press an icon and move
  // past a small threshold to start; the whole column (header + every row cell,
  // selected by its shared data-res) follows the pointer while the others slide
  // to make room. On release the order array is updated, persisted, re-rendered.
  function wireColumnDrag(host) {
    let d = null; // active drag context

    host.addEventListener('pointerdown', (e) => {
      const head = e.target.closest && e.target.closest('[data-colhead]');
      if (!head || !host.contains(head)) return;
      const wrap = host.querySelector('#cst-res-wrap');
      if (!wrap || !wrap.contains(head)) return;
      const view = uiState.resView;                       // 'cards' | 'stats'
      const order = (view === 'stats' ? uiState.statOrder : uiState.resOrder).slice();
      const key = head.getAttribute('data-res');
      const fromIdx = order.indexOf(key);
      if (fromIdx < 0) return;
      // Capture each column's header rect (for slot centres + step width).
      const heads = order.map((k) => wrap.querySelector(`[data-colhead][data-res="${k}"]`));
      if (heads.some((h) => !h)) return;
      const centers = heads.map((h) => h.getBoundingClientRect().left + h.getBoundingClientRect().width / 2);
      const step = centers.length > 1 ? (centers[1] - centers[0]) : 40;
      d = { view, order, key, fromIdx, toIdx: fromIdx, startX: e.clientX, started: false, wrap, step, centers };
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      e.stopPropagation();                                // don't start a panel move
    });

    host.addEventListener('pointermove', (e) => {
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (!d.started) {
        if (Math.abs(dx) < 4) return;                     // below threshold: still a click
        d.started = true;
        dragging = true;
      }
      // New insertion index = how many slot-centres the dragged centre has crossed.
      const draggedCentre = d.centers[d.fromIdx] + dx;
      let toIdx = 0;
      for (let i = 0; i < d.centers.length; i++) if (draggedCentre > d.centers[i]) toIdx = i;
      // Clamp toward the dragged direction so the dragged item lands at the slot
      // it visually overlaps.
      toIdx = Math.max(0, Math.min(d.order.length - 1, toIdx));
      d.toIdx = toIdx;
      applyColumnShift(d, dx);
    });

    function endDrag(e) {
      if (!d) return;
      const ctx = d; d = null;
      clearColumnShift(ctx.wrap);
      if (ctx.started && ctx.toIdx !== ctx.fromIdx) {
        const next = reorderKeys(ctx.order, ctx.fromIdx, ctx.toIdx);
        if (ctx.view === 'stats') { uiState.statOrder = next; saveUI({ statOrder: next }); }
        else { uiState.resOrder = next; saveUI({ resOrder: next }); }
        render();
      }
      dragging = false;
    }
    host.addEventListener('pointerup', endDrag);
    host.addEventListener('pointercancel', endDrag);
  }

  // Translate each column group so the dragged one follows the pointer and the
  // others open a gap. Columns are selected by their shared data-res (header +
  // body cells), scoped to the table wrap.
  function applyColumnShift(d, dx) {
    for (let i = 0; i < d.order.length; i++) {
      const k = d.order[i];
      let tx = 0;
      if (i === d.fromIdx) {
        tx = dx;                                          // dragged column tracks the pointer
      } else if (d.fromIdx < d.toIdx && i > d.fromIdx && i <= d.toIdx) {
        tx = -d.step;                                     // shift left to fill
      } else if (d.fromIdx > d.toIdx && i < d.fromIdx && i >= d.toIdx) {
        tx = d.step;                                      // shift right to fill
      }
      const cells = d.wrap.querySelectorAll(`[data-res="${k}"]`);
      cells.forEach((c) => {
        c.style.transition = (i === d.fromIdx) ? 'none' : 'transform .15s ease';
        c.style.transform = tx ? `translateX(${tx}px)` : '';
        c.style.position = (i === d.fromIdx && tx) ? 'relative' : '';
        c.style.zIndex = (i === d.fromIdx && tx) ? '5' : '';
      });
    }
  }

  function clearColumnShift(wrap) {
    wrap.querySelectorAll('[data-res]').forEach((c) => {
      c.style.transition = '';
      c.style.transform = '';
      c.style.position = '';
      c.style.zIndex = '';
    });
  }
```

- [ ] **Step 5: Call `wireColumnDrag(host)` once when the panel is wired**

Find where panel-level listeners are attached (the function that runs `host.addEventListener('mousemove', …)` for tooltips, ~1481, or the main wiring block ~1290). Add, alongside those one-time bindings:

```js
    wireColumnDrag(host);
```

(Ensure it is called exactly once per panel creation, in the same place the tooltip `mousemove` listener is registered.)

- [ ] **Step 6: Run the reorder unit test + full suite**

Run: `node --test tests/column-order.test.js`
Expected: PASS (reorderKeys). Then `node --test` — all green.

- [ ] **Step 7: Commit**

```bash
git add colonist-stats-tracker/content.js tests/column-order.test.js
git commit -m "feat(colonist): drag-reorder table columns by header icon with live shift"
```

---

## Task B4: Suppress tooltips/highlight while dragging + grab cursor

**Files:**
- Modify: `colonist-stats-tracker/content.js` tooltip `mousemove` (~1481) and the column-highlight handler (search `colHL`, ~1433)

- [ ] **Step 1: Guard the tooltip handler**

At the very top of the `host.addEventListener('mousemove', (e) => {` body (~1481), add:

```js
      if (dragging) { tip.style.display = 'none'; return; }
```

- [ ] **Step 2: Guard the column-highlight handler**

Find the handler that sets `colHL` from a hovered `[data-res]` (~1433-1470). At the top of that handler body add:

```js
      if (dragging) return;
```

- [ ] **Step 3: Manual verification (gesture cannot be unit-tested in jsdom)**

Load the unpacked extension, open a colonist game (or `preview.html`), and verify:
- Hovering a header icon shows a grab cursor; a plain click still shows its tooltip and toggles the column highlight.
- Pressing an icon and dragging sideways moves the whole column live; others slide.
- Releasing commits the new order; reload the page → order persists.
- Works in both Cards and Stats views, independently.
- "Restore defaults" resets both orders.

- [ ] **Step 4: Run full suite + commit**

Run: `node --test`
Expected: all green.

```bash
git add colonist-stats-tracker/content.js
git commit -m "feat(colonist): suppress hover UI during column drag; grab-cursor affordance"
```

---

# PART C — Release v1.34.0

## Task C1: Version bump + ROADMAP shipped entry

**Files:**
- Modify: `colonist-stats-tracker/manifest.json` (`"version"`)
- Modify: `colonist-stats-tracker/ROADMAP.md` (Shipped section)

- [ ] **Step 1: Bump the version**

In `manifest.json` change `"version": "1.33.0"` to `"version": "1.34.0"`.

- [ ] **Step 2: Add a Shipped entry to `ROADMAP.md`**

Under the "Shipped from this roadmap" section, add:

```markdown
- **v1.34.0 — Robber-blocked card loss + draggable columns.**
  - ⛔ column: cards you would have collected but lost to the robber blocking your
    tiles. Derived (`blocked count × learned per-number yield`) with retroactive
    backfill once a number warms up; replaces the ⚔️ "stolen" column. Lifetime
    popup aggregates it too. Honest floor: a tile never rolled clean stays uncredited.
  - Drag-reorder: both the Resources and Stats columns reorder by dragging their
    header icon (4px threshold, live column shift); order persists per view and
    resets with "Restore defaults".
```

- [ ] **Step 3: Commit**

```bash
git add colonist-stats-tracker/manifest.json colonist-stats-tracker/ROADMAP.md
git commit -m "chore(colonist): release v1.34.0 (block loss + draggable columns)"
```

## Task C2: Final verification

- [ ] **Step 1: Full test run**

Run: `node --test`
Expected: all green; test count ≥ previous 137 + new tests.

- [ ] **Step 2: Manual smoke (preview/unpacked)**

Confirm: Stats view shows ⛔ with a sensible number after a few rolls + a block; hovering ⛔ shows the "N res ×times = cards" breakdown; columns drag-reorder and persist in both views; lifetime popup shows the block-loss average.

- [ ] **Step 3: (When the user asks) package + push**

Per the user's convention, do NOT push/zip until asked. When asked, repackage the `.zip` for the Chrome Web Store and push the commits.

---

## Self-Review notes (author check)

- **Spec coverage (block loss):** yield map A1 · block resource A2 · derived loss + backfill A3 · column swap + hover + floats + i18n A4 · popup + archive A5 · regression A6. ✅
- **Spec coverage (drag):** order arrays + reconcile + persistence + restore-defaults B1 · render-by-order (both views, unknown reorderable) B2 · pointer drag + live shift B3 · dragging guard + cursor B4. ✅
- **Integration order:** Part A swaps `s-stole`→`s-block` BEFORE Part B builds `STAT_ORDER_DEF` from `STAT_COLS`, so the default order never references a removed key. ✅
- **Type/name consistency:** `produces`, `lastRoll`, `dragging`, `blockLossOf`, `blockReportHTML`, `reconcileOrder`, `reorderKeys`, `RES_ORDER_DEF`, `STAT_ORDER_DEF`, `COL_BY_KEY`, `wireColumnDrag`, `applyColumnShift`, `clearColumnShift`, `data-colhead`, key `s-block`, hover kind `block`, record field `blockLoss`, popup `avgBlockLoss` — used consistently across tasks. ✅
- **Known soft spots (call out at execution):** (1) `uiState` is defined far above `STAT_ORDER_DEF`; B1 Step 4 uses literals to avoid a definition-order bug. (2) exact line of the one-time panel wiring for `wireColumnDrag` must be the same place tooltips are bound — verify it runs once per `createPanel()`. (3) popup summary label key for the old steals stat must be located by grepping `avgSteals` and fully renamed.
