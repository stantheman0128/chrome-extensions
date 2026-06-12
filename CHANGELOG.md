# Changelog

All notable changes in this repository are documented in this file.

## [Unreleased]

### Added
- colonist-stats-tracker (1.16.0): **one player table, two views + i18n + UI refinements.**
  - **Resources · Stats tabs.** The Stats section merged into the Resources table — same players, same rows, same grid; the section header gains two tabs that swap the six value columns (5 resources + "?" ⇄ ⚔️ stolen / 💔 lost / 🗑️ discarded / 📥 gained / 🎴 dev cards / 🏗️ **builds**, a new tally). The ±N floats work in both views and are **bigger, bolder and darker**, with semantic colouring in Stats (more "lost"/"discarded" = red).
  - **i18n.** All panel and popup strings follow the browser UI language via `chrome.i18n` (`_locales/en` + `zh_TW`; manifest `default_locale: en`, description localized). English fallbacks keep preview.html/tests working.
  - **Styled tooltips everywhere.** Every native title tooltip replaced by the white data dialog (same element as the dice tooltip) via `[data-tip]` delegation — larger type, softer corners, deeper shadow. Resource header icons enlarged (2.0 em), avatars too.
  - **Ghost mode on overlap.** Colonist dialogs/menus now ghost the panel when they merely overlap it (not only full-screen): added menu/popover/drawer candidates with a size floor against false positives.

### Removed
- colonist-stats-tracker (1.16.0): the popup's **強制重新抓取這局** button and its message plumbing — the panel's 🔄 deep re-sync (v1.10.0) supersedes it.

### Added
- colonist-stats-tracker (1.15.0): **ghost mode.** When a full-screen colonist dialog (e.g. Settings) opens, the panel fades to a faint ghost and stops catching the mouse — readable, clickable dialogs without dragging the panel away; it restores the moment the dialog closes. Detection is a heuristic (a visible fixed/absolute element covering ≥half the viewport with a modal/dialog/overlay/settings class), checked within ~250 ms of the dialog mounting. If a colonist dialog ever fails to trigger it, grab its DOM and the selector can be pinned exactly.
- colonist-stats-tracker (1.14.0): **per-game history.** When someone wins, the finished game is archived to `chrome.storage.local` (last 50 games; new `storage` permission, no new host permissions): date, duration, winner, total rolls, dice distribution, each player's final hand, and the live-stats tally. The toolbar popup gains a **對局紀錄** list (newest first; click a game to fold out the per-player summary) and a **匯出 JSON** link.
- colonist-stats-tracker (1.13.0): **live in-game stats.** A new collapsible **Stats** section surfaces, mid-game, what colonist only shows on the end screen: per player — cards stolen from others ⚔️ / lost to thieves 💔 (hover for the per-opponent breakdown), discards on 7s 🗑️, cards gained 📥, dev cards bought 🎴. A footer line totals **robber-blocked yields** parsed from the "[6] brick tile is blocked by the Robber. No resources produced" log line (count + per-tile breakdown, also shown next to the section header).
- colonist-stats-tracker (1.12.0): **recent-roll sequence.** The last 12 rolls as a left→right strip above the histogram (newest ringed, 7s in red) — the *run* of rolls, not just the frequency.
- colonist-stats-tracker (1.11.0): **floating ±N effect.** A game-style `+N`/`−N` drifts up and fades over any resource cell whose count changes. Lives in the stable overlay layer so re-renders can't kill it mid-flight; suppressed after reset/restore/deep-rescrape (no "+8 shower" when counts are rebuilt).

### Fixed
- colonist-stats-tracker (1.13.0): **"Itin stole Brick from you" no longer zeroes other players' piles.** The victim-side steal message (one coloured name + one revealed card) used to fall into the Monopoly branch, crediting the thief but wiping that resource for every OTHER player. It now credits the thief, debits the local player, and feeds the steal matrix.
- colonist-stats-tracker (1.11.0): **expand-from-collapsed no longer looks two-stage.** The expand animation measured `scrollHeight` while the width was still animating from 36 px, so it first opened to an in-between height and then visibly snapped. The true target height is now pre-measured with transitions off (within one JS turn, so nothing intermediate paints). The **large ⇄ small toggle** also animates now (a one-shot transition, cleared afterwards so live drag-resize stays instant).

