# 設計：被搶匪卡田的牌損失（Blocked Card Loss）— v1.34.0

**日期**：2026-06-15
**專案**：colonist-stats-tracker
**現版**：1.33.0 → 目標 1.34.0

## 背景與動機

使用者提出兩個問題：

1. 想知道自己因為被搶匪（Robber）卡住產資源的田，**損失了多少張牌**。
2. 質疑 Stats 表的 ⚔️「偷到的牌」與 💔「被偷的牌」看起來重複。

### 釐清「偷到 / 被偷」並非重複

兩者是**相反方向**的統計，同一張表的兩欄（每列一位玩家）：

| 欄位 | 變數 | 意義 |
|------|------|------|
| ⚔️ 偷到的牌 | `ty.stole` | 本列玩家**偷別人**的牌（騎士/搶匪/壟斷） |
| 💔 被偷的牌 | `ty.lost` | 本列玩家**被別人偷**的牌 |

看起來像重複的原因：
- **2 人對局的鏡像效應**：A 偷到 = B 被偷，兩欄數字集合相同，只是換列。
- **全域恆等式**：任何人數下，整欄加總永遠相等（每張被偷的牌都是某人偷到的）。

**決議**：拿掉 ⚔️「偷到的牌」欄，把那個欄位槽讓給新的 ⛔「被 block 損失」欄。Stats 維持 6 欄不變。💔「被偷的牌」保留不動（標籤已清楚，不需改）。

## 核心洞見：純 log 就能推算，免解析棋盤

這個 extension 從頭到尾只讀 game-log 文字，**沒有解析棋盤幾何**（canvas 渲染，DOM 拿不到座標）。但要回答「被 block 損失幾張」**不需要**棋盤座標，只需要一張映射：

```
produces[玩家][號碼][資源] = 該玩家此號碼擲出時的產量
```

這張表可以從「**沒被擋的擲骰**」逐輪學到。配合 block 訊息提供的「號碼 + 資源」，幾乎總能唯一指向一塊田（Catan 同號碼兩塊田通常不同資源），就能把損失精準歸戶。

### Log 結構證據（取自 `tests/fixtures/game-log.js`）

| 事件 | 訊息文字特徵 | 用途 |
|------|------|------|
| 擲骰產量 | `X got [card…]`（裸 "got"） | **學 yield map 的唯一來源** |
| 初始牌 | `X received starting resources [card…]` | 排除（無對應號碼） |
| 黃金時代 | `X took from bank [card…]` | 排除 |
| 玩家交易 | `X gave… and got… from Y` | 早一步攔截，不進 got 分支 |
| 銀行交易 | `X gave bank… and took…` | 不是裸 got |
| 被卡田 | `[prob_N] [generated_tile_RES] is blocked by the Robber. No resources produced` | **損失事件來源** |

關鍵細節：
- 「裸 got」（有 " got " 但沒有 "gave"/"from"/"received"/"bank"）≈ 100% 是擲骰產量。
- block 訊息**沒有玩家名**、資源藏在 `generated_tile_<res>` 圖片（**不在 textContent**）。現有 `content.js:450` 用 `text.includes(res)` 抓不到資源，需改從 tile 圖片 src/alt 抓。

## 架構設計

### ① 資料層：每位玩家的 yield map

在 `makeTally()`（`content.js:168` 附近）的玩家 tally 物件新增：

```js
produces: {},   // 號碼 -> { 資源 -> 數量 }，從乾淨擲骰學到
```

全域新增一個輕量游標：

```js
let lastRoll = null;   // 最近一次擲出的點數和（2..12），驅動 produces 歸戶
```

**學習規則**（在擲骰分支 `content.js:504` 設定 `lastRoll = sum`；在 got 產量分支 `content.js:545` 套用）：

當訊息是裸 got 產量、`player` 存在、`lastRoll != null`、且**非** "received"/"took from bank"/trade 時，對該訊息每個資源 `r`：

```js
ty.produces[lastRoll] = ty.produces[lastRoll] || {};
ty.produces[lastRoll][r] = counts[r];   // 逐資源覆蓋（非累加）
```

逐資源覆蓋的好處：
- 城市升級（產 1→2）自動跟上（最新乾淨值覆蓋）。
- 部分被擋的擲骰中，被擋的資源**不會出現在 got 訊息**，因此不會覆蓋掉先前學到的乾淨值——天然正確，不需特別判斷 blockedRes。

### ② 損失事件：擴充現有 block 分支

現有 block 分支（`content.js:438`）已抓號碼 `N`、累加 `state.blocked.count` 與 `state.blocked.byKey`。改動：

- 從 `generated_tile_<res>` 圖片補抓**資源**（目前抓不到）。
- `byKey` 改用「`N res`」當 key（例：`"6 brick"`），`byKey[key]++`。

`state.blocked` 仍是全域計數（不分玩家）——這是正確的，因為一塊田可能多人共用，歸戶在顯示層用各玩家自己的 produces 完成。

### ③ 顯示層：衍生計算 + 換欄

**損失是衍生值，不是存出來的累加值**（這讓事後追記免費）：

```js
function blockLossOf(name) {
  const ty = tallyOf(name);
  let total = 0;
  for (const [key, times] of Object.entries(state.blocked.byKey)) {
    const [numStr, res] = key.split(' ');           // "6 brick"
    const yield_ = (ty.produces[+numStr] || {})[res] || 0;
    total += times * yield_;                          // 次數 × 我的該田產量
  }
  return total;
}
```

