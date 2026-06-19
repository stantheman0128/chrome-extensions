# Colonist WS Board Model + Live Exact ⛔ — Design

**Date:** 2026-06-19
**Status:** Approved (direction), pending spec review → implementation plan
**Sub-project 2 of:** "migrate to the WebSocket as the source of truth" (incremental,
log kept as a validation oracle; this is the first migrated signal).
**Builds on:** the 1.45.0 WS inspector (`msgpack.js`, `ws-inspector.js`) and the
protocol notes in memory `colonist_ws_protocol.md`.

## Context & Goal

colonist's WebSocket carries the complete game model. The opening message
(`id=130`, `type=4`) is a full snapshot: every tile (`tileHexStates`: resource
`type` + `diceNumber` + axial `x,y`), every corner (`tileCornerStates`: `x,y,z`),
the robber tile (`mechanicRobberState.locationTileIndex`), players, banks, etc.
Subsequent `type=91` messages are state **diffs** (a building appears as
`mapState.tileCornerStates."<i>" = {owner, buildingType}`; the robber moves via
`mechanicRobberState`; rolls via `diceState` / `gameLogState`).

This lets us compute **⛔ Cards blocked exactly, live**, which the chat log never
could (the board is canvas-only). It also stands up a reusable **board model**
that later WS migrations (robber display, live production, …) consume.

## Scope

**In:**
- A relay from the main-world tap to the content script for `id=130` frames.
- `board.js` — a pure module that builds/maintains the game model from the full
  state + diffs, and computes per-player blocked-loss live.
- The corner↔tile adjacency (formula below).
- Wiring `board.js`'s blocked-loss into the panel's ⛔, with the existing
  log/endgame ⛔ kept running as an **oracle** (compared, logged on mismatch).

**Out (later sub-projects):**
- Migrating any other signal (dice, builds, steals, trades, dev cards, hands) off
  the log. The log stays the source for everything except ⛔ for now.
- Removing the log system. Not until each signal is migrated + validated.
- Robber-position display, live production overlay, etc. (board.js enables them;
  they're separate features/versions.)

## Corner ↔ tile adjacency (the crux — derived & verified)

colonist hexes use axial coords; neighbours of `(x,y)` are at offsets
`(±1,0),(0,±1),(+1,−1),(−1,+1)`. A corner `(x,y,z)` (z ∈ {0,1}) touches up to
three tiles:

```
z = 0 → (x, y), (x, y−1), (x+1, y−1)
z = 1 → (x, y), (x+1, y), (x+1, y−1)
```

Keep only coords present in `tileHexStates` (edge/coast corners touch 1–2 tiles).

Verified against the captured opening board:
- Centre hex `(0,0)` ⇒ its six corners `(0,0,0)(0,1,0)(−1,1,0)(0,0,1)(−1,0,1)(−1,1,1)`
  — all six exist in `tileCornerStates` (indices 48/52/50/51/14/18).
- A real build at corner 23 `(0,1,1)` ⇒ tiles `(0,1),(1,1),(1,0)` — all real.
- Coast corner 0 `(0,−2,0)` ⇒ only tile `(0,−2)` is real — correct (board edge).

Implementation derives `tilesOfCorner(cornerIdx)` from this and precomputes the
inverse `cornersOfTile(tileIdx)`. Final confirmation: production events (a roll
that pays a player) must only pay players with buildings on `cornersOfTile` of a
matching-number tile — asserted in tests against captured data.

## Architecture

1. **`ws-inspector.js` (main world) — add a relay.** Already decodes every frame.
   For `id=130` frames, additionally `window.postMessage({ __cstWS: 'state', msg }, '*')`
   (structured clone handles BigInt/Uint8Array). The debug ring buffer stays.
2. **`board.js` (new, pure, Node-testable).** No DOM. API:
   - `createBoard()` → fresh model.
   - `applyFullState(gameState)` — from `type=4.payload.gameState`: index tiles
     `{type, number, x, y}`, corners `{x, y, z, owner?, buildingType?}`, robber
     tile, player colors. Precompute `cornersOfTile`.
   - `applyDiff(diff)` — from `type=91.payload.diff`: merge
     `mapState.tileCornerStates` (placements), `mechanicRobberState`
     (robber), and process new `gameLogState` entries in index order
     (deduped by entry index).
   - On a new roll log entry (`text.type === 10`, `N = firstDice + secondDice`):
     if the robber's tile has number `N` (and isn't the desert), for every player
     add `Σ over cornersOfTile(robberTile) owned by that player (city ? 2 : 1)`
     to `blockedLoss[color]`. (7s never produce → skipped.)
   - `blockedLossOf(color)` → number; `robberTile()`, `tilesOfCorner(i)` exposed
     for tests/future use.
   - `ready()` → false until a full state has been applied (so consumers can fall
     back while only diffs have arrived, e.g. a mid-game attach with no snapshot).
