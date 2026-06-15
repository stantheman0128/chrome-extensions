# Colonist.io Stats Tracker — Roadmap

Non-urgent ideas to revisit later. Nothing here blocks the current release, and this
file is excluded from the packaged `.zip`.

## Status

- **Chrome Web Store：** 已提交上架，正在等待審查。

## Planned

_(nothing queued — see "Shipped from this roadmap" and "Candidate features" below)_

## Minor polish (low priority, TBD)

### Observed candidates (surfaced during code review — optional)

- **Dice-pip legibility at very small widths.** The dice faces are em-sized, so at the
  narrow/small preset the pips get small. It's fine in the large preset (where auto-mode
  shows dice); only relevant if dice are ever *manually* forced on a narrow panel.
- **Rapid double-click on the value toggle isn't fully serialised.** It always settles
  on the correct mode; only the in-between frame can flicker. A generation token would
  make it bullet-proof if it ever becomes noticeable.

### Deferred from the v1.35.0 code review (real, but needs a test + manual verify)

These were verified real but NOT shipped in 1.35.0 because each needs more than a
surgical edit (new test coverage and/or live-browser verification):

- **Skip rebuilding collapsed sections' innerHTML in `render()`.** A real saving
  (the dice + resources HTML are rebuilt into zero-height containers on every log
  event even when collapsed), but it needs a "dirty flag" plus a refresh wired into
  both expand paths (the fold handler and `setPanelCollapsed`), and a new
  collapsed→expanded test — otherwise expanding shows stale data.
- **`boardHidden()` early-break.** Stop the 5-point hit-test loop on the first
  canvas hit (the common "board visible" case). Logically sound, but `boardHidden`
  has no test coverage (needs a real browser), so it needs manual verification that
  overlays still collapse the panel.

Checked and intentionally NOT changed: the bare "won the game" winner-substring
(the only test-safe tightening is a no-op in practice); the broad `dialogOverlapping`
selector (its `getComputedStyle` ordering is already optimal and narrowing the
selector risks missing a per-deploy colonist dialog class). A "collapse the 3
per-tick player-panel scans" idea was a false positive — there are only 2 and they
can't share a result.

## Shipped from this roadmap

### v1.35.0 (2026-06-15)
- **Internal cleanup + hot-path efficiency (no behaviour change).** A 5-dimension
  code review (each finding adversarially re-verified against the real code)
  surfaced 14 safe, behaviour-preserving wins; all shipped together, 160 tests
  still green. Highlights:
  - **Perf:** the 1 s tick now skips the full log re-scan + panel reconcile once
    the game has ENDED or in the lobby (it only ever mattered during play;
    `attachObserver` stays outside the gate so "play again" is still detected) —
    the largest sustained per-tick cost. `settingsOpen()` is probed once per
    posture pass (was twice). `renderStatsView` derives each player's block-loss
    once. `rollHistory` is capped at 256 (bounds memory + the persisted blob).
  - **DRY / dead code:** removed the never-called `newGameReset` and the
    redundant `CARDS_GRID`/`STATS_GRID` aliases (both were just `TABLE_GRID`, and
    invited a future split that would reintroduce the tab-switch height jump).
    Extracted shared helpers `zeroResources()`, `takeLargestKnown()`,
    `rectsOverlap()`, `setGameSig()` for logic that was hand-written 2–4× each.
  - **Defensive:** an executed-trade line with only one coloured participant can
    no longer fall through to the gain branch and double-count.
  - **Consistency:** fixed the stale `state.tally` field-list comment; unified
    the Monopoly violet with the stats-column violet.

### v1.34.0 (2026-06-15)
- **Robber-blocked card loss (raised by Stan)** — new ⛔ Stats column showing the
  cards you *would* have collected but lost to the robber sitting on a tile you
  build on. Pure log-derived (colonist's board is a canvas — no geometry to read):
  each player's per-number yield is learned from clean (un-blocked) rolls, and loss
  is the **derived** sum `blocked-count × your yield for that number+resource`, so a
  tile blocked before its number warmed up is credited retroactively (backfill is
  automatic). Honest floor: a tile never once rolled clean stays uncredited. The
  hover breaks it down per `N res ×times = cards`. Replaces the ⚔️ "cards stolen"
  column (which only mirrored 💔 "cards lost" — same cards, opposite side; redundant
  in 2-player games). The lifetime popup aggregates block-loss too.
- **Drag-reorder columns (raised by Stan)** — both the Resources and Stats tables
  reorder by dragging a column's **header icon** (4px threshold to start; the whole
  column slides live; release to drop). Order persists per view and resets with
  "Restore defaults". `reconcileOrder()` keeps saved orders forward-compatible when
  columns are added/removed across versions.

