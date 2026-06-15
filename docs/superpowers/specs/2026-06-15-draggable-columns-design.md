# 設計：可拖移重排的表格欄位（Draggable Columns）

**日期**：2026-06-15
**專案**：colonist-stats-tracker
**搭配**：與 `2026-06-15-blocked-card-loss-design.md` 同一批實作、一起 commit、一次版本釋出（v1.34.0）。

## 動機

使用者希望 Cards（資源）與 Stats 兩個視圖的欄位都能**自己調整順序**：按住上方的 **header icon** 拖曳即可重排，數字格不能拖。順序要被記住。

## 使用者已定案的決策

| 面向 | 決定 |
|------|------|
| 拖曳啟動 | **按下 icon 一動就拖**（位移門檻約 4px；單純點擊/hover 不受影響，無長按延遲） |
| 視覺回饋 | **即時平移動畫**：拖曳時整欄跟手、其他欄即時讓位 |
| resources 的「未知牌 (?)」欄 | **一視同仁可拖**（5 資源 + 未知牌共 6 欄都可排序） |
| 拖曳技術（推薦定案） | **pointer 事件自建**，不用 HTML5 原生 DnD（面板注入在 colonist 頁，原生 DnD 會與棋盤拖曳衝突） |
| Player 欄 | 固定最左、不參與排序 |

## 核心洞見：`data-res` 已標好整欄

每個 header 格與每列數字格都帶 `data-res="<key>"`（resources 用 `lumber/brick/wool/grain/ore/unknown`；stats 用 `s-block/s-lost/…`）。因此：

- `panel.querySelectorAll('[data-res="brick"]')` = 整欄（header + 所有列）。
- 即時平移只要對「整欄」套同一個 `translateX`，整欄一起滑，不會 header 與數字脫節。

兩個視圖各有 **6 個值欄**，grid 模板 `repeat(6, …)` 共用，重排不需改 grid，只需改「畫欄時依據的順序陣列」。

## 架構設計

### ① 資料層：順序陣列 + 相容化

新增正規預設順序：

```js
const RES_ORDER_DEF  = ['lumber','brick','wool','grain','ore','unknown'];
const STAT_ORDER_DEF = STAT_COLS.map(c => c.key);  // v1.34 後 = ['s-block','s-lost','s-disc','s-gain','s-turn','s-trade']
```

`uiState`（content.js:890）新增兩個欄位：

```js
resOrder:  RES_ORDER_DEF.slice(),
statOrder: STAT_ORDER_DEF.slice(),
```

**相容化函式**（載入存檔時必跑，避免改版後壞掉）：

```js
function reconcileOrder(saved, canonical) {
  const set = new Set(canonical);
  const kept = (Array.isArray(saved) ? saved : []).filter(k => set.has(k)); // 丟掉已不存在的欄
  for (const k of canonical) if (!kept.includes(k)) kept.push(k);            // 補上新欄（如 s-block）
  return kept;
}
```

### ② 持久化（沿用既有 prefs 框架）

- 儲存：拖曳結束時 `saveUI({ resOrder })` 或 `saveUI({ statOrder })`。
- 載入：在 UI 還原區（content.js:1184 附近）加
  `uiState.resOrder = reconcileOrder(ui.resOrder, RES_ORDER_DEF);`
  `uiState.statOrder = reconcileOrder(ui.statOrder, STAT_ORDER_DEF);`
- 還原預設（content.js:1160 `restoreDefaults`）一併重設：
  `uiState.resOrder = RES_ORDER_DEF.slice(); uiState.statOrder = STAT_ORDER_DEF.slice();`
  並納入該函式的 `saveUI({...})`。

### ③ 渲染層：依順序陣列畫欄

- **Cards 視圖**（`renderCardsView` content.js:1981）：header 與 body 的資源欄改成迭代 `uiState.resOrder`（而非寫死的 `RESOURCES` + 末尾 unknown）。需把 unknown 的 header（bank 角標那格用 `?` 卡背）與 body 格納入同一迴圈，依 key 切換產生對應 cell。
- **Stats 視圖**（`renderStatsView` content.js:2140、2165）：`STAT_COLS.map(...)` 改成 `uiState.statOrder.map(key => COL_BY_KEY[key])`，其中 `COL_BY_KEY` 由 `STAT_COLS` 建索引。body 的 `vals[c.key]` 取值邏輯不變。
- grid 模板不動（仍 6 欄）。Player 欄維持在 `map` 之前，永遠最左。

### ④ 拖曳互動（pointer 事件、整欄即時平移）

以**事件委派**在表格 header 容器掛 `pointerdown`：

