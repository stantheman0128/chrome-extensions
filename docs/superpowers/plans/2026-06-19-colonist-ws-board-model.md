# Colonist WS Board Model + Live Exact ⛔ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) to implement task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Maintain colonist's full game model live from the WebSocket and compute exact in-game ⛔, with the existing log/endgame ⛔ kept as a validation oracle.

**Architecture:** A pure `board.js` (game model from full state + diffs, blocked-loss accumulator) consumed by `content.js`; the main-world `ws-inspector.js` relays `id=130` frames to the content script. Spec: `docs/superpowers/specs/2026-06-19-colonist-ws-board-model-design.md`.

**Tech Stack:** Vanilla JS (dual-mode module like `msgpack.js`), `node --test`.

---

## File structure
- **Create `colonist-stats-tracker/board.js`** — pure game model. One responsibility: turn WS state into queryable board + blocked-loss. Dual-mode (`module.exports` / `window.__cstBoard`).
- **Create `tests/board.test.js`** — TDD against the real captured opening board + synthetic diffs.
- **Modify `colonist-stats-tracker/ws-inspector.js`** — relay `id=130` via `postMessage`.
- **Modify `colonist-stats-tracker/content.js`** — consume relayed state → feed board → ⛔ from `board`, log oracle compares.
- **Modify `colonist-stats-tracker/manifest.json`** — load `board.js` before `content.js`; bump 1.45.0 → 1.46.0.
- **Modify `CHANGELOG.md`** — 1.46.0 entry.

---

## Task 1: `board.js` — geometry + full state

**Files:** Create `colonist-stats-tracker/board.js`, `tests/board.test.js`

- [ ] **Step 1: Failing tests**

Create `tests/board.test.js`:

```js
'use strict';

// board.js builds colonist's game model from the WebSocket. These tests use REAL
// coordinates from a captured opening board (id=130 type=4) so the corner↔tile
// geometry is pinned to ground truth.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../colonist-stats-tracker/board.js');

// A trimmed-but-real opening payload: a few tiles around (0,0)/(1,1) plus corner
// 23 (where a settlement was really built) and the centre-hex corners.
function openingPayload() {
  return {
    gameState: {
      playerColor: 1,
      mapState: {
        tileHexStates: {
          7:  { x: 1, y: 1, type: 2, diceNumber: 2 },
          15: { x: 0, y: 1, type: 4, diceNumber: 9 },
          16: { x: 1, y: 0, type: 3, diceNumber: 10 },
          18: { x: 0, y: 0, type: 4, diceNumber: 11 },
          12: { x: 0, y: -1, type: 5, diceNumber: 6 },
          17: { x: 1, y: -1, type: 5, diceNumber: 3 },
        },
        tileCornerStates: {
          23: { x: 0, y: 1, z: 1 },
          48: { x: 0, y: 0, z: 0 },
          51: { x: 0, y: 0, z: 1 },
        },
      },
      mechanicRobberState: { locationTileIndex: 7, isActive: true },
    },
    playerUserStates: [
      { selectedColor: 1, username: 'StanTheMan01' },
      { selectedColor: 2, username: 'Sancho' },
    ],
  };
}

test('tilesOfCorner uses the verified z=0 / z=1 offsets', () => {
  assert.deepEqual(B.tilesOfCorner({ x: 0, y: 1, z: 1 }), [[0, 1], [1, 1], [1, 0]]);
  assert.deepEqual(B.tilesOfCorner({ x: 0, y: 0, z: 0 }), [[0, 0], [0, -1], [1, -1]]);
});

test('applyFullState indexes tiles, corners, robber and self color', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  assert.equal(B.ready(b), true);
  assert.equal(B.robberTile(b), 7);
  assert.equal(b.selfColor, 1);
  assert.equal(b.tiles['7'].number, 2);
  assert.equal(b.colorToName[1], 'StanTheMan01');
});

test('tilesOfCornerIdx maps corner 23 to its three real adjacent tiles', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  // (0,1)=15, (1,1)=7, (1,0)=16
  assert.deepEqual(B.tilesOfCornerIdx(b, 23).sort(), ['15', '16', '7']);
});

test('cornersByTile is the inverse: tile 7 lists corner 23', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  assert.ok((b.cornersByTile['7'] || []).includes('23'));
});
```