### v1.33.0 (2026-06-15)
- **Snappier collapse/fade reaction (raised by Stan)** — the lag was the 250 ms
  leading-edge throttle on the posture/ghost checks, not slow computation.
  Replaced with an ~80 ms trailing throttle (isolated change reacts immediately,
  bursts coalesce) plus two cost trims (`boardHidden` skips its peek-under recalc
  unless the panel is over a sample point; `updateGhost` short-circuits while
  collapsed). If the collapse/expand still feels slow, the next lever is the
  0.25 s CSS transition in `setPanelCollapsed`.

### v1.32.0 (2026-06-15)
- **Settings-menu fade restored (1.31.0 regression, raised by Stan)** — a
  dialog/menu that overlaps the panel without hiding the board centre fades
  again. Full-screen views collapse (board-posture); ghost mode fades only the
  partial-overlap case, and only while the panel is still open (posture runs
  before ghost each tick, so a collapsed panel is never also faded). Tier choice
  is the pure `ghostKind()`.

### v1.31.0 (2026-06-15)
- **Generic "colonist took over the screen" collapse (raised by Stan)** — the
  panel collapses for ANY full-screen colonist view (Settings, Leave Game,
  Pause/Resume, end screen), not just Settings. Detected class-agnostically by
  whether the live board `<canvas>` is still at the viewport centre
  (`boardHidden()`), since the max-z panel is always on top of colonist's UI.
  Replaces the old class-matching dialog ghost tier (removed); trade ghost stays.

### v1.30.0 (2026-06-14)
- **Cross-game aggregation ("your luck over time")** — a lifetime-stats block
  atop the popup history: games + win rate, an 11-bar lifetime dice histogram
  with a ⚖️ χ² fairness verdict, your avg income / turn time / steals-losses per
  game, and avg game length. Pure `aggregate()` over the stored records, unit-
  tested. Per-opponent "nemesis" intentionally omitted (opponents vary per game).

### v1.29.0 (2026-06-14)
- **Real dice artwork for the dice-face view** — colonist's actual dice images,
  cached self-healing from the roll log (`DICE_ICON`, per-deploy hash read live),
  with the built-in SVG dice as the fallback for any face not yet seen
  (preview.html / pre-first-roll / post-redeploy 404).

### v1.28.0 (2026-06-14)
- **Settings detection fixed for real (evidence from Stan)** — colonist keeps the
  `gameSettingsContainer` shell mounted/visible and only fills it with content
  when open; detection now checks `children.length` (0 = closed). Earlier
  opacity/ancestor guesses removed.
- **Discard limit without opening Settings** — headcount rule (2p→10, else 7),
  upgraded to colonist's exact value and cached whenever Settings is opened.

### v1.27.1 (2026-06-14)
- **No first-roll jump (raised by Stan)** — the recent-rolls strip now reserves
  its row height (blank placeholder) before any roll, so the panel doesn't shift
  when the first chip appears.

### v1.27.0 (2026-06-14)
- **Reliable self-detection (evidence from Stan)** — read the local player from
  the player panel (your row has `playerRow…` but not `opponentPlayerRow…`),
  replacing the avatar guess that mis-tagged opponents as self in multi-human
  games and caused "stole from self / to self" steal paths. Resolves 3(b).

### v1.26.0 (2026-06-14)
- **Knights vs Monopoly split (raised by Stan)** — ⚔️/💔 count knight/robber
  steals only (1 card each = "times robbed"); Monopoly tracked separately
  (`monoTook`/`monoLost`) and shown on its own 🎺 line.
- **Cards-lost hover** — "stolen by {who} ×N" + Monopoly lines + a 7s footer
  (count + per-roller), backed by new per-roller 7 tracking.

### v1.25.0 (2026-06-14)
- **Settings auto-collapse fixed (evidence from Stan)** — colonist keeps the
  Settings modal mounted and hides it via a parent `opacity:0`; detection now
  walks ancestors (`deepVisible`) so the open/close edge fires.
