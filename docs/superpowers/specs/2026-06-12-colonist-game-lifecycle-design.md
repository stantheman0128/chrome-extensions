# Colonist Stats Tracker — Game Lifecycle Design (v1.10.0)

Implements three roadmap items: auto-collapse/expand by page context, game state
reset + elapsed timer, and disconnect/refresh data accuracy (manual deep re-scrape).

## 1. Core architecture — lifecycle state machine

A three-state game lifecycle drives all automatic behaviour:

```
LOBBY ──(game detected)──▶ PLAYING ──("won the game" log msg)──▶ ENDED
  ▲            ▲                                                    │
  │            └────────────(new game detected)─────────────────────┘
  └──────────────(game DOM gone / left game)── PLAYING
```

- **Detection (URL + DOM combined):** the DOM is the authoritative signal —
  `findLogContainer()` or `readPlayerPanel()` returning results means "in game".
  The existing `lastPath` MutationObserver (URL change) triggers an immediate
  lifecycle re-evaluation instead of waiting for the next tick.
- **Evaluation cadence:** hooked into the existing 1-second `setInterval` tick in
  `boot()`. **No new timers.**

## 2. Auto-collapse / auto-expand — edge-triggered only

| Transition | Action |
|---|---|
| LOBBY → PLAYING | auto-expand + reset stats + start timer |
| PLAYING → ENDED (`won the game` in log) | auto-collapse + freeze timer |
| ENDED → PLAYING (next game) | auto-expand + reset + restart timer |
| PLAYING → LOBBY (left the game) | auto-collapse |

Automatic actions fire **once, on the transition edge only** — never re-asserted
per tick. A manual expand in the lobby or a manual collapse mid-game therefore
sticks until the next transition. No "pin" setting needed.

On boot, the initial state is evaluated from the live page: not in game →
collapsed; mid-game (refresh during a game) → expanded.

## 3. Game timer

- `state.gameStartTs` is set when a new game is detected (includes the initial
  placement phase, per Stan's choice).
- Displayed in the panel header next to the title: `⏱ 12:34` (`1:02:34` past one
  hour), updated by the existing 1-second tick.
- Persisted inside the existing `persistState()` payload → survives refresh and
  continues counting. Frozen at the final time on ENDED (`state.gameEndTs`).

## 4. Manual deep re-scrape (upgraded 🔄 resync button)

Clicking resync now:

1. Remembers the current scroll position → `resetState()` (keeping `gameSig`).
2. Scrolls the virtualScroller to the top, then steps downward (~150 ms per step
   so the virtual list can mount rows), running `scanExisting()` at each step —
   messages are processed top-to-bottom in `data-index` order, so resource
   bookkeeping stays order-correct.
3. Restores the scroll position → `syncFromPanel()` reconciliation → persist.

The old light resync is subsumed (deep re-scrape is a superset). Button title
updated accordingly. Automatic recovery continues to rely on the existing
localStorage persistence (Strategy A); the deep re-scrape is the user-controlled
safety net (Strategy B).

## 5. Game-end detection

New branch in `processMessage()`: `text.includes('won the game')` (plus Chinese
`贏得` for safety) → triggers PLAYING → ENDED. Confirmed live format:
"Bradly won the game!"; the victory/"Well Played!" screens exist but the log
message is the stable signal. Graceful degradation: if the message format ever
changes, the existing roster-change detection still clears data on the next
game — only the auto-collapse nicety is lost; data is never corrupted.

## 6. Housekeeping

- Extend the Node test-harness `module.exports` with the new lifecycle functions;
  add tests (lifecycle transitions, timer persistence, won-the-game parsing).
- `manifest.json` version → **1.10.0**.
- ROADMAP.md: move the three items out of "Candidate features".

## Error handling

- Lifecycle evaluation is defensive: missing DOM nodes mean "no signal", never a
  throw; transitions only fire on settled signals (mirrors `maybeNewGame()`'s
  one-tick settling).
- Deep re-scrape aborts cleanly if the container disappears mid-scrape (SPA nav)
  and re-runs `syncFromPanel()` so totals are still reconciled.
- Timer rendering tolerates a missing/corrupt persisted timestamp (falls back to
  hiding the timer rather than showing garbage).
