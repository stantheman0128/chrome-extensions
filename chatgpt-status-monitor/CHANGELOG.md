# Changelog

## 1.0.0

First release.

在 chatgpt.com 即時顯示 OpenAI／ChatGPT 服務狀態，移植自 Claude Status Monitor 的架構，並針對 OpenAI 的資料來源重新設計。

- 角落浮動狀態徽章，顏色對應整體狀態；點開為雙欄儀表板（左：30 天運行時間軸；右：進行中事件）。
- 資料來自 OpenAI 狀態 API（Atlassian Statuspage 相容層，由 incident.io 提供）。OpenAI 的 `incidents/unresolved.json` 端點會回 404，故改用 `summary.json` 內建的未解決事件清單。
- OpenAI 的事件不連結個別服務元件，無法重建每元件歷史，因此左欄改為「OpenAI 整體」一條 30 天時間軸（每天取當天最嚴重的事件嚴重度上色），下方再列各元件目前狀態。
- 運行時間百分比採可用性定義：只有 major／critical 全面中斷才扣 uptime，minor 降速仍算可用（但會在時間軸上以黃色標出）。
- ChatGPT 灰階單色主題（2025 識別），黑色 accent，狀態綠用通用 `#16A34A`（刻意避開 OpenAI 品牌 teal `#10A37F`）。
- 中英雙語、可拖曳縮放、字級可調，偏好存於本機。Shadow DOM 隔離樣式。
- 自繪原創 icon（脈搏線＋狀態點），未使用 OpenAI 商標或標誌；商店描述標明非官方。