- **Discard limit auto-detect** — read colonist's Card Discard Limit from the
  Settings DOM (7 @ 4p, 10 @ 2p) and drive the hand-total risk badge off it.

### v1.24.0 (2026-06-14)
- **Edge resize = width only (raised by Stan)** — left/right edges change width
  without zooming (corner still zooms); held text size baked into fontScale.
- **Dice fairness badge** — ⚖️ fair/skewed/very-skewed colour badge replacing the
  raw χ² number (value + scale in the hover).
- **Settings detection hardened** — require the container to occupy the viewport.

### v1.23.0 (2026-06-13)
- **Settings auto-collapse (raised by Stan)** — detect colonist's full-page
  Settings (`gameSettingsContainer…`) and collapse the dashboard to the dice icon
  while it's open, restoring on close (respecting a user's prior manual collapse).

### v1.22.5 (2026-06-13)
- **Trade ghost edge fix (raised by Stan)** — keyed trade detection off the trade
  creator's open-only parts (`tradeCreatorProposal/Actions`) instead of any
  `[class*="trade"]`, so the always-present bottom bar / offers reserve no longer
  masks the pop-out edge when the panel is parked over the bar.

### v1.22.4 (2026-06-13)
- **Ghost opacity unified (raised by Stan)** — both tiers now fade to 0.18 (the
  average of the old 0.05 dialog / 0.3 trade), so the dim is consistent.

### v1.22.3 (2026-06-13)
- **Ghost tweaks (raised by Stan)** — both ghost tiers click-through again so the
  trade UI / dialog behind the faded panel is clickable (edge-trigger keeps the
  manual-drag case un-faded + grabbable); Settings/dialog opacity 0.12 → 0.05.

### v1.22.2 (2026-06-13)
- **Polish (raised by Stan)** — value columns pinned to strictly equal width via
  `minmax(0, 0.8fr)` (a bare `0.8fr` let wide content like `1:05` bulge a
  column); hand-total badge nudged left (7px right margin) off the next column's
  hover glow.

### v1.22.1 (2026-06-13)
- **Bugfix (raised by Stan)** — Player column was a different width in Resources
  vs Stats (6th-column grid tweak shrank the Stats name track); unified both to
  one `TABLE_GRID` and made the switch animate only the value cells, leaving the
  Player column still.