backfill 自動成立：某號碼暖機完成後，`produces` 長出該值，過去所有同 key 的 block 次數在下次 render 一併算入。

**STAT_COLS 改動**（`content.js:1919`）：把 `{ key: 's-stole', icon: '⚔️', … }` 換成：

```js
{ key: 's-block', icon: '⛔', tip: t('statBlock', '被搶匪卡田少收的牌（暖機後精準）') },
```

對應 `RES_HL`（1910）加 `'s-block': '138,103,194'`（沿用 violet）。
資料填入（`content.js:2157` 附近）把 `'s-stole'` 換成 `'s-block': { v: blockLossOf(name), bd: hasBlock ? 'block' : null }`。
hover 明細：列出各「N res ×次數 = 張數」分解（取代原 stole 的 stoleFrom hover）。

### ④ 持久化與封存

- `produces` 隨各玩家 tally 一起存檔/載入（`content.js:2390`、`2420` 附近的 save/load）。
- `state.blocked` 已在存檔範圍（`content.js:2397`、`2425`），key 格式變更需相容舊檔（舊 key 無資源時 `res` 為 undefined → 損失算 0，安全降級）。
- 每局封存（`content.js:2578` 附近）一併納入 produces / blocked。

### ⑤ Lifetime popup（跨局統計）

popup 目前彙總「偷到的牌」。改為彙總「被 block 損失」：
- `popup.js` 把對應欄位來源從 `stole` 換成各局封存的 block 損失（每局存檔時順手存一個算好的 `blockLoss` 數字，避免 popup 端重算 produces）。
- i18n 字串 popup 段同步換標籤。

### ⑥ i18n

- **新增** `statBlock`（en + zh_TW）。
- **移除/停用** `statStole`（主面板不再用；若 popup/hover 仍引用 stole 字串則一併處理）。
- hover 明細新增模板字串（例 `blockItem`: `{num} {res} ×{n}`）。
- en 對應字串同步。

## 邊界情況與誠實限制

| 情況 | 行為 |
|------|------|
| 號碼尚未暖機（沒乾淨擲過） | 該田損失暫算 0；暖機後**事後追記**補上 |
| 城市升級 | produces 自動跟最新乾淨值；衍生計算用最新產量 → 過去 block 會以現產量重估（輕微高估早期），可接受 |
| 同號碼同資源兩塊田（罕見） | produces 合併兩田，block 只擋一塊時會高估，罕見可接受 |
| 一塊田始終被擋、從未乾淨擲出 | 永遠學不到該田產量 → 持續低估（記為 0）。這是純 log 法的固有極限 |
| 玩家在該田**沒有建築** | `produces[N][res]` 為 undefined → 損失 0（正確，不誤算） |

UI 標示：欄位 tip 說明「暖機後精準」；不在數字旁加「~」（暖機後即精準，加波浪號反而誤導）。

## 測試策略（TDD）

沿用既有 jsdom + fixtures 架構，新增測試檔（例 `tests/blocked-loss.test.js`）：

1. **yield map 學習**：擲 6 → Stan got brick brick → `produces[Stan][6].brick === 2`。
2. **來源過濾**：`received starting resources` / `took from bank` / trade 的 got **不**進 produces。
3. **block 資源抓取**：`blocked_by_robber` fixture → byKey 含正確 `"11 wool"`（資源從 tile 圖抓到）。
4. **衍生損失**：擲 6 學到 brick=2，6-brick 被擋 3 次 → `blockLossOf(Stan) === 6`。
5. **事後追記**：先擋 2 次（未暖機，損失 0）→ 之後乾淨擲 6 學到 brick=2 → 損失回填為 4。
6. **部分被擋**：6 擲出、6-brick 擋、6-wool 產 → produces[6].wool 更新、produces[6].brick 不被清掉。
7. **沒建築不誤算**：對手在該號碼無產量 → 其 blockLoss 為 0。
8. **持久化往返**：save → load 後 produces / blocked 一致。
9. **舊存檔相容**：載入無資源的舊 byKey（`"6 tile"`）不報錯、損失算 0。
10. **顯示層**：Stats 視圖含 ⛔ 欄、不含 ⚔️ 欄（既有 `view-switch` / `live-stats` 測試同步更新）。

回歸：現有 137 個測試需全綠（特別是引用 `s-stole` 的測試要改成 `s-block`）。

## 不做（YAGNI）

- 不解析棋盤 canvas / 不追座標。
- 不改 💔「被偷的牌」欄。
- 不為「~ 估值」加特殊 UI（暖機後即精準）。
- 不做城市升級的逐次快照（接受現產量重估的輕微誤差）。

## 影響檔案

- `colonist-stats-tracker/content.js`（yield map、block 資源抓取、衍生損失、欄位置換、持久化）
- `colonist-stats-tracker/popup.js`（lifetime 彙總換來源）
- `colonist-stats-tracker/_locales/{en,zh_TW}/messages.json`（statBlock、hover 模板、移除 statStole）
- `colonist-stats-tracker/manifest.json`（版本 1.34.0）
- `tests/blocked-loss.test.js`（新增）＋ 受影響的既有測試
- `CHANGELOG` / `ROADMAP.md`（記錄 v1.34.0）
