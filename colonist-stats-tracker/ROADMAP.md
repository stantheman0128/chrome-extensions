# Colonist.io Stats Tracker — Roadmap

Non-urgent ideas to revisit later. Nothing here blocks the current release, and this
file is excluded from the packaged `.zip`.

## Status

- **Chrome Web Store：** 已提交上架，正在等待審查。

## A–D（皆已出貨）

Stan 2026-06-22 提出的這批(A/B/C/D)現在**全部做完了**;下面保留各自的設計記錄供日後參考,狀態已更新成「已出 + 版本」,別再當待辦重做。

**進度(最新):** A ✅(1.72) ｜ 骰子點數→WS ✅(1.73) ｜ C(a)(b) ✅(1.74,城市×1、扣強盜) ｜ B ✅(1.75 整欄 highlight 排除自己 + 標頭對手合計;1.79 改釘住式 neon column band;1.80 對手合計只在釘住時顯示) ｜ C(c) ✅(1.76,每格右下角點數) ｜ C 第二種讀法「每次擲骰期望張數」✅(1.89) ｜ **D ✅**(1.88 把幾何卡田扶正、1.90 跨 reload／換局／局末無損、1.91 收尾 4 個邊界案例;遊戲進行中已精準)。

### A. Highlight 與 Resync 的互動 — ✅ 已出(1.72)

按一次 Resync,就把畫面上所有 highlight 全部清掉。

- **現況:** 目前可以單獨點某格(某玩家某資源)做 highlight,Resync 不會動到它們。
- **要做:** Resync 觸發時,先清空所有 highlight 狀態(`uiState` 內的格子 highlight + 骰子欄 highlight),再做原本的重新同步。
- **基礎:** highlight 狀態與切換已有(`toggleCellHighlight`/`toggleDiceHighlight`/`cellMark`),Resync 入口在 `runResync`/`deepRescrape`。改動小。
- **待定:** 沒有任何 highlight 時按 Resync,維持原行為即可(不需要特別處理)。

### B. 資源欄整欄 highlight + 對手合計持有量 — ✅ 已出(1.75 起)

> **已出貨:** (a)(b) 都做了 — 1.75 先做整欄 highlight(排除自己)+ 標頭對手合計;1.79 把整欄 highlight 改成釘住式 neon column band(不是每格底色);1.80 讓對手合計只在欄被釘住時才顯示。下面是原始設計記錄。

- **(a) 點資源欄標頭的 icon → highlight 那一整欄**(所有玩家的該資源),自己那一格除外。
- **(b) 在資源欄標頭上方顯示一個數字 = 除了自己以外,其他人合計持有多少該資源**,方便判斷該不該用壟斷(Monopoly)。
- **基礎:** 資源 icon 就是欄標頭(`iconCell`,帶 `data-colhead="1"` `data-res`),右上角已經有「銀行剩餘」徽章;每格 highlight 機制已有。
- **待定:**
  - 欄標頭目前是「拖曳排序」用的(`cursor:grab`),要把「點一下=整欄 highlight」和「拖曳=換欄順序」分開(用 4px 移動門檻區分,沿用現有拖曳判定)。
  - (b) 的數字要跟右上角銀行徽章在視覺上分開,別擠在一起(銀行=牌庫剩餘,這個=對手手上合計,兩個意義不同)。
  - 「對手合計」要不要把 unknown 算進去:嚴格講對手的 unknown 也可能是該資源,但合計只加「已知是該資源」的比較保守、也比較好懂。先做保守版。

### C. 點數統計(pip count)與 Setup 強度 — ✅ 已出(1.74、1.76,延伸 1.89)

> **已出貨:** (a) 名字旁的 ⚅ 總點數徽章 + (b) hover 看每種資源各自點數 → 1.74;(c) 每格右下角的該資源點數 → 1.76。城市算 ×1、強盜壓住的地扣掉(原始決議)。延伸:1.89 加了第二種讀法,點 ⚅ 數字可在「涵蓋(distinct 地塊 pip 加總)」與「每次擲骰期望張數(Σ 權重×P(號碼),城市 ×2、扣強盜)」之間切換。下面是原始設計記錄。