### v1.22.0 (2026-06-13)
- **① Luck meter (chi-square)** — full version: χ² goodness-of-fit in the dice
  header (idea pool #1 now fully shipped).
- **③ Turn-time stats** — ⏱ Stats column, avg per player from live roll gaps
  (idea pool #3).
- **④ Trade-flow matrix** — 🤝 Stats column + per-opponent gave/got hover
  (idea pool #4).

### v1.21.0 (2026-06-13)
- **Bugfix — snake-draft pivot float**: the first player to receive starting
  resources (last in round 1 / first in round 2) now shows the `+N` gain float
  like everyone else.
- **Trade ghost edge-trigger** (raised by Stan): fade only when the trade UI
  appears over a still panel, not when the panel is dragged onto it; light tier
  stays grabbable.

### v1.20.0 (2026-06-13)
- **Dice drought spotlight** (idea pool #1, reframed): instead of a chi-square
  luck score, the dice header flags the *single most overdue* producing sum,
  probability-weighted (`rollsSince / expectedGap`), so 6/8 surface before 2/12.
- **C keyboard shortcut** (raised by Stan): collapse / expand the whole panel.

### v1.19.0 (2026-06-13)
- **Discard-risk highlight** (idea pool #2): hand-total badge turns terracotta at
  8+ cards.
- **Trade-aware light ghost** (raised by Stan): the trade UI overlapping the
  panel triggers a milder opacity-.3 ghost (dialogs keep the full .12).
- **R/S keyboard view shortcuts** (raised by Stan): R → Resources, S → Stats.
- **Source-explicit stat tooltips**: ⚔️/💔 note robber/knight/Monopoly, 🗑️ notes
  the rolled-7 rule.

### v1.11.0 – v1.14.0 batch (2026-06-12)
- **v1.11.0 — UI polish:** floating `+N`/`−N` card-gain effect (raised
  2026-06-09); the large⇄small toggle animates (one-shot transition); the
  two-stage expand-from-collapsed glitch fixed (target height pre-measured with
  transitions off).
- **v1.12.0 — recent-roll sequence:** last-12-rolls strip above the histogram.
- **v1.13.0 — live in-game stats:** Stats section (steal matrix ⚔️/💔 with
  per-opponent hover breakdown, discards, income, dev cards) + robber-blocked
  counter from the "tile is blocked by the Robber" log line (the former Tier-2
  open question — the log DOES record it). Also fixed the "X stole [res] from
  you" Monopoly-branch misparse that zeroed other players' piles.
- **v1.14.0 — per-game history:** finished games archived to
  `chrome.storage.local` on the winner line (last 50), with a 對局紀錄 list +
  JSON export in the popup.

### Game-lifecycle automation (v1.10.0, 2026-06-12)
Three former candidates shipped together as one lifecycle state machine
(lobby / playing / ended) — design in
`docs/superpowers/specs/2026-06-12-colonist-game-lifecycle-design.md`:

- **Auto-collapse / auto-expand by page context** — collapsed on home/lobby,
  expands on game detection. Edge-triggered only, so manual overrides stick
  until the next transition (no "pin" toggle needed).
- **Game state reset + game clock** — stats wipe + `⏱ m:ss` header timer on new
  game (rematch with the same players included); winner line ("X won the
  game!") collapses the panel and freezes the clock.
- **Disconnect & refresh accuracy** — localStorage persistence (Strategy A) was
  already live; the 🔄 button is now a **deep re-sync** that scrolls the virtual
  log to the top and re-reads every message in order (Strategy B, manual).

Deferred refinements, if ever wanted: expand-on-first-roll for spectators; an
automatic gap-detection trigger for the deep re-sync.

## Candidate features (to brainstorm)

Ideas raised but not yet designed — each needs its own brainstorm → design pass.

### Idea pool (brainstormed 2026-06-12 — none committed)
Sorted roughly by value-per-effort; all build on data we already collect:

1. ~~**Luck meter (chi-square).**~~ Shipped in two parts: the probability-weighted
   drought spotlight (v1.20.0) and the full χ² goodness-of-fit score (v1.22.0).
2. ~~**Discard-risk highlight.**~~ Shipped in v1.19.0.
3. ~~**Turn-time stats.**~~ Shipped in v1.22.0 (⏱ Stats column).
4. ~~**Trade-flow matrix.**~~ Shipped in v1.22.0 (🤝 Stats column + gave/got hover).
5. **Share card.** Export the end-of-game stats as an image for chat bragging.

### ~~Cross-game aggregation ("your luck over time")~~ — shipped v1.30.0
Shipped as a lifetime-stats block atop the popup (games + win rate, lifetime dice
histogram + χ² fairness, avg income / turn / steals-losses per game, avg game
length). "Biggest nemesis" was intentionally dropped — the opponents differ from
game to game, so aggregating their names is noise. Possible follow-ups if wanted:
a CSV export of the aggregated numbers, or a dice-fairness trend over time.

### Deferred refinements from shipped features
- ~~**selfName heuristic in multi-human games.**~~ Resolved in v1.27.0: the local
  player is read from the player panel (the row with `playerRow…` but not
  `opponentPlayerRow…`) instead of the avatar guess. The avatar remains a
  fallback only before the panel mounts.
- Ghost / posture split (v1.31.0 + v1.32.0): full-screen colonist views COLLAPSE
  the panel via the class-agnostic board-canvas signal (`boardHidden()`); a
  dialog/menu or the trade creator that overlaps the panel without hiding the
  board centre FADES it (`dialogOverlapping` + `tradeOverlapping`, tier chosen by
  `ghostKind`). The dialog fade still uses a class+geometry heuristic, so if a
  *new* menu type ever fails to fade, capture its DOM to extend the selector.
- Expand-on-first-roll for spectators (lifecycle currently expands on game
  detection).
- Automatic gap-detection trigger for the deep re-sync (currently manual via 🔄).
- Per-player "blocked" attribution: the blocked log line names the tile but not
  its owners; attributing blocked yields to players would need board tracking
  from initial-placement messages — probably overkill.
- History viewer niceties: dice-histogram preview per game, CSV export, a panel
  tab as an alternative to the popup.
