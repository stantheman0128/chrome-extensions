將 YouTube 模糊的相對時間戳記（例如：*「2 年前」*）替換為精確到秒的本地上傳日期與時間。

**功能特色**
- **影片播放頁面** — 將精確日期時間（例如 `2023-04-15 09:32:07`）直接注入影片資訊欄，與觀看次數並排顯示
- **首頁／頻道頁／搜尋結果** — 透過 `IntersectionObserver` 在影片縮圖旁顯示精確上傳日期，僅在影片進入可視範圍時才發送請求
- 快取已擷取的日期，避免重複發送網路請求
- 依照使用者的本地時區顯示日期時間
- 相容 YouTube 2024+ 新版首頁 UI（`yt-lockup-view-model`）
- SPA 換頁後即時更新，不殘留舊影片的日期
- 支援 Shorts、播放清單（Watch Later、Liked Videos）、推薦欄、訂閱頁、觀看紀錄等所有有影片的頁面

**v8.0 更新**
- 新增支援：推薦欄（watch page 右側）、Watch Later、Liked Videos、自訂播放清單
- 新增支援：Shorts shelf（`ytd-reel-item-renderer`）及 Shorts URL 格式解析
- 修復：SPA 換頁後推薦欄不更新（`yt-navigate-finish` 觸發全面清除並重新掃描）
- 新增注入備援目標（`#meta`、`#details`），提高對未知頁面類型的相容性
