# Colonist WS Resource-Hands Migration — Design

**Date:** 2026-06-19
**Status:** Approved (scope + opponent decision), → plan/implement
**Sub-project 3 of:** the WS migration. Builds on `board.js` (1.46.0).

## Goal

Move the **Resources table (player hands)** onto the WebSocket:
- **Self:** exact per-resource breakdown from the WS (no more DOM hand-strip scrape, no phantom unknowns). resId confirmed: `1=lumber, 2=brick, 3=wool, 4=grain, 5=ore`.
- **Opponents:** keep the log-inferred breakdown (the WS hides their card *types* — all zeros), but reconcile each opponent's **total** to the WS count (replacing the DOM-panel reconcile). [Stan's choice.]

Log keeps running as the oracle / fallback (when the WS board isn't ready).

## WS source

`playerStates."<color>".resourceCards.cards` (full snapshot in `type=4`, replaced wholesale in `type=91` diffs):
- self → a real resId array, e.g. `[5,3,1,5,4,1,1,5]` (length = hand size, values = resources).
- opponents → all zeros, e.g. `[0,0,0,0,0,0]` (length = count, types hidden).

## board.js additions (pure)

- Track `b.hands[color] = { cards: [...] }` in `applyFullState` and `applyDiff`.
- `handCountOf(b, color)` → `cards.length` (or null if unknown).
- `handBreakdownOf(b, color)` → resId-keyed counts `{1:n,…,5:n}` when the cards are revealed (any value > 0 = self's real hand); `null` when all-zero (opponent, hidden).

## content.js integration

- `syncFromWS()`: when `board.ready()`, for each tracked player mapped to a WS color:
  - revealed hand (`handBreakdownOf` non-null) → set `p.resources` exactly (resId→name via `RESOURCES[resId-1]`), `unknown = 0`.
  - else (`handCountOf` non-null) → `reconcileTotal(p, count)` (keep the log-inferred breakdown, fix the total).
- The PLAYING tick prefers `syncFromWS()` when the board is ready, else falls back to `syncFromPanel()` (today's DOM path, which keeps `readSelfHand`/panel reconcile as the fallback).

## Testing

- `board.js`: `handCountOf` / `handBreakdownOf` for a revealed self hand and an all-zero opponent (pure).
- Integration: with `board.js` wired into the test setup (`global.__cstBoard`), dispatch a `window` `message` (the relay shape) carrying a `type=4` snapshot, then assert `syncFromWS()` sets self's exact breakdown (unknown 0) and reconciles an opponent's total. Existing 221 tests must stay green (board not-ready → fallback unchanged).

## Versioning

- **1.48.0**. Dice-histogram and the Stats tally columns (steals/trades/mono via the now-known event catalog) are later sub-projects.
