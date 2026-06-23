# Changelog

## 1.1.0

新增

- 點某個服務元件某一天的 uptime bar，會跳出浮動小卡，列出那天影響該元件的事件：名稱、嚴重度、目前狀態與最新一則說明。沒有事件的日子點了不動作。再點同一格、點別處、按 Esc 或捲動即關閉。
- background 多輸出 `dayIncidents`（每元件每天的事件索引）與精簡的 `incidentsById`，供小卡查詢。索引與 bar 著色共用同一段影響區間，所以長期掛在 monitoring 的公告只會出現在發布當天那格。

## 1.0.3

修正

- 進入 `monitoring` 的事件不再把每日 uptime bar 一路畫到今天。一則修復已部署、長期掛在 monitoring 的事件（例如暫停 Mythos/Fable 存取的公告）原本會從建立日起天天顯示紅色嚴重事件；現在影響只算到 `monitoring_at` 為止，其餘日子維持正常。
- content script 改用 background 傳來的 `historyDays`，移除前後兩支檔案各自寫死天數造成的潛在錯位。
- 擴充功能重載後不再每 30 秒丟出 "Extension context invalidated"。偵測到 runtime 失效時停掉輪詢與計時器。
