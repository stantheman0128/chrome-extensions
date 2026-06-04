🌐 [English](README.md) | [繁體中文](README.zh-TW.md)

# Stan Chrome Extensions

基於 Manifest V3 打造的輕量級 Chrome 擴充功能合集。

> **README 由 GitHub Actions 自動生成。**
> 欲修改擴充功能的說明，請編輯對應資料夾內的 `DESCRIPTION.md`。

---

## 快速下載

| # | 擴充功能 | 下載 |
|---|---------|------|
| 1 | [Claude 服務狀態監控](#ext-claude-status-monitor) | [![下載 claude-status-monitor](https://img.shields.io/badge/下載-claude--status--monitor.zip-blue?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/claude-status-monitor.zip) |
| 2 | [Colonist.io Stats Tracker](#ext-colonist-stats-tracker) | [![下載 colonist-stats-tracker](https://img.shields.io/badge/下載-colonist--stats--tracker.zip-red?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/colonist-stats-tracker.zip) |
| 3 | [Dcard 文章排版優化](#ext-dcard-article-formatter) | [![下載 dcard-article-formatter](https://img.shields.io/badge/下載-dcard--article--formatter.zip-green?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/dcard-article-formatter.zip) |
| 4 | [Remove Glasp Remnants](#ext-glasp-remnants-remover) | [![下載 glasp-remnants-remover](https://img.shields.io/badge/下載-glasp--remnants--remover.zip-orange?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/glasp-remnants-remover.zip) |
| 5 | [YouTube 絕對精確日期 (完美客製版)](#ext-youtube-video-upload-time) | [![下載 youtube-video-upload-time](https://img.shields.io/badge/下載-youtube--video--upload--time.zip-9B59B6?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/youtube-video-upload-time.zip) |

---

## 擴充功能列表

<a id="ext-claude-status-monitor"></a>

### 1. Claude 服務狀態監控

**資料夾：** `claude-status-monitor/`

在 Claude.ai 網頁版（含 Claude Code 網頁版）即時顯示 Claude 服務狀態，資料來源為 [status.claude.com](https://status.claude.com)。

**功能特色**

- 於頁面右下角顯示浮動狀態徽章，顏色對應目前整體狀態（綠色＝正常、黃色＝輕微、橘色＝重大、紅色＝嚴重）
- 點擊徽章展開雙欄儀表板：左側為各服務元件 30 天 Uptime 條狀圖，右側為進行中的事件
- 事件卡片顯示最新狀態（Monitoring / Identified / Investigating），點擊可展開查看完整更新時間軸
- Hover 條狀圖可看到該天日期與事件狀態
- 點擊空白區域即可收起面板；展開 / 收起均帶有平滑動畫
- 每 30 秒自動刷新，Footer 時間即時跳動，並提供手動 Refresh 按鈕
- 使用 Shadow DOM 完全隔離樣式，不影響 Claude.ai 原有介面
- 暖色深色主題設計，配色與 Claude.ai 風格一致

**技術細節**

- 透過 Atlassian Statuspage 公開 API（`summary.json`、`incidents/unresolved.json`、`incidents.json`）取得即時狀態與歷史資料
- 採用 Service Worker（`background.js`）統一發送 API 請求並快取（25 秒 TTL），支援手動強制刷新
- Content Script 每 30 秒主動 Poll + `chrome.alarms` 每 30 秒推送，確保資料即時更新

**一鍵下載**

[![下載 claude-status-monitor](https://img.shields.io/badge/下載-claude--status--monitor.zip-blue?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/claude-status-monitor.zip)

**安裝方式**
1. 點上方按鈕下載 `.zip` 並解壓縮
2. 開啟 Chrome，前往 `chrome://extensions`
3. 啟用右上角的**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的 `claude-status-monitor` 資料夾

---

<a id="ext-colonist-stats-tracker"></a>

### 2. Colonist.io Stats Tracker

**資料夾：** `colonist-stats-tracker/`

在 [colonist.io](https://colonist.io/) 對局中即時統計擲骰分佈與各玩家持有資源的浮動面板。

**功能**
- **擲骰分佈直方圖**：2–12 每個點數的出現次數、百分比，以及和理論機率（2.78%、5.56% … 16.67%）的偏差（綠：偏高、紅：偏低）
- **玩家資源追蹤**：依照遊戲記錄（Game Log）推算每位玩家目前手上的 🌲木、🧱磚、🐑羊、🌾麥、⛰️礦 數量；並以 `?` 欄位顯示因強盜/騎士偷牌而無法確定類型的卡片數
- **事件自動解析**：擲骰、初始配置獲得、建造（道路/聚落/城市）、發展卡、銀行/港口交易、玩家間交易、棄牌、騎士偷牌、壟斷（Monopoly）都會自動計入
- **輕量浮動面板**：右上角顯示，可拖曳、可最小化、可一鍵重置
- **SPA 支援**：換局、換頁都能自動重新掛上遊戲記錄監聽

**技術細節**
- 純 Content Script（Manifest V3），無背景 Service Worker、無 `<all_urls>` 權限
- 只在 `colonist.io` 網域下啟動
- 透過 `MutationObserver` 監聽 `#game-log-text` 的新訊息，並以 `<img>` 的 `alt`／`class`／`src` 三種線索辨識資源與骰子圖示，能容忍 colonist.io 常見的小幅改版
- 偷牌時以「未知卡」池記帳：若之後該玩家花掉某項資源超過已知存量，會自動將未知卡回推為該類型

**備註**：資源計算為「盡可能」的推算。偷牌、看不見的發展卡效果等不確定資訊，會透過 `?` 欄位標示，協助判讀而非保證精準。

---

**免責聲明**：本工具為非官方的同好作品，與 Colonist／colonist.io **無隸屬關係**，亦未經其背書或贊助。「Colonist」及所有遊戲名稱與美術素材，版權均屬其各自所有者。本擴充功能不蒐集、不上傳任何資料（[隱私政策](https://github.com/stantheman0128/stan-chrome-extensions/blob/master/PRIVACY.md)）。

**一鍵下載**

[![下載 colonist-stats-tracker](https://img.shields.io/badge/下載-colonist--stats--tracker.zip-red?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/colonist-stats-tracker.zip)

**安裝方式**
1. 點上方按鈕下載 `.zip` 並解壓縮
2. 開啟 Chrome，前往 `chrome://extensions`
3. 啟用右上角的**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的 `colonist-stats-tracker` 資料夾

---

<a id="ext-dcard-article-formatter"></a>

### 3. Dcard 文章排版優化

**資料夾：** `dcard-article-formatter/`

一鍵優化 Dcard 文章排版，讓閱讀體驗大幅提升。

- **自動分行**：在句號、問號、驚嘆號等標點後自動換行，將整坨文字牆變成清楚的段落
- **標點符號修正**：自動將中文語境中的半形標點（, ! ? : ;）轉換為全形標點（，！？：；）
- **中英文間距**：自動在中文與英文/數字之間加入空格（盤古之白），提升可讀性
- **段落間距優化**：增加行高與段落間距，讓文章視覺更舒適
- **一鍵切換**：右下角浮動按鈕，一鍵排版 / 一鍵還原，隨時切換
- **SPA 導航支援**：完整支援 Dcard 的單頁應用程式導航，切換文章自動重置
- **僅在文章頁啟動**：只在 Dcard 文章頁面（`/f/看板/p/文章ID`）顯示按鈕，不干擾其他頁面

**一鍵下載**

[![下載 dcard-article-formatter](https://img.shields.io/badge/下載-dcard--article--formatter.zip-green?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/dcard-article-formatter.zip)

**安裝方式**
1. 點上方按鈕下載 `.zip` 並解壓縮
2. 開啟 Chrome，前往 `chrome://extensions`
3. 啟用右上角的**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的 `dcard-article-formatter` 資料夾

---

<a id="ext-glasp-remnants-remover"></a>

### 4. Remove Glasp Remnants

**資料夾：** `glasp-remnants-remover/`

自動移除 Glasp 擴充功能在每個網頁上留下的多餘 UI 元素。如果你已經解除安裝 Glasp，卻仍在各網站看到它的側邊欄或螢光標記，這個擴充功能會靜默地將其清除乾淨。

**功能特色**
- 適用於所有網址（`<all_urls>`）
- 在頁面載入時清除既有的 `.glasp-extension` 元素
- 使用 `MutationObserver` 監聽 DOM 變化，即時移除動態注入的元素

**一鍵下載**

[![下載 glasp-remnants-remover](https://img.shields.io/badge/下載-glasp--remnants--remover.zip-orange?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/glasp-remnants-remover.zip)

**安裝方式**
1. 點上方按鈕下載 `.zip` 並解壓縮
2. 開啟 Chrome，前往 `chrome://extensions`
3. 啟用右上角的**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的 `glasp-remnants-remover` 資料夾

---

<a id="ext-youtube-video-upload-time"></a>

### 5. YouTube 絕對精確日期 (完美客製版)

**資料夾：** `youtube-video-upload-time/`

將 YouTube 模糊的相對時間戳記（例如：*「2 年前」*）替換為精確到秒的本地上傳日期與時間。

**功能特色**
- **影片播放頁面** — 將精確日期時間（例如 `2023-04-15 09:32:07`）直接注入影片資訊欄，與觀看次數並排顯示
- **首頁／頻道頁／搜尋結果** — 透過 `IntersectionObserver` 在影片縮圖旁顯示精確上傳日期，僅在影片進入可視範圍時才發送請求
- **Stream 讀取** — 找到日期立即停止下載，不等整份頁面傳輸完畢，大幅降低網路流量與記憶體使用
- **持久化 cache（`chrome.storage.local`）** — 日期跨分頁、跨刷新永久保留，重複看到同一影片瞬間顯示、完全不發請求
- 依照使用者的本地時區顯示日期時間
- 相容 YouTube 2024+ 新版首頁 UI（`yt-lockup-view-model`）
- SPA 換頁後即時更新，不殘留舊影片的日期
- 支援 Shorts、播放清單（Watch Later、Liked Videos）、推薦欄、訂閱頁、觀看紀錄等所有有影片的頁面

**v9.0 更新**
- Stream 讀取 HTML（`ReadableStream` 逐 chunk 掃描），找到日期立即 `cancel()`，每次 fetch 流量從 ~500KB 降至數十 KB
- `chrome.storage.local` 持久化 cache：日期不再只存在記憶體，關閉分頁後仍保留，重複瀏覽接近零消耗
- 修正 Watch History 頁面日期跑進 description 的版面問題（精確鎖定 `ytd-video-meta-block #metadata-line`）

**v8.0 更新**
- 新增支援：推薦欄（watch page 右側）、Watch Later、Liked Videos、自訂播放清單
- 新增支援：Shorts shelf（`ytd-reel-item-renderer`）及 Shorts URL 格式解析
- 修復：SPA 換頁後推薦欄不更新（`yt-navigate-finish` 觸發全面清除並重新掃描）
- 新增注入備援目標（`#meta`、`#details`），提高對未知頁面類型的相容性

**一鍵下載**

[![下載 youtube-video-upload-time](https://img.shields.io/badge/下載-youtube--video--upload--time.zip-9B59B6?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/youtube-video-upload-time.zip)

**安裝方式**
1. 點上方按鈕下載 `.zip` 並解壓縮
2. 開啟 Chrome，前往 `chrome://extensions`
3. 啟用右上角的**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的 `youtube-video-upload-time` 資料夾

---

## 專案結構

```
stan-chrome-extensions/
├── claude-status-monitor/
│   ├── DESCRIPTION.en.md
│   ├── DESCRIPTION.md
│   ├── PRIVACY.md
│   ├── background.js
│   ├── content.js
│   └── manifest.json
├── colonist-stats-tracker/
│   ├── DESCRIPTION.en.md
│   ├── DESCRIPTION.md
│   ├── content.js
│   ├── manifest.json
│   ├── popup.html
│   └── popup.js
├── dcard-article-formatter/
│   ├── DESCRIPTION.en.md
│   ├── DESCRIPTION.md
│   ├── content.js
│   └── manifest.json
├── glasp-remnants-remover/
│   ├── DESCRIPTION.en.md
│   ├── DESCRIPTION.md
│   ├── content.js
│   └── manifest.json
└── youtube-video-upload-time/
    ├── CHANGELOG.md
    ├── DESCRIPTION.en.md
    ├── DESCRIPTION.md
    ├── PRIVACY.md
    ├── content.js
    └── manifest.json
```

## 新增擴充功能

在 repo 根目錄建立新子目錄並放入 `manifest.json`，
下次推送到 main 時 GitHub Actions 將自動打包、更新 Release 並重新生成此 README。

## 授權條款

MIT
