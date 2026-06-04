# Chrome Web Store — 上架資料與提交清單

> Colonist.io Stats Tracker · v1.7.0 · 能見度建議 **Unlisted（不公開，有連結即可安裝）**

這份檔案把 CWS Dashboard 要填的欄位都備好，方便你逐欄複製貼上。
**只有你能做的事**集中在最後「F. 你要親自做的」。

---

## A. 要上傳的套件（zip）

- 版本：**1.7.0**，zip 內 `manifest.json` 在最上層（CWS 規定），可直接上傳。
- 取得方式（擇一）：
  1. push 之後到 GitHub repo 的 **「latest」Release** 下載 `colonist-stats-tracker.zip`（CI 自動產生）。
  2. 本機現成檔：`tasks/store-assets/colonist-stats-tracker-1.7.0.zip`（已為你打包好）。

---

## B. 商店listing 欄位（可直接複製）

| 欄位 | 值 |
| --- | --- |
| **Product name** | `Colonist.io Stats Tracker` |
| **Summary（≤132 字元）** | `Live dice-distribution and per-player resource overlay for colonist.io games. 100% local, no data collected.` |
| **Category** | `Games`（或 `Just for Fun`） |
| **Language** | English (United States)；可再加 Chinese (Traditional) |
| **Store icon** | `icons/icon128.png`（128×128，已含於套件） |

**Detailed description（英文）** — 取自 `colonist-stats-tracker/DESCRIPTION.en.md`
**Detailed description（中文）** — 取自 `colonist-stats-tracker/DESCRIPTION.md`

**Screenshots（1280×800 或 640×400，1–5 張，必填）**
→ 需要你從**實際對局**截圖（見 F）。建議拍：①面板擲骰直方圖、②玩家資源表（含 `?` 欄）、③面板疊在棋盤上的整體畫面。

**Small promo tile（440×280，選填）**
→ 已為你產生：`tasks/store-assets/promo-440x280.png`

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
  log and renders the stats overlay. The extension runs only on colonist.io.
  ```
- 其他權限：**無**（沒有 `tabs`/`storage`/`<all_urls>`，沒有 background service worker，沒有遠端程式碼）。

**Data usage / 資料用途**：宣告 **完全不蒐集**（does NOT collect or use any user data）。
三個合規勾選（皆可勾）：
- ✅ 不販售/轉移使用者資料給第三方（非為核准用途）
- ✅ 不為與單一用途無關的目的使用/轉移資料
- ✅ 不為判定信用度/借貸用途使用/轉移資料

**Privacy policy URL**
```
https://github.com/stantheman0128/stan-chrome-extensions/blob/master/PRIVACY.md
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
- [ ] 上傳 1.7.0 zip、貼上本檔 B/C 各欄、設 **Unlisted**、貼 PRIVACY URL
- [ ] 送審（Submit for review）

> 我已完成：套件（含 icon/popup/manifest）、PRIVACY.md、商店文案與歸屬、promo tile、打包 zip、本提交清單。
