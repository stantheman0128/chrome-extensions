## Claude Status Monitor

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
