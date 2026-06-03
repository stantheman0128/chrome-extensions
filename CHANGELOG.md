# Changelog

All notable changes in this repository are documented in this file.

## [Unreleased]

## [2026-06-03]

### Added
- colonist-stats-tracker (1.5.1): the hand total (sum of a player's cards) is back, shown as a small badge next to each player's name. The player column was widened and the name switched to a flex/ellipsis layout (with the full name on hover) so longer names fit alongside the avatar and total.

### Added
- colonist-stats-tracker (1.6.0): **self-correcting counts + persistence.** (1) Each player's total is now continuously reconciled against colonist's own player-panel hand count (authoritative): a shortfall is added to the unknown pool, an excess is trimmed (unknown first, then the largest pile) — so even a missed message self-heals. (2) A 🔄 "re-sync" button re-scans the log and reconciles on demand, for when something looks off. (3) The in-progress game (players, resources, dice, seen messages) is saved to localStorage and restored on reload/reconnect, so a Chrome refresh or extension update no longer wipes the current game. A different game (no players in common with the live panel) auto-resets so stale data isn't shown.

### Fixed
- colonist-stats-tracker (1.5.2): some log messages (e.g. discards) were missed because colonist's log is a *recycling* virtual list — new messages can replace an existing row's content instead of adding a DOM node, which the MutationObserver doesn't observe. Added a 1-second safety-net re-scan of the mounted rows (de-duplicated by data-index), so a missed message is now picked up within ~1s of being on screen.

## [2026-06-02]

### Added
- colonist-stats-tracker (1.5.0): player rows now follow **colonist's own player-panel order** (read from the right sidebar via stable data-attributes), and each player's **avatar** is shown next to their name — including custom avatars (the panel's avatar `<img>` src is used as-is; default robots get a colour circle behind them). Falls back to first-seen order with no avatar if the panel can't be read.
- colonist-stats-tracker (1.4.0): a ⟳ "reset size & position" button (top-right of the header) restores the panel to its default size, position (top-left), and appearance — expanded, sections unfolded — **without touching the tracked stats**. Handy after zooming/dragging it somewhere awkward. The default opening position is now the top-left corner.
- colonist-stats-tracker (1.3.0): the unknown/stolen-cards column is now headed by colonist's own face-down "?" card art (self-healing to the live URL); section folds (Dice Rolls / Resources) animate open/closed.
- colonist-stats-tracker (1.2.0): collapse-to-icon — the ▾ control shrinks the whole panel down to a single dice icon (the 🎲 spins on the way in, and reverses on the way out); click the icon to expand. Each section (Dice Rolls, Resources) also folds independently via its title chevron, so you can show just the dice odds.
- colonist-stats-tracker (1.1.0): **Bank-remaining tracker** — a "Bank left" row shows how many of each resource are still in the supply (19 − everyone's known holdings), so you get the per-resource counts colonist only displays against bots. Marked "≈ upper bound" while any stolen/unknown cards are in play.
- colonist-stats-tracker (1.1.0): resizable panel (drag the bottom-right corner), A−/A+ text scaling, and persistence of panel position, size, scale, and minimised state across reloads (localStorage).
- `preview.html` at the repo root — a standalone, game-free preview of the panel for fast UI iteration. Open it directly in a browser.
- jsdom UI smoke test that renders the panel and asserts its structure (28 tests total).

### Changed
- colonist-stats-tracker (1.1.0): UI redesign — parchment palette tuned to colonist's beige game UI (no more near-black panel); the dice histogram is now horizontal (2 → 12 left to right) with bars that grow upward so frequency reads by height; resources use colonist's own card icons (self-healing to the live asset URLs) instead of emoji.
- colonist-stats-tracker (1.1.1): UI polish from live feedback — palette retuned to colonist's light warm-grey side panels; removed the Reset button (an accidental click wiped a whole game) and the "Live/Waiting" status line; merged the Bank row into the Resources table so each resource icon now carries a bank-remaining badge in its top-right corner, colonist-style; larger card icons; dice columns show the percentage again (rounded to 1 dp); more inner padding so the table is not edge-to-edge.
- colonist-stats-tracker (1.2.0): the panel now "zooms" by width — dragging the right edge scales the font and the now em-based icons together, so digits never overflow the icons; removed the +/- text-scale buttons (width is the single zoom control). Dice percentages are shown as whole numbers (no decimal); removed the "badge = bank left" caption (the badges are self-explanatory); approximate bank counts (when stolen/unknown cards are in play) are flagged with a leading "~" on the badge instead.
- colonist-stats-tracker (1.3.0): collapse is now triggered by clicking the 🎲 dice glyph itself (the dedicated ▾ button is gone); resizing works in both directions again (drag any corner/edge — width still drives the zoom, height adds vertical room); removed the separate Σ total column (colonist's own dashboard already shows each player's hand size); bank badges no longer show the "~" approximate symbol.

### Fixed
- colonist-stats-tracker (1.0.1): executed player-to-player trades ("X gave A and got B from Y") were mis-handled. Because the message text contains " got ", it was caught by the generic "got" gain branch, which counted BOTH the given-away and received cards as a net gain for the actor — so a card you traded away was incremented instead of decremented, and the counterparty's side was never updated. Trades now correctly debit what each side gave and credit what each side got. Removed the dead `traded … with` branch (colonist does not emit that wording).
- colonist-stats-tracker (1.0.2): self-detection no longer infers the local player's name from a "You stole … from &lt;Victim&gt;" line, where the only coloured name is the victim. Previously, if such a line was the first one carrying a player avatar, the victim could be tagged as "self".
- colonist-stats-tracker (1.3.2): fixed "ghost trails" smearing below the panel over colonist's board — the panel is now promoted to its own GPU compositor layer (transform: translateZ(0)), which composites cleanly over the WebGL canvas. Trimmed the header card icons slightly for better proportion with the text.
- colonist-stats-tracker (1.3.1): resizing felt laggy because the panel had a base width/height CSS transition that eased every drag — removed it (drag is instant now), and the zoom font updates live on every resize tick instead of after a debounce. Folding a section no longer leaves empty space (the panel re-fits its height to content, so folding shrinks the whole panel). The collapse animation was reworked: the panel shrinks straight to the dice with no background circle, the dice grows smoothly (no size jump), and hovering the dice shows a drop-shadow.
- colonist-stats-tracker (1.0.3): Monopoly was under-counted. The play reads "X stole N &lt;resource&gt;" where N is a number in the text but the resource icon appears only once, so the actor was credited 1 instead of N. The amount is now parsed from the text, and every opponent's holding of that resource is zeroed.
- colonist-stats-tracker (1.1.1): the panel could turn into a tall empty box after being dragged larger and then minimised or scaled down. Height is now content-driven (auto) and only width is resizable/persisted, so minimise always collapses cleanly and −/+ can never blank the panel.

### Added
- Repo-root synthetic-log test harness (`node:test` + `jsdom`) driven by real captured game-log fixtures. Covers dice rolls, resource gains, hidden-card steals, builds, trade proposals (ignored), and executed trades. Run with `npm test`. Lives at the repo root and is gitignored/never packaged into any extension ZIP.
- colonist-stats-tracker: expanded fixture/test coverage from several full live games — bank trades, builds (incl. free placement vs paid build), discards, robber moves, dev-card purchase, Monopoly, Year of Plenty, Road Building, Largest Army, multi-card trades, starting resources, and assorted info lines that must be ignored. Year of Plenty / Road Building / Largest Army needed no code change (already handled); the tests lock them against regression. 33 tests total.

## [2026-03-18]

### Changed
- claude-status-monitor: bumped version to 1.0.1 in manifest and added MV3 action so the extension can appear in Chrome extension toolbar/pin list.

### Docs
- CONTRIBUTING: added repository rule requiring version bump and changelog update for every code change.