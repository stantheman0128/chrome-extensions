# Privacy Policy — Colonist.io Stats Tracker

_Last updated: 2026-06-23_

## TL;DR

**This extension collects nothing, sends nothing, and stores everything locally on your own device.** There are no servers, no analytics, no trackers, no cookies, no ads, and no remote code.

## What the extension does (single purpose)

Colonist.io Stats Tracker is a content script that reads two things on [colonist.io](https://colonist.io/) game pages — the **already-visible** game log and player panel, and the game's **own WebSocket messages** (the board, dice, and hand state that colonist already sends to your browser to draw the game) — computes statistics (dice-roll distribution and fairness, a best-effort per-player resource tally, robber-blocked losses, turn times, etc.), and displays them in a floating overlay panel. That is its only function.

## Data it processes — and where that data stays

| Data | How it's used | Where it goes |
| --- | --- | --- |
| Rendered game-log text and icons on the colonist.io page | Parsed in your browser to count dice rolls, trades, builds, steals, etc. | Never leaves your browser |
| colonist.io player-panel info (names, colours, avatars, hand counts) | Used to order rows, show avatars, and reconcile counts | Never leaves your browser |
| The game's own WebSocket messages (board tiles/numbers, robber position, dice rolls, your exact hand, public events) | Read passively from the connection colonist already made; used for exact dice counts, the board geometry behind ⛔ blocked-loss and Setup pips, and a more accurate per-player hand | Read in your browser only; never sent anywhere else |
| Current-game state + UI preferences (panel size/position/fold state) | Saved so a page reload or reconnect doesn't wipe the game in progress | `localStorage`, scoped to the `colonist.io` origin, **on your device only** |
| Per-game history (final stats of your finished games, up to the last ~50) | Stored so the popup can show a games list and your lifetime stats | `chrome.storage.local`, **on your device only** |

The extension reads the WebSocket data only because the browser has **already received it** from colonist to render the game; the extension never opens a connection of its own and never sends anything back. It **does not** collect, transmit, sell, rent, or share any of this data with the developer or any third party. Nothing is uploaded anywhere.

## Permissions

- **Host access is limited to `colonist.io`** (via a content-script match pattern). The extension does not request `<all_urls>`, `tabs`, `history`, `cookies`, or any other broad permission.
- The only declared permission is **`storage`**, used to keep your own game stats and per-game history on your device (`chrome.storage.local`). This is local storage only — **not** `storage` sync, and nothing is sent to any server.
- There is **no background service worker** and **no remotely hosted code** (everything that runs ships inside the package, as required by Manifest V3).

## Network activity

The extension makes **no network requests of its own**. The only remote assets shown in the panel are the game's own card icons, which the colonist.io page you are already viewing has itself loaded — the extension simply reuses those images for display.

## Children's privacy

The extension collects no personal information from anyone, including children.

## Changes to this policy

If this policy changes, the update will be published at this same URL with a new "Last updated" date.

## Contact

Questions or concerns? Please open an issue:
<https://github.com/stantheman0128/chrome-extensions/issues>

---

# 隱私權政策（繁體中文）

_最後更新：2026-06-23_

## 一句話總結

**本擴充功能不蒐集、不上傳任何資料，所有資料只存在你自己的裝置上。** 沒有伺服器、沒有分析追蹤、沒有 cookie、沒有廣告、沒有遠端程式碼。

## 功能用途（單一用途）

本擴充功能是一支 content script，會在 [colonist.io](https://colonist.io/) 對局頁面上讀取兩種資料——你畫面上**已經顯示**的遊戲記錄與玩家面板，以及遊戲**自己的 WebSocket 訊息**（colonist 為了畫出棋盤，本來就會傳到你瀏覽器的棋盤、骰子、手牌等狀態）——於你的瀏覽器內計算統計（擲骰分佈與公平度、盡可能推算的各玩家資源持有量、被強盜擋掉的產量、回合時間等），並以浮動面板顯示。這是它唯一的功能。

## 處理哪些資料、資料去哪裡

| 資料 | 用途 | 去向 |
| --- | --- | --- |
| 頁面上的遊戲記錄文字與圖示 | 在瀏覽器內解析，統計擲骰、交易、建造、偷牌等 | 不離開你的瀏覽器 |
| colonist.io 玩家面板資訊（名稱、顏色、頭像、手牌數） | 用於排序、顯示頭像、校正數字 | 不離開你的瀏覽器 |
| 遊戲自己的 WebSocket 訊息（棋盤地塊／號碼、強盜位置、擲骰、你的精確手牌、公開事件） | 從 colonist 早已建立的連線被動讀取；用於精確骰子計數、⛔ 被擋產量與 Setup pips 背後的棋盤幾何、以及更準的各玩家手牌 | 只在你瀏覽器內讀取，不傳往他處 |
| 當前對局狀態 + 介面偏好（面板大小／位置／折疊狀態） | 讓重新整理或斷線重連時不會清空進行中的對局 | 僅存於你裝置上、限定 `colonist.io` 來源的 `localStorage` |
| 對局紀錄（你已結束對局的最終統計，最多保留最近約 50 場） | 讓彈出視窗能列出對局清單與你的終生統計 | 僅存於你裝置上的 `chrome.storage.local` |

本擴充功能讀取 WebSocket 資料，只是因為瀏覽器**已經**從 colonist 收到這些資料來畫遊戲；擴充功能不會自己開連線，也不會回傳任何東西。它**不會**將上述任何資料蒐集、傳輸、販售、出租或分享給開發者或任何第三方。沒有任何東西被上傳到任何地方。

## 權限

- **主機存取僅限 `colonist.io`**（透過 content-script 比對樣式）。不要求 `<all_urls>`、`tabs`、`history`、`cookies` 或任何其他廣泛權限。
- 唯一宣告的權限是 **`storage`**，用來把你自己的對局統計與對局紀錄存在裝置上（`chrome.storage.local`）。只用本機儲存，**不是** `storage` 同步，也不會送到任何伺服器。
- **沒有背景 service worker**、**沒有遠端載入的程式碼**（依 Manifest V3 規範，所有執行的程式碼都隨套件一起封裝）。

## 網路行為

本擴充功能**不會發出任何自己的網路請求**。面板中唯一的遠端資源是遊戲本身的卡片圖示，而那些圖片是你正在瀏覽的 colonist.io 頁面早已載入的——擴充功能只是重複使用這些圖片來顯示。

## 兒童隱私

本擴充功能不向任何人（包括兒童）蒐集個人資訊。

## 政策變更

若本政策有變更，將於相同網址更新並標註新的「最後更新」日期。

## 聯絡方式

有任何疑問，請於此開 issue：
<https://github.com/stantheman0128/chrome-extensions/issues>

---

_Disclaimer: This is an unofficial, fan-made tool. It is not affiliated with, endorsed by, or sponsored by Colonist or colonist.io. "Colonist", "Catan", and all game names and assets are the property of their respective owners._

_免責聲明：本工具為非官方的同好作品，與 Colonist／colonist.io 無隸屬關係，亦未經其背書或贊助。「Colonist」「Catan」及所有遊戲名稱與美術素材，版權均屬其各自所有者。_