Catan 每個號碼有對應點數(骰到的相對頻率):2/12=1、3/11=2、4/10=3、5/9=4、6/8=5、7=0。

- **(a)** 在玩家名字旁顯示一個數字 = 他目前 Setup 涵蓋的總點數(他所有建築踩到的號碼點數加總)。
- **(b)** 細化:可吸附(hover)查看該玩家「每種資源」各自的總點數(例如他的礦產點數有多強)。
- **(c)** 這個每種資源的點數,放在對應資源格數字的右下角。
- **基礎:** 需要的棋盤幾何 board.js 已完整重建(每塊地的資源+號碼、每個角的建築、角↔地相鄰)。算點數是純幾何加總,資料齊。
- **待定:**
  - 城市(city)要不要算 2 倍(產量是 2 倍,但「點數涵蓋」也可只看踩到幾個號碼)。先決定一個定義。
  - 強盜當下壓住的地要不要從點數扣掉(顯示「實際可用點數」),還是永遠顯示原始點數。
  - (c) 右下角的小數字跟現有的 highlight 底色、tabular 對齊不要打架。

### D. 遊戲進行中也精準的 ⛔ 卡田(Stan 指定要做) — ✅ 已出(1.88、1.90、1.91)

> **已出貨——別再重做這條。** ⛔ 現在直接讀 WS 棋盤幾何的卡田值(強盜地塊 × 相鄰建築 × 該地資源),遊戲進行中就精準。歷程:1.85 先修好 `z=1` 角→地公式(自 1.46 就一直錯,害幾何卡田半盤算錯,用 colonist 自己的 type 47 產出當裁判驗證);1.88 把幾何卡田正式扶正取代舊的 log 差分(舊法在「先被擋、之後才升級建築」時會高估),局末仍用 colonist Victory 表精確值覆蓋;1.90 重新設計這個總值的持有方式,做到跨 reload／換局／局末都無損;1.91 收掉一次獨立壓力測試找到的 4 個邊界案例。下面保留原始設計方向當歷史。

目前 ⛔ 用「實收對比」:遊戲中很準,但「剛蓋好馬上被擋」那種情形會輕微高估,只有局末讀 Victory 畫面才完全精準。Stan 要的是**遊戲進行中每個數值也都正確**。

- **做法方向(地圖快照法):** 遊戲進行中,每次擲骰時存一份「當下地圖建築 + 強盜位置」的快照、持久化到本機;reload 後對照時間線,用「當時」的地圖算每一次被擋的實際張數,不再依賴「看過最多的那次產量」。
- **為什麼非快照不可:** 蓋建築的 WebSocket 事件只說「蓋了什麼」沒說「蓋在哪」,而地圖/強盜位置只在遊戲狀態裡;伺服器 reload 只重送「最終地圖」、不送中間歷史。所以歷史地圖得我們自己在遊戲中存下來。
- **基礎:** board.js 已能算「強盜壓住某號碼地時,相鄰建築各損失幾張」(`blockedLossOf`),只是現在只能對「當下」算、不能重播歷史。要補的是「把每回合的地圖+強盜凍結成時間線」這層。
- **取捨:** 換來的是「那個罕見升級情形下、遊戲中也完全精準」;成本是每回合存一份地圖快照 + 相鄰格計算。Stan 已確認要做,值不值得這題不再討論。
- **連帶:** 這條會順便把下面「Deferred refinements」裡那條『per-player blocked 歸屬需要從初始放置訊息做棋盤追蹤』一起解掉(同一套幾何時間線)。

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
- ~~Per-player "blocked" attribution.~~ Done as part of item D: the WS board model
  (`board.js`, from 1.46 on) reconstructs the full tile/corner/robber geometry, so
  blocked yields are attributed per player from it — no longer dependent on the
  log line (which only names the tile). The exact in-game value shipped in
  1.88/1.90/1.91.
- History viewer niceties: dice-histogram preview per game, CSV export, a panel
  tab as an alternative to the popup.