### Added
- colonist-stats-tracker (1.10.0): **game-lifecycle automation.** A three-state lifecycle (lobby / playing / ended) now drives the panel automatically:
  - **Auto-collapse / auto-expand by page context.** The panel collapses to the dice icon on the home page / lobby and expands when a live game is detected (URL changes trigger an immediate re-check; the game DOM is the authoritative signal). All automatic actions fire **only on state transitions**, so a manual expand in the lobby or a manual collapse mid-game sticks until the next transition — no "pin" setting needed.
  - **Game clock.** A `⏱ m:ss` timer (h:mm:ss past an hour) in the panel header counts from when the game was detected (initial placement included). It persists across page reloads and freezes at the final time when someone wins.
  - **End-of-game flow.** The "X won the game!" log line collapses the panel so the end screen is fully clickable; starting the next game (fresh log container or roster change — the rematch-with-the-same-players case included) auto-expands it, wipes the previous game's stats, and restarts the clock.
  - **Deep re-sync.** The 🔄 button now wipes the stats (keeping the game identity + clock), scrolls the virtual log to the top, and steps back down so every message mounts once and is re-processed in order — a user-controlled recovery from disconnect/refresh drift, on top of the automatic localStorage persistence. Added 8 lifecycle tests (50 total).

## [2026-06-06]

### Changed
- colonist-stats-tracker (1.9.0): **board-reading polish (refines the 2026-06-04 interactions).** Two rounds of live feedback tightened the dice + resource UI:
  - **Physical dice faces.** The digit ⇄ dice toggle now renders the two dice as small rounded-square **SVG dice** — a light gradient sheen, warm edge, soft shadow and real pips, with the **1 and 4 pips in red** (Asian-dice style) so adjacent values read at a glance — instead of the flat ⚀–⚅ glyphs. The bottom value also **auto-switches by panel width** (digits when narrow, dice at ≥ 372 px — i.e. dice in the large preset, digits in the small one); clicking it sets a sticky manual override.
  - **Snappier toggle.** Clicking the value no longer spins — it does a springy fade-out → pop-in, and the value lives in a fixed-height slot so the bars and spacing never jump when it changes.
  - **Continuous column highlight.** Hovering a resource column is now detected by cursor-x against the header cells, so the whole vertical strip is hot (the gaps between cells and rows included). The highlight overlay moved **on top** of the rows — so row separators and the current-turn tint can no longer slice it — with bright neon side bars + an outer bloom, all fading to transparent at the top and bottom (a soft gradient instead of an abrupt straight cut), tinted in the resource's own colour.
  - **Cursor-following dialog.** The dice tooltip is now a **white** dialog that trails the cursor (flipping at the right/bottom screen edges) and appears only over the count/bar zone (not the % or the value). Its content is trimmed to what isn't already on screen: "**N rolls since last X**" and the fair-dice expected %.
  - **Height-responsive spacing.** Dragging the panel taller now flows the extra height into the **internal spacing** — resource rows space apart and each dice column's bar↔value gap grows — instead of parking blank space (mid-panel or at the bottom). The panel's size cap was removed, so resizing is unlimited. The current-turn left bar also gets more breathing room from the avatar.

### Fixed
- colonist-stats-tracker (1.9.0): the unknown "?" resource number is now bold only on the **current-turn row or on column-hover** (it used to be bold whenever a player merely *held* unknown cards). The ⋮ menu's **Text size** A−/A＋ buttons no longer wrap or misalign. Guarded the digit ⇄ dice swap so a roll/resize landing mid-animation can't poke a stale node — it just renders the new mode.

## [2026-06-04]

### Added
- colonist-stats-tracker (1.9.0): **board-reading interactions.** (1) The current player's row lights up (accent tint + a left accent bar + bold numbers) — "current turn" is inferred from the last roll, so you can instantly see whose resources to watch. (2) Hovering a resource highlights that whole column with a fill + neon side bars tinted in **that resource's own colour** (an overlay behind the cells), and bolds its numbers — extra-bold where a player actually holds that resource. (3) The dice histogram reads top→bottom as **roll count (big & bold) → bar → % → sum**; the sum (2–12; 7 in red) sits small at the bottom as the axis label. (4) Clicking the sum spins it and toggles between the **digit** and the **two dice faces** (⚀–⚅) that make it. (5) Hovering a dice column pops a small **dialog tooltip** showing the tally + "**N rolls since last X**" (e.g. how long since a 7), from a new ordered roll-history. (6) The current-player row keeps its bold even while another column is hovered (the active-cell bold is a CSS class, not an inline style the hover can wipe), and the left turn-bar has more breathing room from the avatar. (7) The ⋮ menu gains an independent **Text size** A−/A＋ control (on top of the width zoom).

### Fixed
- colonist-stats-tracker (1.9.0): (a) header control buttons + ⋮ menu items now actually show their hover effect — the inline `background:transparent` was overriding the stylesheet `:hover` (inline beats selectors), so the rules are now `!important`. (b) Collapsing to the dice icon and expanding again restores the panel to the **active preset's** width instead of a stale 340 px default (it was reading a `width` key that no longer exists after the presets refactor).

