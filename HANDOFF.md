# Project Handoff

## Latest Session: 2026-06-16

### 做了什麼

**1. YouTube extension（`youtube-video-upload-time`，已更名為「YouTube 精確時間」/ en「YouTube Precise Time」）一路從 v9.2 做到 v9.10**
- **Shorts 日期卡在第一支的 bug（根因）**：日期原本讀 `document.head` 的 `<meta itemprop>`，但 YouTube 只在整頁載入時寫 head meta，SPA 換頁（含 Shorts 上下滑）不更新 → 永遠是第一支的日期，還把錯日期以「別支影片的 ID」寫進 180 天 cache 污染首頁卡片。改成 `getPageDateForVideo(videoId, trustHeadMeta)`：head meta 只信任整頁載入的第一支、JSON-LD 須驗證 `embedUrl` 含當前 ID，否則以 videoId 去 fetch。cache key `v_` → `v2_`（存原始 ISO），舊 `v_` 整批作廢。
- **badge 加 `data-video-id`**：URL 一變就替換，不依賴 `yt-navigate-finish`（Shorts 滑動不一定發此事件）。
- **v9.3–9.4 icon**：原本 manifest 沒宣告 icon（顯示灰拼圖），補上 `icons` + `action.default_icon`；最終 icon 用 Stan 手繪的圖（紅底時鐘 + YY-MM-DD），由 `tools/jpg-to-icons.js` 從照片轉出。
- **v9.6 / v9.7 console 警告靜音**：找不到元素的警告原本每次掃描都噴（元素其實只是還沒渲染）。抽成共用 `createMissTracker(label, getDetail)`，連續找不到滿 20 秒才警告一次。Shorts 標題與 watch page info target 都用它。移除舊的 `findElementWithWarn`。
- **v9.8 預抓**：grid 的 `IntersectionObserver` rootMargin 300px → 800px（`PREFETCH_MARGIN`），卡片捲到前就先抓好日期。
- **v9.9 Shorts「落地即抓」**：`onUrlMaybeChanged()`（便宜字串比對）掛在 `yt-navigate-finish` 和每次 DOM mutation 上 → URL 一變立刻抓，不等 300ms 節流；且把 fetch 從「等標題渲染」解耦（標題要 4–5 秒，fetch 只要 ~1 秒，現在並行）。**用 Chrome 連真實 Shorts 頁實測確認**：真正的「預載下一支」做不到（DOM 只掛一個 reel、`ytInitialData` 無後續 ID、無 preload 提示），下一支 ID 要等真實滑動手勢才由 YouTube 內部 API 取回。
- **v9.10 上架擋下**：Chrome Web Store 嫌 en description 過長（223 > 132 字元上限，這過長從動工前就存在）。改短到 130 字。zh_TW（73）與名稱都在範圍內。

**2. `claude-status-monitor` v1.0.1 → v1.0.2**：補上缺的 icon（Stan 手繪的橘色星芒 + 藍色工具圖，去背 + 裁切）。**只有 icon，零程式改動**。

**3. `tools/jpg-to-icons.js`**：通用 JPG→icon 轉換器（jpeg-js 解碼 + 內建 zlib 編 PNG，支援 `--transparent-bg` flood fill 去背、`--trim` 裁切到邊界）。取代了我先前自繪的醜 icon 產生器（已刪）。

**4. Repo 改名 `stan-chrome-extensions` → `chrome-extensions`**：GitHub 端已改名；in-repo 全域置換所有舊名引用（manifest homepage_url、PRIVACY/DESCRIPTION/STORE_LISTING 連結、popup.html、兩個 README、`generate_readme.py` 的 `REPO`、`package.json` 名 `→ chrome-extensions-tests`）；本地 remote 已 set-url 到新網址；本機資料夾也已改名。過程中撞到 GitHub Action 自動更新 README（版本號與 repo 名在同一行）的衝突，已用「取遠端最新版本號 + 重新置換 repo 名」解掉。

**5. 清理**：刪除/移出過時檔（舊 colonist 肥 zip、`tasks/icon-candidates/`、廢棄的 icon 生成 Python 腳本與 preview）。

### 關鍵決策
- **不做 Shorts「真正預載下一支」**：實機驗證下一支 ID 在頁面上根本不存在，唯一路徑是攔截 YouTube 私有 reel 序列 API（注入 main world、monkey-patch fetch），太脆弱、YouTube 一改版就壞。改做「落地即抓 + fetch 與標題並行」這個低風險槓桿。
- **警告改 warn-once-per-20s 而非完全移除**：保留「選擇器真的壞了」時的訊號價值，只是不讓正常渲染延遲狂刷 console。
- **icon 用 Stan 自己的手繪圖**，不用程式生成的（Stan 覺得生成的醜）。
- **repo 改名用單一字串置換**：`stan-chrome-extensions` → `chrome-extensions` 一個 pattern 就涵蓋 URL、資料夾名、`-tests` 套件名，因為它們都含這段字串。

### 目前狀態
- 能跑嗎：**是**。全 repo `npm test` = **160 tests pass**。
- 完成：YouTube v9.10、claude-status-monitor v1.0.2、repo 改名（GitHub + in-repo + remote + 本機資料夾)、兩個上架 ZIP 已備妥。
- 已 push：所有變更在 `origin/master`（最後 commit 與遠端同步）。

### 已知問題
- 無功能性問題。`tasks/` 是 gitignore（本機暫存），裡面的 `lessons.md`、`todo.md`、`store-assets/`、`build_store_assets.py` 保留。

### 下一步
1. **上架 YouTube**：到 Chrome Web Store Developer Dashboard 上傳 repo root 的 `youtube-precise-time-v9.10.zip`（manifest 在 ZIP 根目錄、已驗證），填 single purpose / 權限用途（只有 `storage`）/ 隱私（可貼 `youtube-video-upload-time/PRIVACY.md`），Submit for review。
2. **（可選）上架 claude-status-monitor**：若它已在商店上且想更新 icon，上傳 `claude-status-monitor-v1.0.2.zip`；若從未上架就忽略。
3. 商店 listing 的詳細說明/截圖在 Store listing 分頁填（不在 ZIP 裡），可用 `DESCRIPTION.md`。

### 給下一個 AI 的提示
- **Repo 路徑已改為** `C:\Users\stans\Projects\chrome-extensions`（舊的 `stan-chrome-extensions` 已不存在）。
- **這個環境的 Bash 工具會擋 `rm` / `mv`（含改名）** —— 被某個 guard 攔死。要刪/搬檔案得請使用者自己用 `!` 前綴跑，或在檔案總管手動處理。`Edit`/`Write`/`sed -i`/`git`/`zip` 都不受擋。
- **使用者的 `!` 前綴跑在 bash（git bash）；但他另開的終端是 PowerShell** —— 給指令時注意語法差異（PowerShell 的 `mv` = `Move-Item`，多來源要用逗號陣列）。
- **測試**：repo root `npm test`（`node --test`，jsdom）。content script 會偵測 CommonJS 環境、跳過 `boot()`、改 export 純函式供測試（youtube 與 colonist 都這樣）。
- **語言規則**：一律繁體中文，禁簡體字。
- **README 是自動生成的**（GitHub Action 跑 `.github/scripts/generate_readme.py`，版本號從各 manifest 讀）；手動改 README 後若 Action 重生可能蓋掉，版本相關的改動改 manifest 即可。
- 上架 ZIP 與 icon 原始照片（`S__*.jpg`）放在 repo root（未追蹤、刻意保留，icon 原圖供日後用 `jpg-to-icons.js` 重新生成）。
