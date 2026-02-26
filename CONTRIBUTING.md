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
