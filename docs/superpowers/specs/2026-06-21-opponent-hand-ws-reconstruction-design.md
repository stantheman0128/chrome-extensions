# Opponent hand reconstruction from the WebSocket — design

**Date:** 2026-06-21
**Component:** colonist-stats-tracker (`board.js`, `content.js`)
**Status:** approved, ready for plan

## Goal

Reconstruct every player's per-resource hand breakdown purely from colonist's
structured WS game log (`gameLogState`), so the opponent breakdown becomes
**reload-proof** (rebuilt from the reconnect snapshot's full history, no DOM, no
transient "unknown" cards after a refresh) and **DOM-independent**.

Today the opponent breakdown is inferred from the virtualised DOM chat log. It
works but: (a) after a reload it shows transient unknowns until you scroll the log
to re-mount the rows that fill them in; (b) it inherits every DOM fragility
(virtualisation, empty-shell rows, container swaps).

## Non-goals

- Self's hand — already exact from the WS (`handBreakdownOf`); unchanged.
- ⛔ blocked-loss — stays on the proven log-estimate + Victory path (the WS board
  ⛔ accrual is shelved as unreliable; separate concern).
- Dice / turn-time — stay on the current path (migrating them adds no value).

## Scope

2/3/4-player games. Everything is exactly reconstructable EXCEPT opponent-vs-
opponent knight steals (the stolen card is masked from us — `type 16`), which
inject `unknown`. That's the same fundamental limit the DOM has; it degrades
gracefully (see the safety net).

## Architecture

A per-colour reconstructed hand lives in `board.js`:

```
b.handRecon[color] = { 1:n, 2:n, 3:n, 4:n, 5:n, unknown:n }   // resId 1..5
```

- Updated by `accrueLog` as each `gameLogState` entry is processed (deduped by the
  monotonic index, same as the existing stats accrual).
- **Reload-proof for free:** on reconnect, `applyFullState` replays the WHOLE
  `gameLogState` history (`accrueLog(..., false)`), so `handRecon` rebuilds from
  scratch deterministically. No DOM, no persist-debounce gap, no transient unknowns.
- **Safety net — reconcile to the authoritative total:** colonist always gives us
  each player's true card COUNT (`handCountOf`, the masked `cards` array length).
  After processing a diff/full-state, reconcile every colour's `known_sum + unknown`
  against `handCountOf`:
  - `total > sum` → `unknown += total - sum` (an untracked gain, e.g. a masked event)
  - `total < sum` → remove `sum - total`: from `unknown` first, then the largest
    known resource (heuristic for an untracked loss)

  This is the SAME logic as content.js's existing `reconcileTotal`. It means any
  event we don't (or can't) track in detail degrades to `unknown` / remove-largest
  rather than corrupting the composition silently.

## Event → hand effect (the catalog, pinned from a captured 4-player game)

resId: 1=lumber, 2=brick, 3=wool, 4=grain, 5=ore.

| `text.type` | who | effect | known? |
|---|---|---|---|
| `47` production | `playerColor` | **+** `cardsToBroadcast` | exact |
| `21` Year of Plenty | `playerColor` | **+** `cardEnums` | exact |
| `86` monopoly | taker `playerColor` / each victim | taker **+**`amountStolen`×`cardEnum`; each victim **−** their held count of `cardEnum` | exact |
| `116` bank/port trade | `playerColor` | **−**`givenCardEnums` **+**`receivedCardEnums` | exact |
| `115` player trade | `playerColor` (offerer) / `acceptingPlayerColor` | offerer **−**given **+**received; accepter **−**received **+**given | exact |
| `55` discard | `playerColor` | **−** `cardEnums` | exact |
| `5` build | `playerColor` | **−** cost by `pieceEnum`: **0**=road(1L,1B) · **2**=settlement(1L,1B,1W,1G) · **3**=city(2G,3O) | exact |
| `14` self steals | self / victim=`playerColor` | self **+**`cardEnums`; victim **−**`cardEnums` | exact |
| `15` self robbed | thief=`playerColor` / self | thief **+**`cardEnums`; self **−**`cardEnums` | exact |
| `16` opp-vs-opp steal | `playerColorThief` / `playerColorVictim` | thief **+1 unknown**; victim **−1** (masked) | via reconcile |
| `64?` buy dev card | `playerColor` | **−**(1W,1G,1O) | UNCONFIRMED — via reconcile until pinned |

