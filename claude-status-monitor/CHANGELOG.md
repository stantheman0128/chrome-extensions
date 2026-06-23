# Changelog

## 1.2.0

變更

- uptime bar 的互動改成漸進式揭露：
  - **Hover**：滑過有事件的那天 → 浮卡預覽該天事件（名稱、狀態、中斷時長、最新一則）。無事件的日子維持精簡提示。
  - **點擊**：右欄 Active Incidents 換成那天的完整詳情，沿用可展開的事件時間軸卡片，並附返回鍵。
  - **取消**：返回 / 再點同一格 / 按 Esc → 回到 Active Incidents。背景每 30 秒重繪會自動還原已釘選的那天，不會被洗掉。
- 每張事件卡片新增「中斷時長」（⏱）：resolved 算到解決時間、monitoring 算到 `monitoring_at`（視為已恢復）、仍在調查中則標進行中。Active Incidents 與每日詳情都會顯示。
- 時間軸維持 30 天：公開 status API 固定只回最近 50 筆事件（約涵蓋 29 天），再往前的日子沒有資料會假性全綠，因此不延長視窗。

## 1.1.0

新增

- 點某個服務元件某一天的 uptime bar，會跳出浮動小卡，列出那天影響該元件的事件：名稱、嚴重度、目前狀態與最新一則說明。沒有事件的日子點了不動作。再點同一格、點別處、按 Esc 或捲動即關閉。
- background 多輸出 `dayIncidents`（每元件每天的事件索引）與精簡的 `incidentsById`，供小卡查詢。索引與 bar 著色共用同一段影響區間，所以長期掛在 monitoring 的公告只會出現在發布當天那格。

## 1.0.3

修正

- 進入 `monitoring` 的事件不再把每日 uptime bar 一路畫到今天。一則修復已部署、長期掛在 monitoring 的事件（例如暫停 Mythos/Fable 存取的公告）原本會從建立日起天天顯示紅色嚴重事件；現在影響只算到 `monitoring_at` 為止，其餘日子維持正常。
- content script 改用 background 傳來的 `historyDays`，移除前後兩支檔案各自寫死天數造成的潛在錯位。
- 擴充功能重載後不再每 30 秒丟出 "Extension context invalidated"。偵測到 runtime 失效時停掉輪詢與計時器。
