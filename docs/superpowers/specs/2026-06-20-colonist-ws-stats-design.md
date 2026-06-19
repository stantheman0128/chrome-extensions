# Colonist Stats Tracker — Stats 累計欄搬 WebSocket(sub-project 4)設計

**日期**:2026-06-20
**前置**:1.45–1.49(WS inspector、board model、⛔/hands/Resync 已 WS 化)
**相關**:[[colonist_ws_protocol]]、[[project_colonist_tracker]]

## Goal

把 Stats 區裡「能從 WebSocket 精準取得、方向明確」的累計欄從 log 推斷改為 WS 權威值,並保留 WS 給不了的欄位繼續用 log。顯示層(renderStatsView)零改動。

## 背景:一局真實樣本揭露的事實

用 `__cstWS.logTypes()` 抓了一整局的 `gameLogState`(去重、不限量)。釘死的事件語意:

| type | 語意 | payload |
|------|------|---------|
| 10 | 擲骰 | `{playerColor, firstDice, secondDice}` |
| 47 | 產出/發牌 | `{playerColor, cardsToBroadcast:[resId], distributionType}`(0=骰子, 1=開局/單張) |
| 21 | 拿 2 張(YoP / 退款) | `{playerColor, cardEnums:[r,r]}` |
| 55 | 棄牌 | `{playerColor, cardEnums:[resId…], areResourceCards}` |
| 86 | 壟斷/偷牌 | `{playerColor=得利者, amountStolen, cardEnum=資源}` |
| 116 | 銀行/港口交易 | `{playerColor, givenCardEnums, receivedCardEnums}`(**無對手 color**) |
| 11 | robber 移動 | `{pieceEnum:5, tileInfo}` |
| 66 | 成就(最長路/最大軍) | `{playerColor, achievementEnum 0/1}` |
| 5 | 建造 | `{playerColor, pieceEnum, isVp}` |
| 49 | tile 被擋無產出 | `{tileInfo}`(無 playerColor) |

resId 確認:`1=lumber, 2=brick, 3=wool, 4=grain, 5=ore`。

**兩個關鍵修正**(對照現有 log 處理後得出):

1. **116 是銀行/港口交易,不是玩家交易**。樣本全是 N:1(4:1、2:1)、且沒有對手 color。現有 log 的 s-trade 來源是玩家交易(`X gave … and got … from Y` → `recordTrade`,content.js:594),銀行交易(content.js:751)根本不進 Stats。所以 116 對 Stats 搬遷無用,玩家交易的 WS event 這局無樣本 → **s-trade 保留 log**。

2. **86 這局是壟斷,不是騎士偷**(`amountStolen:3` 一次拿走 3 張單一資源)。騎士偷 1 張的乾淨 WS event 無樣本;且「誰偷你」colonist 公開 log 有、WS 私密 → **s-lost 保留 log**。

## 範圍

**搬 WS(本 spec)**:

- 🗑 **s-disc**(棄牌)← type 55
- 📥 **s-gain**(獲得)← type 47(dist 0/1)+ type 21(YoP)
- 🎺 **壟斷**(monoTook / monoLost)← type 86

**明確不在本 spec(保留現有 log 路徑)**:

- 🤝 s-trade(玩家交易,WS 無樣本)
- 💔 s-lost(騎士偷,WS 無乾淨樣本;公開敘述 log 反而完整)
- ⏱ s-turn(WS 無 per-event 時戳,維持 wall-clock)
- builds / devCards(archived,非顯示欄,低優先)

## 架構

延續 1.46–1.49 的兩層模式:

```
WS frame → ws-inspector relay → content.js listener → board.applyDiff
  └─ board.js 在既有 gameLogState 去重迴圈(seenLog)裡累計 wsStats(by color)
tick(WS ready)→ content.js syncStatsFromWS()
  └─ 用 wsColorOf 把 board.statsOf(color) 映射進 state.tally(by name)
     ├─ 覆寫:discards, discardCards, gained, gainedRes, monoTook, monoLost
     └─ 保留:lost, lostTo, tradeGave, tradeGot, turns, turnMs, produces, builds, devCards
renderStatsView 讀 state.tally(形狀不變)→ 顯示零改
```

### board.js 新增

```js
// 累計結構,by color
b.wsStats = {};   // color -> { discards, discardCards, gained, gainedRes:{resId:n},
                  //            monoTook:{resId:n}, monoLost:{thiefColor:{resId:n}} }
```

在 `applyDiff` 處理 `gameLogState` 的去重迴圈(每個 `text` 只在 `k > seenLog` 時處理一次,與現有 blocked 累計同一迴圈)按 `text.type` 累計:

- **55**:`s.discards += 1; s.discardCards += cardEnums.length`(s = wsStats[playerColor])
- **47**:`for c of cardsToBroadcast: s.gained += 1; s.gainedRes[c] += 1`
- **21**:同 47(YoP 也算 gained),用 `cardEnums`
- **86**:壟斷。`taker = wsStats[playerColor]; taker.monoTook[cardEnum] += amountStolen`;受害方僅 **2 人局** 可推(對手唯一):對每個 `color !== playerColor`,`wsStats[color].monoLost[playerColor][cardEnum] += amountStolen`。3+ 人局 amountStolen 是總和、個別不可分 → 只填 monoTook,monoLost 留給 log。