Self identity in `14/15` comes from the event's `specificRecipients[0]` (the
private-reveal recipient), not `board.selfColor` (which a reconnect can leave null —
the 1.66 fix). `16` goes to the non-involved observers, so it never double-counts
against a `14/15` for the same steal.

**Ignored (no hand effect):** `20` (dev-card PLAY — knight moves robber, YoP/mono
are their own types), `118` (trade offer, not executed), `68`/`66` (achievements),
`49` (blocked-no-produce), `1`/`44`/`2`/`45` (markers).

### The two residual unknowns

1. **`16` opp-vs-opp steal (masked):** not processed explicitly — the reconcile
   subsumes it. The thief's WS total rises by 1 with no tracked gain → reconcile
   pads `unknown`. The victim's WS total drops by 1 → reconcile removes 1 (unknown
   first, else largest known). This is exactly the right behaviour and needs no
   special case.
2. **`64?` dev-card buy (−3, type unsure):** if `type 64` is confirmed as the buy,
   deduct (1W,1G,1O) explicitly for accuracy. Until then the reconcile absorbs the
   −3 (remove-largest). Dev buys are infrequent; non-fatal either way.

## Migration strategy — monitor-first (the ⛔ lesson)

This replaces a WORKING (DOM-inferred) opponent breakdown. To avoid regressing it:

1. **Phase A — build + monitor (no display change):** add `handRecon` + the
   reconcile, and surface it in `__cstAudit` next to the current DOM breakdown
   (`recon` vs `panel` per opponent). Play several real games; confirm `recon`
   matches the DOM breakdown and the WS total, and survives reloads.
2. **Phase B — promote:** once verified, switch `syncFromWS`'s opponent branch to
   write `handRecon` into `state.players[*].resources` instead of keeping the
   DOM-inferred breakdown. The DOM path remains the fallback only while the board
   isn't ready (lobby / pre-handshake).

Display promotion is a small, reversible change gated on real-game evidence — the
same observe-then-adopt that stopped us shipping the unreliable WS ⛔.

## Testing (TDD)

`tests/hand-recon.test.js`, feed-mode against `board.js`:

- One test per event handler (47, 21, 86, 116, 115, 55, 5×{road,settlement,city},
  14, 15) asserting the per-resId delta.
- Monopoly + type-16 "deduct from current holdings": set up a known breakdown, then
  the event, assert the right resource dropped.
- Reconcile: `known_sum < total` → pads unknown; `> total` → removes unknown-first
  then largest; type-16 thief/victim via reconcile end-to-end.
- **Reload-proof:** feed a sequence as live diffs, snapshot `handRecon`; then feed
  the SAME history through a fresh `applyFullState` (reconnect) and assert identical
  `handRecon` (deterministic replay).
- Full 4-player integration: replay the captured game's events, assert each colour's
  final `handRecon` total matches `handCountOf` and known composition is consistent.
- content.js: `syncFromWS` opponent branch reads `handRecon` (Phase B), with a test
  that self is untouched (still exact) and the DOM fallback holds pre-handshake.

## To confirm during implementation (cheap, from the same sample / a follow-up)

- `type 64` = dev-card buy? (deduct 1W1G1O if so). Until confirmed → reconcile.
- Setup starting resources arrive as `type 47` (distributionType 1) — spot-check.
- City build (`pieceEnum 3`) pays city cost only, no settlement refund (standard).

## Forward compatibility

- `board.js` stays a pure module; `handRecon` is additive (existing `hands`,
  `wsStats`, `blockedLoss` untouched).
- Phase A ships with zero display change; Phase B is one branch in `syncFromWS`.
- Reconcile reuses the existing total-reconcile semantics, so behaviour matches the
  DOM path's unknown handling — no surprise to popup/persistence.
