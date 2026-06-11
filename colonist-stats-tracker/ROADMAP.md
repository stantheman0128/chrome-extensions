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

### Cross-game aggregation ("your luck over time")
Per-game history (v1.14.0) stores the raw records; an aggregation view could sit
on top: dice-distribution across all your games, win rate, average income,
biggest nemesis (who steals from you the most). Viewer: popup or a dedicated
page. To brainstorm when enough games have accumulated.

### Deferred refinements from shipped features
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