玩家數從 `b.colorToName` / `b.hands` 的 key 數判斷。

### board.js API

```js
statsOf(b, color)   // -> b.wsStats[color] 或 null
playerCount(b)      // -> 參與顏色數(判 2 人局)
```

### content.js 新增

```js
function syncStatsFromWS() {
  if (!wsBoard || !__cstBoard.ready(wsBoard)) return false;
  let changed = false;
  state.players.forEach((p, name) => {
    const color = wsColorOf(name);
    if (color == null) return;
    const s = __cstBoard.statsOf(wsBoard, color);
    if (!s) return;
    const ty = tallyOf(name);
    // 覆寫 WS 權威欄;保留其餘(lost/trade/turns/produces…)
    if (ty.discards !== s.discards) { ty.discards = s.discards; changed = true; }
    if (ty.discardCards !== s.discardCards) { ty.discardCards = s.discardCards; changed = true; }
    // gained:WS 值寫入 + oracle 比對 log(dist 語意不確定,先觀察)
    ...monoTook / monoLost(2人局)同步...
  });
  return changed;
}
```

tick 的 PLAYING 分支,WS ready 時在 syncFromWS 之後呼叫 syncStatsFromWS(兩者都改 state、合併一次 renderSoon)。

### gained 的 oracle(dist 語意不確定)

現有 log 的 gained = `got`(骰子)+ `received`(開局)+ `took from bank`(YoP)。WS 對應:type 47 dist 0 = 骰子;dist 1 = 開局/單張(需驗證是否完整涵蓋「開局起始資源」);type 21 = YoP。為避免漏算開局那批,gained 搬上去時同時 `console.debug` WS vs log 差異(沿用 ⛔ 1.46 oracle),Stan 實機若見偏差即回報,補 dist 語意。disc/mono 語意鐵定,不需 oracle。

## 不變式

- **顯示零改**:renderStatsView / popup 讀 `state.tally` 的同名欄,形狀不變。
- **保留 log 欄位**:syncStatsFromWS 只覆寫 disc/gain/mono,不碰 lost/trade/turns/produces/builds/devCards。
- **board 未 ready 時**:syncStatsFromWS early-return false,Stats 完全走現有 log 路徑(大廳/握手前不退化)。
- **persist**:tally 已在 persistState 內(content.js:2925),WS 覆寫後的值照常持久化,popup 聚合不變。

## 測試清單

**board.js(tests/board-stats.test.js,新增)**:
1. type 55 → wsStats[color].discards=1, discardCards=cardEnums.length
2. 多次 55 累加;areResourceCards=false 不算(若需排除非資源棄牌)
3. type 47 dist 0 → gained += cardsToBroadcast.length, gainedRes per resId
4. type 21 → gained += cardEnums.length(YoP)
5. type 86 → monoTook[cardEnum] += amountStolen(施放方)
6. type 86 2 人局 → 對手 monoLost[taker][cardEnum] += amountStolen
7. type 86 3 人局 → 只填 monoTook,monoLost 不填
8. gameLogState 去重:同一 entry index 不重複累計(seenLog)
9. statsOf 未知 color → null

**content.js(tests/ws-stats.test.js,新增)**:
1. syncStatsFromWS board 未 ready → false
2. relay 含 55/47/86 的 full state/diff → board 累計 → syncStatsFromWS 把 disc/gain/mono 寫進對應玩家 tally
3. 保留性:預設 tally.lost / tradeGave 有值時,syncStatsFromWS 不清掉
4. 2 人局壟斷:taker 的 monoTook 與 victim 的 monoLost 都同步到 tally

## 分階段實作(每階段一版號 + commit)

1. **1.50.0 — board wsStats 框架 + 棄牌(55)**:最乾淨,先打通 board→sync→tally 全鏈路。
2. **1.51.0 — 壟斷(86)**:施放方 + 2 人局受害方。
3. **1.52.0 — 獲得(47 + 21)+ oracle**:gained/gainedRes,掛 log 比對 debug。

每階段 TDD(RED→GREEN)、全測試綠、bump manifest + CHANGELOG、各自 commit。

## 風險與限制

- **gained 開局批**:dist 1 是否完整涵蓋「開局起始資源」未證實 → oracle debug 把關,必要時補。
- **壟斷多人局受害方**:amountStolen 為總和,個別不可分 → 3+ 人局 monoLost 留 log。
- **玩家交易 / 騎士偷**:WS 無樣本,明確不搬,維持 log。日後若抓到乾淨樣本再開新 spec。
- **harvester meta bug**(附記):`logTypes()` 的 `meta.players` 印空,因讀錯一層(`gs.playerUserStates` 應為 `payload.playerUserStates`),不影響事件分析,順手修。