### Added
- colonist-stats-tracker (1.8.0): **personalisable large/small layout presets.** The panel keeps two saved layouts (each a position + width) and toggles between them with a single header button whose icon shows the next action (shrink when large, grow when small). It auto-enlarges to the "large" preset when it first appears. A new ⋮ menu lets you save the panel's current position+size as your "large" or "small" preset, or reset to the built-in defaults; dragging/resizing also updates whichever preset is active, so your layout sticks across reloads. Replaces the old single "reset size & position" button.

### Changed
- colonist-stats-tracker (1.8.0): the manual "new game" control moved off the panel into the toolbar **popup** ("強制重新抓取這局"). New games are auto-detected now (see 1.7.1), so it's a rare fallback; keeping it off the panel removes the overlap with re-sync. The popup messages the content script via `chrome.tabs.sendMessage` (no new permissions). The panel header is now just re-sync + the large/small toggle + the ⋮ presets menu.
- colonist-stats-tracker (1.8.0): polish — the large/small toggle uses horizontal chevrons (‹ › enlarge, › ‹ shrink) that read clearly even at 16px (the previous maximize/minimize-2 diagonals were ambiguous when small); all panel UI text is English for consistency (the ⋮ menu items included), while the log parser still matches both English and Chinese colonist wording; control buttons get a smooth hover (subtle background + accent border) and keep their native tooltips. Repo hygiene: `PRIVACY.md` and `STORE_LISTING.md` moved from the repo root **into** `colonist-stats-tracker/` (alongside the DESCRIPTION files) and are excluded from the packaged zip.
- repo tooling: `preview.html` moved from the repo root into `colonist-stats-tracker/` (it loads `./content.js` live, so refreshing always reflects the latest code; tracked in git but excluded from the packaged zip). The auto-generated README/README.zh-TW now include each extension's **version** (a Version column in the quick-download table + a per-extension line), so the README tracks releases automatically on every push.

### Fixed
- colonist-stats-tracker (1.7.1): **new games no longer show the previous game's data.** New-game detection compared rosters for "no players in common", but the local player is in *every* game, so it never fired — a new match kept the old players/counts. It now resets when a tracked player is no longer on colonist's live panel (the restored-but-stale case), or when the live roster settles on a different set (a new game started in the same tab). Added 3 synthetic tests (42 total).

### Changed
- colonist-stats-tracker (1.7.1): **distinct, product-grade header controls.** The re-sync and reset buttons used to be near-identical circular-arrow emoji. Replaced all control emoji with inline SVG (Lucide-style) line icons — monochrome via `currentColor`, CSP-clean, scaling in em with the panel zoom: a circular **refresh** (re-sync card counts), a **square-plus** (new game — clear + re-read the current game), and **diagonal resize arrows** (reset panel size & position). The distinct circle / square / diagonal silhouettes stay legible when small, and look more mature than emoji (which also render inconsistently across OSes). The new-game button arms on the first click (turns into a red check) and only wipes on a confirming second click within ~2s, so a stray click can't clear a live game.

### Added
- colonist-stats-tracker (1.7.0): **Chrome Web Store 上架前置（第一批，與 icon 無關的部分）.** (1) Added a Manifest V3 `action` (toolbar button) with a small info popup (`popup.html` / `popup.js`) — it shows the live version (read from the manifest, so it never drifts), a one-line "the panel appears automatically on colonist.io" hint, links to the source and privacy policy, and a non-affiliation disclaimer. (2) Added `homepage_url`. (3) Added a repo-root `PRIVACY.md` (bilingual EN/繁中) documenting the extension's zero-collection model — no servers, no analytics, no remote code, everything in the page-scoped `localStorage` on the user's own device — to satisfy the store's privacy-disclosure requirement. (4) Added an unofficial/non-affiliation + attribution disclaimer (and a privacy-policy link) to both `DESCRIPTION.md` and `DESCRIPTION.en.md`, as required when a listing references the "Colonist" name and displays its card art. (5) Added brand icons at 16/32/48/128 px (`icons/`) wired into both `icons` (extension/store) and `action.default_icon` (toolbar): a resource-coloured hexagon tile (the colonist board) with two dice in the centre and a face-down "?" badge in the corner — i.e. board + dice-rolls + unknown-cards, the three things the panel tracks. Generated programmatically (PIL, 4× supersampled then downscaled) so each size stays crisp; the design and a multi-size/multi-background comparison were iterated in a throwaway `tasks/` preview, not shipped.

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