3. **content.js — integrate.** Listen for `__cstWS:'state'` messages, route
   `type=4`→`applyFullState`, `type=91`→`applyDiff`. Map WS player `color` → our
   player name (via `playerUserStates` username↔color). When `board.ready()`, the
   panel's ⛔ shows `board.blockedLossOf(color)`; otherwise it shows today's
   estimate. The existing log/endgame ⛔ keeps computing — on divergence, log a
   one-line `console.debug` (the oracle check) but trust the WS value for display.

## Resource id mapping

`tileHexStates.type` and card `resId` are 1–5 (0 = desert). The blocked-loss
*count* doesn't need names, but the per-resource hover does. Assume the standard
colonist order `1=lumber, 2=brick, 3=wool, 4=grain, 5=ore` and **confirm with one
captured production event** (roll on a known-type tile → which card id is paid);
correct the table if wrong. Tracked as a verification step, not a guess shipped
blind.

## Validation (the oracle)

Two free oracles confirm correctness without guessing:
1. **Endgame table (1.44):** at game end, `board.blockedLossOf` must equal
   colonist's `stat_resource_income_blocked` (which we already read). Logged.
2. **Live log estimate:** runs in parallel; large persistent divergence is a
   signal to investigate (expected: WS exact ≥ log estimate accuracy).

## Testing

`board.js` is pure → TDD against the real captured data:
- `applyFullState` on the captured `type=4` indexes 19 tiles, 54 corners, robber
  on tile 6 (desert), self = color 1.
- `tilesOfCorner` matches the three verified cases above (centre-hex corners,
  corner 23, coast corner 0).
- `applyDiff` with a building diff (`tileCornerStates."23"={owner:1,buildingType:1}`)
  records the placement; `cornersOfTile` of each adjacent tile now includes 23.
- Blocked-loss: synthetic sequence — robber moved onto a numbered tile a player
  builds on, then a roll of that number → `blockedLossOf` increments by the right
  count (settlement 1, city 2); a roll of a *different* number, or a 7, adds 0;
  a second numbered tile sharing the number but without the robber adds 0.
- `ready()` is false before any full state, true after.

The relay + content wiring is browser glue, verified live (Stan): reload, play,
confirm the panel ⛔ tracks live and matches colonist's endgame value.

## Versioning

- **1.46.0** — board model + live exact ⛔ (this spec).
- Later consumers (robber display, etc.) are their own versions.

## Risks & mitigations

- **No full state on a mid-game attach** → `ready()` false → fall back to the
  estimate until colonist sends a snapshot (it does on (re)connect).
- **Adjacency formula wrong on an edge case** → tests assert against real data +
  the production-event and endgame oracles catch it.
- **resId/type order wrong** → confirmed by a captured production event before
  shipping the hover.
- **Protocol change** → board.ready() goes false / values stop matching the
  oracle → ⛔ falls back to the estimate; we notice via the oracle log. (This is
  exactly why the log stays — the safety net for the migration.)
- **postMessage flooding** → relay only `id=130` (not the 1/sec heartbeat).