1. **pointerdown**（命中某 header icon，由 `data-res` 取 key）：記下 `startX`、被拖 key、當前視圖（`uiState.resView`）、當前順序與各欄水平邊界。**先不進拖曳**；`setPointerCapture`。
2. **pointermove**：
   - 位移 < 4px：什麼都不做（仍可能是點擊/hover）。
   - 首次跨過門檻：進入拖曳模式 → 設全域 `dragging = true`（供 tooltip / 欄位 highlight handler 略過）、加 `grabbing` 游標、被拖整欄（`[data-res=key]` 全部）抬起（提高 z-index、套陰影）。
   - 拖曳中：被拖整欄 `translateX = 指標位移`；依指標 X 與各欄中心算出插入索引，其餘各欄整欄 `translateX` 讓位（CSS transition 讓滑動有動畫）。
3. **pointerup**：
   - 未達門檻 → 視為單純點擊，不重排（既有 hover/tooltip 行為不變）。
   - 已拖曳 → 依插入索引把 key 從舊位置 splice 到新位置，更新 `uiState.resOrder`/`statOrder`、`saveUI(...)`、清掉所有 `translateX`、重繪表格（真正 reflow 進新順序）。釋放 `pointerCapture`、`dragging = false`。

### ⑤ 衝突處理與親和性

- header icon 的 `pointerdown` `stopPropagation`，避免觸發面板整體拖移。
- 拖曳期間 `dragging` 旗標讓 tooltip（content.js:1466 附近）與欄位 highlight（colHL content.js:1433）略過，拖完恢復。
- header icon 游標：閒置 `grab`、拖曳 `grabbing`（stats header 目前是 `cursor:default`，改為 `grab` 以暗示可拖）。
- 點擊門檻（4px）天然區分「點一下看 tooltip / 切高亮」與「拖曳重排」。

## 邊界情況

| 情況 | 行為 |
|------|------|
| 載入到舊版存檔（含已移除的 `s-stole`） | `reconcileOrder` 丟棄未知 key、把 `s-block` 補在尾端 → 不報錯 |
| 存檔順序缺欄/多欄 | 同上，以 canonical 為準補齊/裁切 |
| 視圖切換（Cards↔Stats） | 各自獨立順序；切換時各畫各的 order |
| 面板縮小 / small 模式 | 順序沿用；欄寬由既有 grid 控制，不受影響 |
| 拖到表格範圍外放開 | 以最後一次有效插入索引為準（夾在 0..5） |
| 觸控裝置 | pointer 事件同時涵蓋滑鼠/觸控；主要支援桌機滑鼠 |

## 測試策略（TDD）

純邏輯與渲染順序可在 jsdom 測；拖曳手勢（transform 動畫）以手動驗證為主。新增 `tests/column-order.test.js`：

1. **reconcileOrder**：丟棄未知 key、附加缺漏 canonical、空輸入回正規預設。
2. **reorder 純函式**：把 key 從 i 移到 j，前移/後移皆正確。
3. **渲染依序**：設定 `statOrder` → `renderStatsView` 的 header 與每列 cell 的 `data-res` 依該序出現。
4. **Cards 視圖含 unknown 排序**：把 unknown 移到中間 → header/body 對應位置正確。
5. **持久化往返**：`saveUI` → 載入 → `reconcileOrder` 後順序一致。
6. **還原預設**：呼叫 restoreDefaults 後順序回 canonical。
7. **與 v1.34 整合**：`statOrder` 預設含 `s-block`、不含 `s-stole`；舊存檔的 `s-stole` 被丟棄。

回歸：既有 `view-switch`、`live-stats`、`ui-smoke`、`popup-render` 等測試需同步（特別是斷言欄位順序/存在性的部分）。

## 不做（YAGNI）

- 不支援欄位「隱藏/顯示」（只重排，不增刪）。
- 不做跨裝置雲端同步（沿用既有本機 prefs）。
- 不做 body 與 header 不同步的中途狀態（整欄一起動）。
- 不替 Player 欄加入排序。

## 影響檔案

- `colonist-stats-tracker/content.js`（順序陣列、reconcile、依序渲染、pointer 拖曳互動、prefs 存取、還原預設、游標）
- `tests/column-order.test.js`（新增）＋ 受影響的既有測試
- `CHANGELOG` / `ROADMAP.md`（記錄此功能，與 block 損失同版 v1.34.0）

## 與 block-loss 的整合順序

實作計畫先落 **block 損失**（確定 `STAT_COLS` 欄位集合：`s-block` 取代 `s-stole`），再落 **拖移欄位**（`STAT_ORDER_DEF` 直接以最終欄位集合為基礎），避免順序陣列指向尚未存在/已移除的 key。
