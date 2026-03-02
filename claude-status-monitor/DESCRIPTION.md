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
