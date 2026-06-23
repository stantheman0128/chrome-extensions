A floating in-game overlay for [colonist.io](https://colonist.io/) that tracks dice-roll distribution, per-player resources, and game stats in real time. It reads the game's own WebSocket messages (the board, dice, and hand state colonist already sends to your browser), so most numbers are exact and survive a page reload.

**Features**
- **Dice histogram**: live count and percentage for every sum 2–12, coloured against the fair-dice expectation (2.78%, 5.56% … 16.67%) — green if above, red if below, grey if close — with a ⚖️ χ² fairness badge. Roll counts come from the WebSocket log, so a fast game can't drop one.
- **Per-player resources**: 🌲 lumber, 🧱 brick, 🐑 wool, 🌾 grain, ⛰️ ore per player. Your own hand is read exactly from the protocol (no guessing); opponents' hands are reconstructed from the public events the WebSocket carries (production, trades, builds, steals), with their totals matched to colonist's own counts. Cards whose type genuinely can't be known — an opponent-vs-opponent steal — sit in a `?` column rather than being faked.
- **⛔ Cards blocked**: the cards you would have produced but lost to the robber sitting on one of your tiles, computed live from a reconstructed board model (robber tile × adjacent buildings × that tile's number), exact during the game and reconciled to colonist's end-of-game Overview figure.
- **Setup pips (⚅)**: each player's opening board strength, with two readings you toggle — coverage (the distinct numbered tiles they touch) and expected cards per dice roll (weighted by buildings, a city counted double, the robber-blocked tile dropped).
- **More Stats**: cards gained, discarded (rolled 7), stolen, lost to knights, traded, and average turn length, with per-resource and per-opponent breakdowns on hover.
- **Lightweight floating panel**: draggable, resizable, minimisable, keyboard shortcuts (D / R / S / C), one-click reset.
- **Reload- and reconnect-proof**: an in-progress game and its stats are rebuilt from colonist's resent game log after an F5; the current game and your lifetime history are saved locally.
- **SPA friendly**: re-attaches automatically after page or match navigation; a new game in the same tab resets cleanly.

**Technical details**
- Manifest V3, no background service worker, no `<all_urls>` host permission — runs only on `colonist.io`.
- Reads the game's WebSocket frames passively (decoded from MessagePack) plus the already-visible game log and player panel; nothing is opened, sent, or transmitted off the device.
- The only permission is `storage`, used to keep the in-progress game and your per-game history on your own device (`chrome.storage.local`).

**Note**: opponents' card types are hidden by colonist, so opponent breakdowns are a best-effort reconstruction. Genuine uncertainty (a masked opponent-vs-opponent steal) is surfaced in the `?` column rather than hidden. Your own hand and the dice, board, and blocked-loss figures are exact.

---

**Disclaimer**: This is an unofficial, fan-made tool. It is **not affiliated with, endorsed by, or sponsored by** Colonist or colonist.io. "Colonist" and all game names and assets are the property of their respective owners. This extension collects and transmits no data ([privacy policy](https://github.com/stantheman0128/chrome-extensions/blob/master/colonist-stats-tracker/PRIVACY.md)).