- [ ] **Step 2: Run — expect FAIL** (`module not found`)

`cd /c/Users/stans/Projects/chrome-extensions && node --test tests/board.test.js`

- [ ] **Step 3: Implement `board.js`**

Create `colonist-stats-tracker/board.js`:

```js
'use strict';

// colonist game model from the WebSocket (id=130). Pure: every function takes the
// board object `b`. The board is canvas-only in the DOM, but the WS carries the
// real state — this turns it into queryable tiles/corners/robber + a live
// blocked-loss accumulator. Resource ids 1..5 (0 = desert); building types
// 1 = settlement, 2 = city.
(function () {
  // A corner (x,y,z) touches up to three hexes (axial coords). Derived from the
  // real board and verified (centre hex has exactly its six corners).
  function tilesOfCorner(c) {
    const x = c.x, y = c.y;
    return c.z === 0
      ? [[x, y], [x, y - 1], [x + 1, y - 1]]
      : [[x, y], [x + 1, y], [x + 1, y - 1]];
  }

  function createBoard() {
    return {
      tiles: {}, coordToTile: {}, corners: {}, cornersByTile: {},
      robberTile: null, selfColor: null, colorToName: {},
      blockedLoss: {}, seenLog: -1, _ready: false,
    };
  }

  function recomputeCornersByTile(b) {
    b.cornersByTile = {};
    for (const ci of Object.keys(b.corners)) {
      for (const [tx, ty] of tilesOfCorner(b.corners[ci])) {
        const ti = b.coordToTile[tx + ',' + ty];
        if (ti != null) (b.cornersByTile[ti] || (b.cornersByTile[ti] = [])).push(ci);
      }
    }
  }

  function applyFullState(b, payload) {
    const gs = (payload && payload.gameState) || {};
    const map = gs.mapState || {};
    b.tiles = {}; b.coordToTile = {};
    for (const i of Object.keys(map.tileHexStates || {})) {
      const t = map.tileHexStates[i];
      b.tiles[i] = { type: t.type, number: t.diceNumber, x: t.x, y: t.y };
      b.coordToTile[t.x + ',' + t.y] = i;
    }
    b.corners = {};
    for (const i of Object.keys(map.tileCornerStates || {})) {
      const c = map.tileCornerStates[i];
      b.corners[i] = { x: c.x, y: c.y, z: c.z, owner: c.owner, buildingType: c.buildingType };
    }
    recomputeCornersByTile(b);
    b.robberTile = gs.mechanicRobberState ? gs.mechanicRobberState.locationTileIndex : null;
    if (gs.playerColor != null) b.selfColor = gs.playerColor;
    b.colorToName = {};
    for (const u of (payload && payload.playerUserStates) || []) b.colorToName[u.selectedColor] = u.username;
    b._ready = true;
  }

  function tilesOfCornerIdx(b, idx) {
    const c = b.corners[idx];
    if (!c) return [];
    return tilesOfCorner(c).map((p) => b.coordToTile[p[0] + ',' + p[1]]).filter((t) => t != null);
  }

  const api = {
    createBoard, tilesOfCorner, applyFullState, tilesOfCornerIdx,
    ready: (b) => b._ready,
    robberTile: (b) => b.robberTile,
    blockedLossOf: (b, color) => b.blockedLoss[color] || 0,
    _recomputeCornersByTile: recomputeCornersByTile,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (typeof window !== 'undefined' ? window : globalThis).__cstBoard = api;
})();
```

- [ ] **Step 4: Run — expect PASS** (4 tests) and **full suite** (209 + 4 = 213).

`node --test tests/board.test.js` then `node --test tests/*.test.js`

---

## Task 2: `board.js` — diffs + blocked-loss

**Files:** Modify `colonist-stats-tracker/board.js`, `tests/board.test.js`

- [ ] **Step 1: Failing tests** — append to `tests/board.test.js`:

```js
test('applyDiff records a building placement (owner + buildingType) on an existing corner', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } });
  assert.equal(b.corners['23'].owner, 1);
  assert.equal(b.corners['23'].buildingType, 1);
});

test('applyDiff moves the robber', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  B.applyDiff(b, { mechanicRobberState: { locationTileIndex: 15 } });
  assert.equal(B.robberTile(b), 15);
});

test('a roll on the robber-blocked tile accrues blocked-loss; other rolls and 7s do not', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload()); // robber on tile 7 (number 2)
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 1 } } } }); // Stan settles corner 23 (adj. tile 7)
  // roll a 2 → tile 7 is blocked → Stan loses 1 (settlement)
  B.applyDiff(b, { gameLogState: { 50: { text: { type: 10, firstDice: 1, secondDice: 1 }, from: 1 } } });
  assert.equal(B.blockedLossOf(b, 1), 1);
  // roll a 10 (different number) → no change
  B.applyDiff(b, { gameLogState: { 51: { text: { type: 10, firstDice: 5, secondDice: 5 }, from: 1 } } });
  assert.equal(B.blockedLossOf(b, 1), 1);
  // a 7 → no production → no change
  B.applyDiff(b, { gameLogState: { 52: { text: { type: 10, firstDice: 3, secondDice: 4 }, from: 1 } } });
  assert.equal(B.blockedLossOf(b, 1), 1);
});

test('a city on the blocked tile loses 2; the same log entry is never counted twice', () => {
  const b = B.createBoard();
  B.applyFullState(b, openingPayload());
  B.applyDiff(b, { mapState: { tileCornerStates: { 23: { owner: 1, buildingType: 2 } } } }); // city
  const roll = { gameLogState: { 60: { text: { type: 10, firstDice: 1, secondDice: 1 }, from: 1 } } };
  B.applyDiff(b, roll);
  B.applyDiff(b, roll);           // replayed (e.g. re-scrape) — must not double count
  assert.equal(B.blockedLossOf(b, 1), 2);
});

test('a same-number tile WITHOUT the robber is not blocked', () => {
  const b = B.createBoard();
  const p = openingPayload();
  // add a second number-2 tile (index 99) at (5,5) with Stan on an adjacent corner
  p.gameState.mapState.tileHexStates['99'] = { x: 5, y: 5, type: 2, diceNumber: 2 };
  p.gameState.mapState.tileCornerStates['80'] = { x: 5, y: 5, z: 0 }; // touches (5,5)
  B.applyFullState(b, p);         // robber still on tile 7
  B.applyDiff(b, { mapState: { tileCornerStates: { 80: { owner: 1, buildingType: 1 } } } });
  B.applyDiff(b, { gameLogState: { 70: { text: { type: 10, firstDice: 1, secondDice: 1 }, from: 1 } } }); // roll 2
  assert.equal(B.blockedLossOf(b, 1), 0); // tile 99 has number 2 but no robber → not blocked
});
```

- [ ] **Step 2: Run — expect FAIL** (`applyDiff is not a function`)

`node --test tests/board.test.js`

- [ ] **Step 3: Implement `applyDiff` + `accrueBlocked`** — add inside the IIFE before `const api`:

```js
  function applyDiff(b, diff) {
    if (!diff) return;
    const map = diff.mapState || {};
    if (map.tileCornerStates) {
      let movedPos = false;
      for (const i of Object.keys(map.tileCornerStates)) {
        const c = map.tileCornerStates[i];
        const cur = b.corners[i] || (b.corners[i] = {});
        if (c.x != null) { cur.x = c.x; movedPos = true; }
        if (c.y != null) cur.y = c.y;
        if (c.z != null) cur.z = c.z;
        if (c.owner != null) cur.owner = c.owner;
        if (c.buildingType != null) cur.buildingType = c.buildingType;
      }
      if (movedPos) recomputeCornersByTile(b); // corners are normally fixed at full state
    }
    if (diff.mechanicRobberState && diff.mechanicRobberState.locationTileIndex != null) {
      b.robberTile = diff.mechanicRobberState.locationTileIndex;
    }
    if (diff.gameLogState) {
      const entries = Object.keys(diff.gameLogState)
        .map((k) => parseInt(k, 10))
        .filter((k) => k > b.seenLog)
        .sort((a, c) => a - c);
      for (const k of entries) {
        b.seenLog = k;
        const text = diff.gameLogState[String(k)] && diff.gameLogState[String(k)].text;
        if (text && text.type === 10) accrueBlocked(b, (text.firstDice || 0) + (text.secondDice || 0));
      }
    }
  }

  function accrueBlocked(b, n) {
    const t = b.robberTile != null ? b.tiles[b.robberTile] : null;
    if (!t || t.number !== n || t.type === 0) return; // robber not on a matching numbered tile
    for (const ci of b.cornersByTile[b.robberTile] || []) {
      const c = b.corners[ci];
      if (!c || c.owner == null || !c.buildingType) continue;
      b.blockedLoss[c.owner] = (b.blockedLoss[c.owner] || 0) + (c.buildingType === 2 ? 2 : 1);
    }
  }
```

