# Stan Chrome Extensions

基於 Manifest V3 打造的輕量級 Chrome 擴充功能合集。

> **README 由 GitHub Actions 自動生成。**
> 欲修改擴充功能的說明，請編輯對應資料夾內的 `DESCRIPTION.md`。

---

## 快速下載

| # | 擴充功能 | 下載 |
|---|---------|------|
| 1 | [Claude Status Monitor](#ext-claude-status-monitor) | [![下載 claude-status-monitor](https://img.shields.io/badge/下載-claude--status--monitor.zip-blue?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/claude-status-monitor.zip) |
| 2 | [Dcard 文章排版優化](#ext-dcard-article-formatter) | [![下載 dcard-article-formatter](https://img.shields.io/badge/下載-dcard--article--formatter.zip-red?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/dcard-article-formatter.zip) |
| 3 | [Remove Glasp Remnants](#ext-glasp-remnants-remover) | [![下載 glasp-remnants-remover](https://img.shields.io/badge/下載-glasp--remnants--remover.zip-green?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/glasp-remnants-remover.zip) |
| 4 | [YouTube 絕對精確日期 (完美客製版)](#ext-youtube-video-upload-time) | [![下載 youtube-video-upload-time](https://img.shields.io/badge/下載-youtube--video--upload--time.zip-orange?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/youtube-video-upload-time.zip) |

---

## 擴充功能列表

<a id="ext-claude-status-monitor"></a>

### 1. Claude Status Monitor

**資料夾：** `claude-status-monitor/`

## Claude Status Monitor

在 Claude.ai 網頁版（含 Claude Code 網頁版）即時顯示 Claude 服務狀態，資料來源為 [status.claude.com](https://status.claude.com)。

**功能特色**

- 於頁面右下角顯示浮動狀態徽章，顏色對應目前整體狀態（綠色＝正常、黃色＝輕微、橘色＝重大、紅色＝嚴重）
- 點擊徽章展開詳細面板，顯示所有服務元件（claude.ai、Claude API、Claude Code 等）的即時狀態
- 自動顯示進行中的事件（Incidents）及最新更新內容
- 每 60 秒自動刷新，亦可手動重試
- 使用 Shadow DOM 完全隔離樣式，不影響 Claude.ai 原有介面
- 深色主題設計，與 Claude.ai 風格一致

**技術細節**

- 透過 Atlassian Statuspage 公開 API（`/api/v2/summary.json`、`/api/v2/incidents/unresolved.json`）取得即時狀態資料
- 採用 Service Worker（`background.js`）統一發送 API 請求，避免跨域限制
- 使用 `chrome.alarms` 定期推送更新至所有已開啟的 Claude.ai 分頁

**一鍵下載**

[![下載 claude-status-monitor](https://img.shields.io/badge/下載-claude--status--monitor.zip-blue?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/claude-status-monitor.zip)

**安裝方式**
1. 點上方按鈕下載 `.zip` 並解壓縮
2. 開啟 Chrome，前往 `chrome://extensions`
3. 啟用右上角的**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的 `claude-status-monitor` 資料夾

---

<a id="ext-dcard-article-formatter"></a>

### 2. Dcard 文章排版優化

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

[![下載 dcard-article-formatter](https://img.shields.io/badge/下載-dcard--article--formatter.zip-red?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/dcard-article-formatter.zip)

**安裝方式**
1. 點上方按鈕下載 `.zip` 並解壓縮
2. 開啟 Chrome，前往 `chrome://extensions`
3. 啟用右上角的**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的 `dcard-article-formatter` 資料夾

---

<a id="ext-glasp-remnants-remover"></a>

### 3. Remove Glasp Remnants

**資料夾：** `glasp-remnants-remover/`

自動移除 Glasp 擴充功能在每個網頁上留下的多餘 UI 元素。如果你已經解除安裝 Glasp，卻仍在各網站看到它的側邊欄或螢光標記，這個擴充功能會靜默地將其清除乾淨。

**功能特色**
- 適用於所有網址（`<all_urls>`）
- 在頁面載入時清除既有的 `.glasp-extension` 元素
- 使用 `MutationObserver` 監聽 DOM 變化，即時移除動態注入的元素

**一鍵下載**

[![下載 glasp-remnants-remover](https://img.shields.io/badge/下載-glasp--remnants--remover.zip-green?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/glasp-remnants-remover.zip)

**安裝方式**
1. 點上方按鈕下載 `.zip` 並解壓縮
2. 開啟 Chrome，前往 `chrome://extensions`
3. 啟用右上角的**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的 `glasp-remnants-remover` 資料夾

---

<a id="ext-youtube-video-upload-time"></a>

### 4. YouTube 絕對精確日期 (完美客製版)

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

[![下載 youtube-video-upload-time](https://img.shields.io/badge/下載-youtube--video--upload--time.zip-orange?style=for-the-badge&logo=googlechrome)](https://github.com/stantheman0128/stan-chrome-extensions/releases/latest/download/youtube-video-upload-time.zip)

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
│   ├── DESCRIPTION.md
│   ├── background.js
│   ├── content.js
│   └── manifest.json
├── dcard-article-formatter/
│   ├── DESCRIPTION.md
│   ├── content.js
│   └── manifest.json
├── glasp-remnants-remover/
│   ├── DESCRIPTION.md
│   ├── content.js
│   └── manifest.json
└── youtube-video-upload-time/
    ├── DESCRIPTION.md
    ├── content.js
    └── manifest.json
```

## 新增擴充功能

在 repo 根目錄建立新子目錄並放入 `manifest.json`，
下次推送到 main 時 GitHub Actions 將自動打包、更新 Release 並重新生成此 README。

## 授權條款

MIT
