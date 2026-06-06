A floating in-game overlay for [colonist.io](https://colonist.io/) that tracks dice-roll distribution and per-player resource holdings in real time.

**Features**
- **Dice histogram**: live count and percentage for every sum 2–12, coloured against the fair-dice expectation (2.78%, 5.56% … 16.67%) — green if above, red if below, grey if close
- **Per-player resources**: best-effort tally of 🌲 lumber, 🧱 brick, 🐑 wool, 🌾 grain, ⛰️ ore per player, derived from the game log
- **Unknown-card column (`?`)**: cards moved by robber/knight steals are tracked in a separate pool until spending makes their type obvious
- **Event coverage**: dice rolls, initial placement yields, rolls, building (road/settlement/city), dev-card purchases, bank and port trades, player-to-player trades, discards, knight steals, and Monopoly
- **Lightweight floating panel**: draggable, minimisable, one-click reset
- **SPA friendly**: re-attaches to the game log after page/match navigation

**Technical details**
- Pure content script (Manifest V3), no service worker, no `<all_urls>` host permission
- Runs only on `colonist.io`
- Uses a `MutationObserver` on `#game-log-text` and identifies resource / dice icons via `alt`, class name, and `src` — resilient to colonist.io's cosmetic tweaks
- When a player spends more of a resource than their known pool holds, the shortfall is pulled from the unknown pool, retroactively identifying stolen cards

**Note**: resource counts are a best-effort estimate. Stealing and hidden dev-card effects leave genuine uncertainty, which the `?` column surfaces rather than hides.

---

**Disclaimer**: This is an unofficial, fan-made tool. It is **not affiliated with, endorsed by, or sponsored by** Colonist or colonist.io. "Colonist" and all game names and assets are the property of their respective owners. This extension collects and transmits no data ([privacy policy](https://github.com/stantheman0128/stan-chrome-extensions/blob/master/colonist-stats-tracker/PRIVACY.md)).
