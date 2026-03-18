# 貢獻指南 / Extension 開發規範

本文件說明如何在此 repo 新增一個 Chrome Extension，並確保自動化流程（打包、README 更新）能正確運作。

---

## 每個 Extension 的必要結構

```
stan-chrome-extensions/
└── your-extension-name/          ← 資料夾名稱用 kebab-case（小寫 + 連字號）
    ├── manifest.json             ← 必要：Extension 元數據
    ├── content.js                ← 必要（或其他邏輯檔案）
    └── DESCRIPTION.md            ← 選填：README 使用的詳細中文說明
```

> **不需要手動修改 `README.md`。** 它由 GitHub Actions 在每次 push 後自動生成。

---

## manifest.json 規範

必須符合 **Manifest V3** 格式，且以下欄位為必要：

```json
{
  "manifest_version": 3,
  "name": "Extension 名稱（會顯示在 README 標題）",
  "version": "1.0",
  "description": "一行簡短說明（若無 DESCRIPTION.md，此欄位將出現在 README）",
  "content_scripts": [
    {
      "matches": ["*://*.example.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

---

## DESCRIPTION.md 規範

選填。若存在，其內容會取代 `manifest.json` 的 `description` 欄位，出現在 README 的詳細說明區塊。

建議格式：

```markdown
一句話介紹這個 Extension 做什麼、解決什麼問題。

**功能特色**
- 功能點 1
- 功能點 2
- 功能點 3
```

參考範例：`youtube-video-upload-time/DESCRIPTION.md`

---

## 資料夾命名規則

- 使用 **kebab-case**（全小寫，以連字號分隔）
- 名稱應直接描述功能

| ✅ 正確 | ❌ 錯誤 |
|--------|--------|
| `dark-mode-toggle` | `DarkModeToggle` |
| `tab-auto-close` | `tab_auto_close` |
| `youtube-ad-skip` | `youtubeAdSkip` |

---

## 自動化流程說明

每次 push 到 `master`，GitHub Actions 會自動執行：

1. 掃描 repo 根目錄所有含 `manifest.json` 的子目錄
2. 將每個 Extension 打包為 `<資料夾名>.zip`（解壓縮後即得可直接載入的資料夾）
3. 執行 `.github/scripts/generate_readme.py` 重新生成 `README.md`
4. 若 README 有變動，自動 commit 回 `master`
5. 更新 GitHub Release `latest`，附上所有最新的 `.zip`

---

## 版本與變更日誌規範（必做）

每次對任何 extension 有行為、功能、權限、UI、文件或相容性變更時，必須同時完成以下兩件事：

1. 更新該 extension 的 `manifest.json` 中 `version`
2. 更新 repo 根目錄 `CHANGELOG.md`，新增本次變更摘要

建議版本規則：

- 修正 bug / 小幅調整：`patch`（例如 `1.0.1` -> `1.0.2`）
- 向下相容新功能：`minor`（例如 `1.0.2` -> `1.1.0`）
- 破壞性變更：`major`（例如 `1.1.0` -> `2.0.0`）

未同時更新 `version` 與 `CHANGELOG.md` 的變更，不應合併或發布。

---

## 請 AI 新增 Extension 的標準提示詞

當你要請 AI（如 Claude）新增一個 Extension 時，可以直接複製以下提示詞：

---

**提示詞模板：**

```
請在 `stan-chrome-extensions` 這個 GitHub Repo 的根目錄，
新增一個名為 `[extension-name]` 的子目錄，並建立以下檔案：

1. `manifest.json`（Manifest V3）：
   - manifest_version: 3
   - name: "[Extension 顯示名稱]"
   - version: "1.0"
   - description: "[一行簡短英文說明]"
   - 根據功能加上 permissions、content_scripts 等必要欄位

2. `content.js`：
   [在此描述 Extension 的功能與邏輯需求]

3. `DESCRIPTION.md`（選填）：
   用繁體中文撰寫詳細功能說明，格式參考現有的
   `youtube-video-upload-time/DESCRIPTION.md`

注意：不需要修改 README.md，GitHub Actions 推上 master 後會自動更新。
```

---

## 相關檔案

| 檔案 | 說明 |
|------|------|
| `.github/workflows/package-extensions.yml` | 自動打包與 README 更新的 CI 流程 |
| `.github/scripts/generate_readme.py` | README 自動生成腳本（讀取 manifest.json + DESCRIPTION.md）|

---

## 安裝 Extension（開發者模式）

1. 下載 GitHub Releases 頁面的 `.zip` 並解壓縮
2. 開啟 Chrome → `chrome://extensions`
3. 啟用右上角**開發人員模式**
4. 點擊**載入未封裝項目**，選擇解壓縮後的資料夾

---

## youtube-video-upload-time — 未來規劃

### 功能想法

| 項目 | 說明 |
|------|------|
| **使用者設定介面** | popup 讓使用者選擇日期格式（`YYYY-MM-DD` / `MM/DD/YYYY`）、是否顯示時間、badge 顏色 |
| **Shorts 觀看頁面** | `/shorts/ID` 的觀看頁本身目前無精確日期，DOM 結構與 `/watch` 不同，需另行處理 |
| **YouTube Studio 支援** | Studio 管理頁面有影片列表，可考慮注入上傳日期方便管理 |
| **通知頁（Notifications）** | Notification 鈴鐺展開後有影片卡片，目前未覆蓋 |

### 已知可優化項目

| 項目 | 現況 | 改善方向 |
|------|------|----------|
| **Cache 清理機制** | `chrome.storage.local` 只增不減，長期使用會累積大量舊 entry | 加入 TTL（例如 6 個月未命中自動清除）或 LRU 淘汰策略 |
| **MAX_CONCURRENT 動態調整** | 目前固定 5，stream 後每個 request 輕很多 | 可依網路速度或 CPU 使用率動態調整上限 |
| **YouTube DOM 相容性** | YouTube 不定期改版 DOM 結構，selector 可能失效 | 加入更多 fallback 並在失效時 console.warn 方便除錯 |
| **Watch History 篩選頁** | 目前只處理 `/feed/history`，history 搜尋結果（`/results?...`）未特化 | 偵測 history 搜尋結果並套用相同 selector 策略 |

### 架構備忘

- **`streamFindDate()`** 的 `OVERLAP = 200` 字元是為了處理日期字串被切在兩個 chunk 邊界的情況，最長的 pattern 約 50 字元，200 有充裕的緩衝
- **`v_` key prefix** 是為了未來在 `chrome.storage.local` 存放其他設定時避免衝突，例如 `settings_dateFormat`
- `ytd-video-renderer` 在 History / 訂閱 / 搜尋結果三種場景的 DOM 結構略有差異，目前以 `pathname === '/feed/history'` 分支處理，若日後有其他差異場景可依此模式擴充
