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

### Floating "+1" card-gain effect *(raised 2026-06-09 — was never written down here; re-confirmed 2026-06-12)*
When a player's resource count changes, float a small game-style `+N` / `−N` over
the changed cell that drifts up and fades out (like in-game point popups).

Implementation sketch:
- Keep the previous render's per-player counts; diff on each `render()`.
- Spawn absolutely-positioned spans in the stable `#cst-res-wrap` overlay layer —
  the same trick the column-highlight overlay uses, so the floats survive
  `render()`'s innerHTML swaps.
- CSS transition `translateY(-0.8em)` + opacity over ~700 ms; remove on
  `transitionend`.
- Care: a deep re-scrape, a restore, or a new-game reset would diff from zero and
  shower the panel in floats — suppress the effect while `rescraping` and on the
  first render after restore/reset.

### Large ⇄ small toggle has no animation *(raised 2026-06-12)*
`applyPreset()` deliberately clears `transition` (live drag-resize must stay
instant) and jumps `left/top/width` in one go — so the toggle teleports.
Fix: a one-shot transition, exactly like `setPanelCollapsed` already does —
enable `left/top/width/font-size .25s ease`, apply the preset, clear the
transition on `transitionend` so dragging stays instant.

### Expand-from-collapsed looks two-stage *(raised 2026-06-12)*
Symptom: collapsing to the 🎲 is smooth, but expanding looks like it first opens
a smallish panel, then stretches out to the full size — "expands the small mode,
then expands again".

Suspected root cause (confirmed in code): in `setPanelCollapsed(false)` the
height target is `host.scrollHeight`, measured right after `style.width` is SET
but while the width is still ANIMATING from 36 px — so the measured height
belongs to an in-between (narrow) layout. The `height:auto` snap 260 ms later
then visibly corrects it.

Fix sketch: pre-measure the true target height with transitions disabled
(toggle `transition:none` → set final width → read `scrollHeight` → restore),
then animate width and height toward the correct targets together. Alternative:
animate width first, chain height on `transitionend`.

### Observed candidates (surfaced during code review — optional)

- **Dice-pip legibility at very small widths.** The dice faces are em-sized, so at the
  narrow/small preset the pips get small. It's fine in the large preset (where auto-mode
  shows dice); only relevant if dice are ever *manually* forced on a narrow panel.
- **Rapid double-click on the value toggle isn't fully serialised.** It always settles
  on the correct mode; only the in-between frame can flicker. A generation token would
  make it bullet-proof if it ever becomes noticeable.

## Shipped from this roadmap

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

### Recent-roll sequence ("see the roll order") *(re-raised 2026-06-12 — promote)*
A left→right strip of the last ~12 dice rolls (newest on the right; 7s flagged), so
during a turn/trade you can see the *run* of rolls — not just the frequency histogram.
**Cheap:** the data already exists — `state.rollHistory` is an ordered array (it powers
"rolls since last N"); this is purely a new display.

Display ideas (pick one when designing):
- a thin strip between the dice section header and the histogram (always visible);
- inside the dice tooltip dialog (zero panel space, but hidden until hover);
- a fold-out row under the histogram (own chevron, persisted like other folds).

### Live in-game stats ("don't wait for the end screen") *(raised 2026-06-12)*
colonist only shows per-game stats on the end-of-game summary. Surface the
interesting ones LIVE, mid-game. Two tiers by feasibility:

**Tier 1 — derivable from messages we already parse today** (the steal/discard/
trade branches in `processMessage` just need counters added):
- per player: cards stolen **from you** and **by whom** (thief → victim matrix);
- cards **you** stole (and what they were — colonist reveals your own steals);
- discards on 7s (count + total cards lost);
- total gained per resource (lifetime income this game);
- dev cards bought.
Data sketch: a `state.events` block (e.g. `stealsBy`, `stealsAgainst`,
`discards`, `gainedTotal` maps) incremented in the existing branches and
persisted with the rest of the state. UI: a third collapsible "Stats" section
under Resources, or an expand-per-player row — to decide when designing.

**Tier 2 — "blocked by the robber" count (被擋了幾次) — needs verification:**
the log likely does NOT record a "blocked" event (you simply don't receive
cards), and counting blocked yields requires knowing which numbered tiles each
player sits on — our parser doesn't track board geometry. Options to explore:
- (a) verify in a live game whether colonist logs anything when the robber
  blocks a yield (need a screenshot / log line);
- (b) approximate with robber events we CAN see: how often the robber was moved
  onto you + how often you were the steal victim;
- (c) full board tracking from initial-placement messages — probably overkill.

### Per-game history / records *(main blocker RESOLVED by v1.10.0)*
Persist each finished game so past games can be reviewed and aggregated across
games (e.g. "your luck over time").

**Unblocked:** "what marks a game ended" was the blocker — `onGameWon()` (the
"X won the game!" line) now gives an exact snapshot moment, and `gameStartTs` /
`gameEndTs` give the duration for free.

Design sketch:
- **Snapshot at the winner line:** `{date, duration, players, winner,
  diceCounts, rollHistory, totalRolls, per-player final hands}` — plus the live
  stats counters above if Tier 1 ships first (they compose nicely).
- **Storage: `chrome.storage.local`** — bigger quota than localStorage, survives
  site-data cleanup, and the popup can read it directly (localStorage would need
  message-passing through the content script). Needs the `storage` permission in
  the manifest (review-safe, no new host permissions). Keep last ~50 games.
- **Viewer: toolbar popup first** (a simple list: date, players, winner, your
  result, duration → tap for the dice histogram), a panel tab later if wanted.
- **Export:** JSON first (trivial), CSV later if a spreadsheet need shows up.
