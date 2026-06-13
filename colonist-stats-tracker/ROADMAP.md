# Colonist.io Stats Tracker — Roadmap

Non-urgent ideas to revisit later. Nothing here blocks the current release, and this
file is excluded from the packaged `.zip`.

## Status

- **Chrome Web Store：** 已提交上架，正在等待審查。

## Planned

### Use colonist's own dice artwork for the dice-face view
The digit ⇄ dice toggle currently draws its **own** SVG dice (rounded face + a light
gradient sheen + real pips, with the 1 and 4 pips in red, Asian-dice style). A nice
consistency win would be to use **colonist's real dice images** instead, so the panel
matches the board exactly.

Approach (in-game, self-healing — mirrors how the resource-card art is already handled):

- When a roll message is parsed, cache each die image's live `src` into a `DICE_ICON`
  map. The URLs carry a per-deploy content hash (e.g. `dice_3.<hash>.svg`), so they
  must be read from the live game log, not hard-coded.
- Render the cached image when available; **fall back to the built-in SVG dice**
  otherwise.

Why it's deferred: colonist's real dice assets aren't available in every context — the
static `preview.html`, before the first roll of a game, or right after a colonist
redeploy changes the hash (404). So the robust default must stay the self-drawn dice;
the real-image path is an enhancement layered on top, not a replacement.

## Minor polish (low priority, TBD)

### Observed candidates (surfaced during code review — optional)

- **Dice-pip legibility at very small widths.** The dice faces are em-sized, so at the
  narrow/small preset the pips get small. It's fine in the large preset (where auto-mode
  shows dice); only relevant if dice are ever *manually* forced on a narrow panel.
- **Rapid double-click on the value toggle isn't fully serialised.** It always settles
  on the correct mode; only the in-between frame can flicker. A generation token would
  make it bullet-proof if it ever becomes noticeable.

## Shipped from this roadmap

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

### Cross-game aggregation ("your luck over time")
Per-game history (v1.14.0) stores the raw records; an aggregation view could sit
on top: dice-distribution across all your games, win rate, average income,
biggest nemesis (who steals from you the most). Viewer: popup or a dedicated
page. To brainstorm when enough games have accumulated.

### Deferred refinements from shipped features
- **selfName heuristic in multi-human games.** The local player is inferred as
  "the first coloured name whose message avatar is `icon_player.svg`" — solid
  in bot games, but another human with the default avatar could be misread as
  self, which would mis-attribute "(stole) from you" events. Worth verifying in
  a multi-human game; a better anchor might be colonist's own profile/header
  element if it exposes the username.
- Ghost mode (v1.15.0) uses a size+class heuristic to spot colonist dialogs; if
  a dialog ever fails to trigger it (or something triggers it falsely), capture
  that element's DOM so the selector can be pinned exactly.
- Expand-on-first-roll for spectators (lifecycle currently expands on game
  detection).
- Automatic gap-detection trigger for the deep re-sync (currently manual via 🔄).
- Per-player "blocked" attribution: the blocked log line names the tile but not
  its owners; attributing blocked yields to players would need board tracking
  from initial-placement messages — probably overkill.
- History viewer niceties: dice-histogram preview per game, CSV export, a panel
  tab as an alternative to the popup.
