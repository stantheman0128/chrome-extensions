# Stan Chrome Extensions

基於 Manifest V3 打造的輕量級 Chrome 擴充功能合集。

---

## 擴充功能列表

### 1. Glasp 殘留清除器（Glasp Remnants Remover）

**資料夾：** `glasp-remnants-remover/`

自動移除 Glasp 擴充功能在每個網頁上留下的多餘 UI 元素。如果你已經解除安裝 Glasp，卻仍在各網站看到它的側邊欄或螢光標記，這個擴充功能會靜默地將其清除乾淨。

**功能特色**
- 適用於所有網址（`<all_urls>`）
- 在頁面載入時清除既有的 `.glasp-extension` 元素
- 使用 `MutationObserver` 監聽 DOM 變化，即時移除動態注入的元素

**安裝方式**
1. 開啟 Chrome，前往 `chrome://extensions`
2. 啟用右上角的**開發人員模式**
3. 點擊**載入未封裝項目**，選擇 `glasp-remnants-remover` 資料夾

---

### 2. YouTube 精確上傳日期（YouTube Exact Upload Date）

**資料夾：** `youtube-video-upload-time/`

將 YouTube 模糊的相對時間戳記（例如：*「2 年前」*）替換為精確到秒的本地上傳日期與時間。

**功能特色**
- **影片播放頁面** — 將精確日期時間（例如 `2023-04-15 09:32:07`）直接注入影片資訊欄
- **首頁／頻道頁／搜尋結果** — 透過 `IntersectionObserver` 在影片縮圖旁顯示精確上傳日期，僅在影片進入可視範圍時才發送請求
- 快取已擷取的日期，避免重複發送網路請求
- 依照使用者的本地時區顯示日期時間

**安裝方式**
1. 開啟 Chrome，前往 `chrome://extensions`
2. 啟用右上角的**開發人員模式**
3. 點擊**載入未封裝項目**，選擇 `youtube-video-upload-time` 資料夾

---

## 專案結構

```
stan-chrome-extensions/
├── glasp-remnants-remover/
│   ├── manifest.json
│   └── content.js
└── youtube-video-upload-time/
    ├── manifest.json
    └── content.js
```

## 貢獻方式

歡迎發送 Pull Request。請將每個擴充功能獨立置於各自的資料夾中。

## 授權條款

MIT
