# Chrome Web Store — 上架資料與提交清單

> Colonist.io Stats Tracker · v1.95.0 · 能見度建議 **Unlisted（不公開，有連結即可安裝）**

這份檔案把 CWS Dashboard 要填的欄位都備好，方便你逐欄複製貼上。
**只有你能做的事**集中在最後「F. 你要親自做的」。

---

## A. 要上傳的套件（zip）

- 版本：**1.95.0**，zip 內 `manifest.json` 在最上層（CWS 規定），可直接上傳。
- 取得方式：push 之後到 GitHub repo 的 **「latest」Release** 下載 `colonist-stats-tracker.zip`（CI 自動產生、版號跟著 manifest）。
  （`tasks/store-assets/` 裡的 zip 是早期手動打包的舊版本，別拿來上架。）

---

## B. 商店listing 欄位（可直接複製）

| 欄位 | 值 |
| --- | --- |
| **Product name** | `Colonist.io Stats Tracker` |
| **Summary（≤132 字元）** | `Live dice-distribution and per-player resource overlay for colonist.io games. 100% local, no data collected.` |
| **Category** | `Games`（或 `Just for Fun`） |
| **Language** | English (United States)；可再加 Chinese (Traditional) |
| **Store icon** | `icons/icon128.png`（128×128，已含於套件）。高解析備用：`tasks/store-assets/icon-512.png`、向量原始檔 `tasks/store-assets/icon.svg` |

**Detailed description（英文）** — 取自 `colonist-stats-tracker/DESCRIPTION.en.md`
**Detailed description（中文）** — 取自 `colonist-stats-tracker/DESCRIPTION.md`

**Screenshots（1280×800 或 640×400，1–5 張，必填）**
→ 需要你從**實際對局**截圖（見 F）。目前的核心功能可拿來拍：
- **擲骰直方圖**：每個點數 2–12 的次數／百分比，配 ⚖️ χ²（卡方）公平度徽章。
- **玩家資源表**：自己的手牌是從 WebSocket 直接讀到的精確分佈，對手則由公開事件重建（含 `?` 未知欄）；可點某資源欄標頭釘住整欄 highlight、看「對手合計持有量」。
- **Stats 表**：每位玩家的取得／棄牌／⛔ 被強盜擋掉的產量／被偷／偷到／交易、平均回合時間。
- **Setup pips（⚅）**：每位玩家的開局點數強度，可切「涵蓋」與「每次擲骰期望張數」兩種讀法。
- **彈出視窗（popup）**：跨對局的終生統計與對局紀錄。
建議至少拍：①直方圖、②資源表（含 `?` 欄與對手合計）、③Stats 表（⛔ 欄）、④面板疊在棋盤上的整體畫面。

**Promo / Marquee tiles（選填，已超取樣產生，邊緣銳利）**
- Small（440×280）：`tasks/store-assets/promo-440x280.png`（另附 2× `promo-880x560.png`）
- Marquee（1400×560）：`tasks/store-assets/marquee-1400x560.png`

> 注意：CWS 的 promo tile 尺寸固定（440×280 / 1400×560），上傳請用對應檔；2× 版僅供你自己行銷/高 DPI 用。
> Chrome 的 icon 槽只吃 PNG（16/32/48/128，已含於套件）；`icon.svg` 是向量原始檔，給網頁/設計軟體用，非上傳 Chrome 用。

---

## C. Privacy 分頁（審核重點）

**Single purpose（單一用途）**
```
Display a live, read-only statistics overlay (dice-roll distribution and a best-effort
per-player resource tally) on colonist.io game pages.
```

**Permission justifications（權限說明）**
- Host access `*://colonist.io/*`：
  ```
  Required to inject the content script that reads the already-visible on-screen game
  log AND observes the game's own WebSocket traffic (the board, dice, and hand state
  colonist already sends to this browser) to compute the stats overlay. Everything is
  processed in the page; nothing is transmitted off the device. The extension runs only
  on colonist.io.
  ```
- `storage`：
  ```
  Used only to save the user's own game stats and per-game history locally
  (chrome.storage.local), so the lifetime-stats popup and the in-progress game survive
  a page reload. No sync, no remote storage — the data never leaves the device.
  ```
- 其他權限：**無**（除上面的 `storage` 外，未宣告其他 `permissions`。popup 的「強制重抓」用 `chrome.tabs.sendMessage` 對「自己注入的 content script」傳訊，這**不需要** `tabs` 權限；無 `<all_urls>`、無 background service worker、無遠端程式碼）。

**Data usage / 資料用途**：宣告 **完全不蒐集**（does NOT collect or use any user data）。本機儲存（`chrome.storage.local`／`localStorage`）只供使用者自己看，不對外傳輸。
三個合規勾選（皆可勾）：
- ✅ 不販售/轉移使用者資料給第三方（非為核准用途）
- ✅ 不為與單一用途無關的目的使用/轉移資料
- ✅ 不為判定信用度/借貸用途使用/轉移資料

**Privacy policy URL**
```
https://github.com/stantheman0128/chrome-extensions/blob/master/colonist-stats-tracker/PRIVACY.md
```
（⚠️ 需先 push，連結才會生效）

---

## D. Distribution（發佈）

- **Visibility：Unlisted**（不公開）→ 搜尋找不到，但有連結的人可直接安裝、免 Workspace。
- Distribution：保留預設（所有地區）即可。

---

## E. 合規備註

- 非官方工具：listing 與素材已含「與 colonist.io 無隸屬」聲明（DESCRIPTION／popup／PRIVACY）。
- 維持**免費 + 純本機**，可降低 colonist ToS 灰色地帶風險（勿商業化、勿建外部資料庫）。

---

## F. 你要親自做的（我無法代勞）

- [ ] 註冊 Chrome Web Store 開發者帳號，付一次性 **US$5**
- [ ] trader/non-trader 申報 → 免費自用選 **non-trader**
- [ ] 從實際對局**截 1–5 張圖**（1280×800 或 640×400）
- [ ] 上傳 1.95.0 zip、貼上本檔 B/C 各欄、設 **Unlisted**、貼 PRIVACY URL
- [ ] 送審（Submit for review）

> 我已完成：套件（含 icon/popup/manifest）、PRIVACY.md、商店文案與歸屬、promo tile、打包 zip、本提交清單。
