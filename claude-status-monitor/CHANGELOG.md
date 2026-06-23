# Changelog

## 1.0.3

修正

- 進入 `monitoring` 的事件不再把每日 uptime bar 一路畫到今天。一則修復已部署、長期掛在 monitoring 的事件（例如暫停 Mythos/Fable 存取的公告）原本會從建立日起天天顯示紅色嚴重事件；現在影響只算到 `monitoring_at` 為止，其餘日子維持正常。
- content script 改用 background 傳來的 `historyDays`，移除前後兩支檔案各自寫死天數造成的潛在錯位。
- 擴充功能重載後不再每 30 秒丟出 "Extension context invalidated"。偵測到 runtime 失效時停掉輪詢與計時器。
