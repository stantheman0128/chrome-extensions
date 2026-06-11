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

Stan has a few small UI tweaks in mind that aren't important — to be listed and
revisited here later.

<!-- Stan: add items as they come up -->

### Observed candidates (surfaced during code review — optional)

- **Dice-pip legibility at very small widths.** The dice faces are em-sized, so at the
  narrow/small preset the pips get small. It's fine in the large preset (where auto-mode
  shows dice); only relevant if dice are ever *manually* forced on a narrow panel.
- **Rapid double-click on the value toggle isn't fully serialised.** It always settles
  on the correct mode; only the in-between frame can flicker. A generation token would
  make it bullet-proof if it ever becomes noticeable.

## Candidate features (to brainstorm)

Ideas raised but not yet designed — each needs its own brainstorm → design pass.

### Auto-collapse / auto-expand by page context
Keep the panel **collapsed by default** when the user is on the Home page or any
non-game URL (lobby, profile, leaderboard, etc.), and **auto-expand** once a live game
is detected.

Approach:
- Inspect `location.href` on each navigation; colonist.io is a SPA so listen to
  `popstate` / `pushstate` interception plus `MutationObserver` on the game container
  as a fallback.
- A URL pattern like `/game/` (or the presence of the game board DOM node) is the
  reliable signal that a game is active.
- Persist the last explicit user override (manually expanded on lobby, or manually
  collapsed mid-game) so the auto-behaviour doesn't fight user intent.

Open questions:
- Should the auto-expand fire immediately on game-load or only after the first roll is
  detected (so a spectator who just wants to watch isn't surprised)?
- Does the panel need a "stay pinned" toggle to permanently opt out of auto-collapse?

### Game state reset + elapsed-time timer
Three linked behaviours that require reliable new-game detection (ties into P2):

**(a) Auto-clear on new game.** When a new game is detected (new game ID or lobby
re-entry), wipe all accumulated roll / resource data so stale numbers from the previous
game never leak in.

**(b) Game timer.** Display a `HH:MM` counter from the moment the current game started.
Requires storing `gameStartTimestamp` in `chrome.storage.session` so it survives
`content.js` re-injection on soft navigations but resets cleanly between games.

**(c) Auto-collapse on game-end → auto-expand + auto-clear on next game start.** When
a winner is announced (the victory banner DOM node appears), collapse the panel so the
user can interact with the end-of-game screen without the overlay blocking it. When the
user starts the next game the panel re-expands and fresh data begins accumulating.

Open questions:
- What is the reliable "game over" signal? Candidate: CSS class / text on the winner
  banner, or a specific log message type in the event stream.
- Timer display location: inside the panel header, or a subtle badge on the extension
  icon?
- Should the timer persist across a page refresh (store start time) or reset on any
  reload?

### Disconnect & refresh data accuracy (log re-scrape / state persistence)
Ensure roll and resource counts stay accurate after a network disconnect, browser
refresh, or extension reload.

Two complementary strategies to brainstorm:

**Strategy A — Persist parsed state.** After every event, write the full parsed state
(`rollHistory`, resource totals, player list, etc.) to `chrome.storage.session`. On
(re)load, restore from storage before attaching the live log observer — so a refresh
only needs to catch up with events *after* the last checkpoint, not replay everything.

**Strategy B — Full log re-scrape on reconnect.** If a gap is detected (e.g. a
disconnect marker appears in the log), programmatically scroll the game log container
to the top and re-parse all visible entries from scratch. This is more expensive but
self-healing against any checkpoint corruption.
- Open question: can a `content.js` script programmatically scroll the colonist log
  panel? The DOM node is likely a `<div>` with `overflow: auto`, so `element.scrollTop
  = 0` should work — needs live verification.

Open questions:
- How do we detect that a gap exists? Watch for the colonist reconnect message in the
  log, or compare the local event count against a server-side sequence number if one is
  exposed?
- Which strategy should be primary? Strategy A is cheaper; Strategy B is more correct
  after a long disconnect. Could use A as the default and fall back to B when the gap
  is too large.

### Recent-roll sequence ("see the roll order")
A left→right strip of the last ~12 dice rolls (newest on the right; 7s flagged), so
during a turn/trade you can see the *run* of rolls — not just the frequency histogram.
**Cheap:** the data already exists — `state.rollHistory` is an ordered array (it powers
"rolls since last N"); this is purely a new display.

### Per-game history / records
Persist each finished game (dice distribution, per-player final hand, total rolls,
players, date) so past games can be reviewed and maybe aggregated across games (e.g.
"your luck over time"). Open questions for when we brainstorm it:
- where to view it — toolbar popup vs a new panel tab/section;
- what marks "a game ended" — ties into the new-game auto-detection being built now;
- how many games to keep + storage choice (localStorage vs IndexedDB);
- export (CSV / JSON)?