Add `applyDiff` to the `api` object: `createBoard, tilesOfCorner, applyFullState, applyDiff, tilesOfCornerIdx,`.

- [ ] **Step 4: Run — expect PASS** (9 board tests) + **full suite** (213 + 5 = 218).

`node --test tests/board.test.js` then `node --test tests/*.test.js`

---

## Task 3: Relay + content.js integration (browser glue)

**Files:** Modify `ws-inspector.js`, `content.js`, `manifest.json`

- [ ] **Step 1: Relay id=130 from the main-world tap.** In `ws-inspector.js`, inside `record()` after `push(...)` for the binary branch, add a relay for game-state frames. Replace the binary `try` block body:

```js
    try {                                      // binary (MessagePack) frames
      const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data);
      const obj = mp ? mp.decode(u8) : null;
      push({ t: now(), dir, kind: 'bin', id: (obj && obj.id != null) ? obj.id : null, data: obj });
      if (dir === 'in' && obj && obj.id === '130') {
        try { window.postMessage({ __cstWS: 'state', msg: obj }, '*'); } catch (e) {}
      }
    } catch (e) {
      push({ t: now(), dir, kind: 'bin', error: String(e), bytesHex: hex(data) });
    }
```

- [ ] **Step 2: Consume the relay in `content.js`.** Find where `boot()` / the IIFE sets up listeners (near the top-level init). Add a board instance and a message listener. Insert after `const RESOURCES = [...]` near the top of the IIFE (so `__cstBoard` is in scope):

```js
  // ---- live game model from the WebSocket (board-model migration) ----
  // ws-inspector.js (main world) relays decoded id=130 frames; board.js turns the
  // full state + diffs into an exact model. Used for ⛔ today; the log keeps
  // running as the oracle.
  const wsBoard = (typeof __cstBoard !== 'undefined') ? __cstBoard.createBoard() : null;
  if (wsBoard && typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.__cstWS !== 'state') return;
      const m = e.data.msg;
      if (!m || m.id !== '130' || !m.data) return;
      const d = m.data;
      try {
        if (d.type === 4) __cstBoard.applyFullState(wsBoard, d.payload);
        else if (d.type === 91 && d.payload) __cstBoard.applyDiff(wsBoard, d.payload.diff);
      } catch (err) { /* malformed frame — ignore, log keeps us safe */ }
    });
  }
```

- [ ] **Step 3: Use the WS value for ⛔, oracle-compare with the estimate.** Find `blockLossOf(name)` in `content.js`. At the very top of the function body (before the endgameBlocked check), add the WS source:

```js
  function blockLossOf(name) {
    // WebSocket board model is exact and live; prefer it, but keep the estimate
    // running and log any divergence (the migration oracle).
    if (wsBoard && __cstBoard.ready(wsBoard)) {
      const color = wsColorOf(name);
      if (color != null) {
        const ws = __cstBoard.blockedLossOf(wsBoard, color);
        const est = estimateBlockLoss(name);
        if (ws !== est) try { console.debug('[CST] ⛔ oracle: WS', ws, 'vs est', est, 'for', name); } catch (e) {}
        return ws;
      }
    }
    return estimateBlockLoss(name);
  }
```

Rename the EXISTING body of `blockLossOf` to a new `estimateBlockLoss(name)` (the endgameBlocked check + the differential loop stay exactly as they are, just under the new name). Add the color lookup helper near it:

```js
  // Map our player name → colonist's WS player color (from the full state).
  function wsColorOf(name) {
    if (!wsBoard) return null;
    for (const k of Object.keys(wsBoard.colorToName)) {
      if (wsBoard.colorToName[k] === name) return parseInt(k, 10);
    }
    return null;
  }
```

- [ ] **Step 4: Load `board.js` before `content.js` + bump version.** In `manifest.json`, change the second content-script `js` to `["board.js", "content.js"]` and `"version"` to `"1.46.0"`:

```json
    {
      "matches": ["*://colonist.io/*", "*://*.colonist.io/*"],
      "js": ["board.js", "content.js"],
      "run_at": "document_idle"
    }
```

- [ ] **Step 5: Validate + full suite still green.**

`node -e "const m=require('fs').readFileSync('colonist-stats-tracker/manifest.json','utf8'); JSON.parse(m); console.log('manifest', JSON.parse(m).version, JSON.parse(m).content_scripts[1].js)"`
`node --check colonist-stats-tracker/content.js && node --check colonist-stats-tracker/board.js && node --check colonist-stats-tracker/ws-inspector.js`
`node --test tests/*.test.js`   (expect 218 green — content.js refactor must not break existing block-loss tests)

---

## Task 4: CHANGELOG + live verification + commit

**Files:** Modify `CHANGELOG.md`; then verify live; then commit.

- [ ] **Step 1: CHANGELOG 1.46.0** — add as the first bullet under the colonist `### Added`:

```markdown
- colonist-stats-tracker (1.46.0): **live, exact ⛔ from the WebSocket board model.** A new pure `board.js` reconstructs colonist's full game model from the WS (`id=130`: the `type=4` opening snapshot + `type=91` diffs) — tiles (resource + dice number), corners, buildings, and the robber — using the verified corner↔tile adjacency (`z=0 → (x,y),(x,y−1),(x+1,y−1)`; `z=1 → (x,y),(x+1,y),(x+1,y−1)`). It accrues blocked-loss live: on a roll of N, if the robber sits on a number-N tile, each adjacent building loses 1 (settlement) / 2 (city). The panel's ⛔ now uses this exact value in-game (not just at game end); the previous log estimate keeps running as an oracle and logs any divergence. `ws-inspector.js` relays `id=130` to the content script. +9 tests (218 suite).
```

- [ ] **Step 2: Live verification (Stan).** Reload the extension + F5 a game; play. Console should stay quiet of `⛔ oracle` mismatches once buildings/robber settle. After a robber blocks a tile you build on and that number rolls, the panel ⛔ should tick up live (not wait for game end), and at game end must match colonist's Victory `stat_resource_income_blocked`. Capture one production roll to confirm `resId↔resource`.

- [ ] **Step 3: Commit 1.46.0 (on Stan's go).**

```bash
cd /c/Users/stans/Projects/chrome-extensions
git add colonist-stats-tracker/board.js colonist-stats-tracker/ws-inspector.js \
        colonist-stats-tracker/content.js colonist-stats-tracker/manifest.json \
        tests/board.test.js CHANGELOG.md \
        docs/superpowers/specs/2026-06-19-colonist-ws-board-model-design.md \
        docs/superpowers/plans/2026-06-19-colonist-ws-board-model.md
git commit -m "feat(colonist-stats-tracker): 1.46.0 — live exact blocked-loss from WS board model"
```

---

## Notes
- **`board.js` is loaded in the content (isolated) world**, sharing `window.__cstBoard` with `content.js` (same isolated world). The relay crosses MAIN→isolated via `window.postMessage`.
- **Commit gated on Stan.** Per-feature commit (1.46.0 is the first cleanly-isolated feature since the 1.36–1.45 batch).
- If `console.debug('[CST] ⛔ oracle ...')` shows persistent mismatches, the WS value is authoritative — investigate the estimate or the resId map, not board.js (validated against colonist's endgame table).
