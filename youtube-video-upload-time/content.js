
const dateCache = new Map(); // videoId -> 原始 ISO 日期字串（顯示時才轉換）

// === Cache TTL 設定 ===
const CACHE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 天
const CACHE_PREFIX = 'v2_'; // v9.2 起存原始 ISO；v_ 舊資料可能含 stale-meta 錯誤日期，一律作廢

// 清除過期及舊格式的 cache 項目
async function cleanupStaleCache() {
    const now = Date.now();
    try {
        const items = await chrome.storage.local.get(null);
        const keysToRemove = [];

        for (const [key, value] of Object.entries(items)) {
            if (key.startsWith(CACHE_PREFIX)) {
                const broken = !(typeof value === 'object' && value !== null && typeof value.raw === 'string');
                if (broken || now - (value.cachedAt || 0) > CACHE_MAX_AGE_MS) {
                    keysToRemove.push(key);
                }
            } else if (key.startsWith('v_')) {
                // v9.1 以前的格式：Shorts stale-meta bug 可能寫入「別支影片的日期」，整批作廢重抓
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log(`[YT Upload Time] Cleaned up ${keysToRemove.length} stale cache entries`);
        }
    } catch (e) {
        console.warn('[YT Upload Time] Cache cleanup failed:', e);
    }
}

const processingQueue = new Set();
const processedMark = 'data-exact-date-processed';
let activeRequests = 0;
const MAX_CONCURRENT = 12;

// === DOM 選擇器回退機制 ===
// YouTube 經常更改 DOM 結構，使用多重選擇器確保穩定性
function findElement(selectors, context = document) {
    for (const selector of selectors) {
        const el = context.querySelector(selector);
        if (el) return el;
    }
    return null;
}

function findElementWithWarn(selectors, label, context = document) {
    const el = findElement(selectors, context);
    if (!el) {
        console.warn(`[YT Upload Time] Could not find ${label} with any known selector:`, selectors);
    }
    return el;
}

// === 核心功能：時區與時間轉換器 ===
function convertToLocalTime(isoDateStr, includeTime = false) {
    try {
        const localDate = new Date(isoDateStr);
        if (isNaN(localDate.getTime())) return null;

        const y = localDate.getFullYear();
        const m = String(localDate.getMonth() + 1).padStart(2, '0');
        const d = String(localDate.getDate()).padStart(2, '0');

        if (includeTime) {
            const hh = String(localDate.getHours()).padStart(2, '0');
            const mm = String(localDate.getMinutes()).padStart(2, '0');
            const ss = String(localDate.getSeconds()).padStart(2, '0');
            return y + '-' + m + '-' + d + ' ' + hh + ':' + mm + ':' + ss;
        }

        return y + '-' + m + '-' + d;
    } catch(e) {
        return null;
    }
}

function hasTimeComponent(isoStr) {
    return typeof isoStr === 'string' && isoStr.includes('T') && isoStr.length > 11;
}

// 將原始 ISO 字串轉成顯示文字（無時間成分時自動退回日期）
function displayDate(rawIso, includeTime) {
    return convertToLocalTime(rawIso, includeTime && hasTimeComponent(rawIso))
        || String(rawIso).split('T')[0];
}

// 從各種 YouTube URL 格式取得 video ID
// 支援 /watch?v=ID 和 /shorts/ID
function getVideoId(href) {
    try {
        const url = new URL(href);
        const v = url.searchParams.get('v');
        if (v) return v;
        const shorts = url.pathname.match(/^\/shorts\/([^/?#]+)/);
        if (shorts) return shorts[1];
    } catch(e) {}
    return null;
}

// 整頁載入當下的影片 ID：head 的 meta tags 只屬於這支影片。
// SPA 換頁（含 Shorts 上下滑）不會更新 head meta，之後一律不可信任。
const INITIAL_VIDEO_ID = getVideoId(window.location.href);

// 寫入記憶體 + 持久化 cache（存原始 ISO，顯示端各取所需精度）
function cacheRaw(videoId, rawIso) {
    const existing = dateCache.get(videoId);
    if (existing === rawIso) return;
    // 已有含時間的版本時，不用 date-only 覆蓋
    if (existing && hasTimeComponent(existing) && !hasTimeComponent(rawIso)) return;
    dateCache.set(videoId, rawIso);
    try {
        chrome.storage.local.set({ [CACHE_PREFIX + videoId]: { raw: rawIso, cachedAt: Date.now() } });
    } catch (e) {}
}

// ==========================================
// Stream 讀取：找到日期就立即停止，不再下載剩餘 HTML
// ==========================================
async function streamFindDate(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // 保留尾部 200 字元作為跨 chunk 邊界的緩衝
    // 搜尋過且未找到的部分可以安全丟棄，避免記憶體無限成長
    const OVERLAP = 200;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const rawDate = extractDateFromHtml(buffer);
            if (rawDate) return rawDate;

            if (buffer.length > OVERLAP) {
                buffer = buffer.slice(-OVERLAP);
            }
        }
        buffer += decoder.decode();
        return extractDateFromHtml(buffer);
    } finally {
        reader.cancel().catch(() => {});
    }
}

// ==========================================
// 取得頁面上「確定屬於 videoId」的日期
// trustHeadMeta 只有在 videoId === INITIAL_VIDEO_ID 時才能為 true
// ==========================================
function getPageDateForVideo(videoId, trustHeadMeta) {
    if (trustHeadMeta) {
        const published = document.querySelector('meta[itemprop="datePublished"]');
        const uploaded  = document.querySelector('meta[itemprop="uploadDate"]');
        const pubContent = published ? published.getAttribute('content') : null;
        const upContent  = uploaded  ? uploaded.getAttribute('content')  : null;

        if (pubContent && hasTimeComponent(pubContent)) return pubContent;
        if (upContent  && hasTimeComponent(upContent))  return upContent;
        if (pubContent || upContent) return pubContent || upContent;
    }

    // JSON-LD：必須驗證 embedUrl/url 含這支影片的 ID 才能信任
    // （SPA 換頁後殘留的 JSON-LD 可能仍描述上一支影片）
    for (const ldScript of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
            const data = JSON.parse(ldScript.textContent);
            const urls = [data.embedUrl, data.url, data['@id']].filter(Boolean).join(' ');
            if (!urls.includes(videoId)) continue;
            const date = data.uploadDate || data.datePublished;
            if (date) return date;
        } catch(e) {}
    }

    return null;
}

// 從 fetch 回來的 HTML 文字中擷取日期
function extractDateFromHtml(htmlText) {
    const metaPatterns = [
        /<meta\s+itemprop="datePublished"\s+content="([^"]+)"/,
        /<meta\s+content="([^"]+)"\s+itemprop="datePublished"/,
        /<meta\s+itemprop="uploadDate"\s+content="([^"]+)"/,
        /<meta\s+content="([^"]+)"\s+itemprop="uploadDate"/,
    ];
    for (const re of metaPatterns) {
        const m = htmlText.match(re);
        if (m) return m[1];
    }

    // JSON-LD uploadDate（含完整時間，如 "2023-04-15T09:32:07+00:00"）
    const ldMatch = htmlText.match(/"uploadDate"\s*:\s*"([^"]+)"/);
    if (ldMatch) return ldMatch[1];

    // ytInitialPlayerResponse publishDate（日期格式）
    const jsonMatch = htmlText.match(/"publishDate"\s*:\s*"(\d{4}-\d{2}-\d{2}[^"]*)"/);
    if (jsonMatch) return jsonMatch[1];

    return null;
}

// ==========================================
// 共用 fetch：以 videoId 抓 /watch HTML 取日期（結果必定屬於該 videoId）
// 回傳原始 ISO 字串或 null；成功時自動寫入 cache
// ==========================================
async function requestRawDate(videoId) {
    if (dateCache.has(videoId)) return dateCache.get(videoId);
    if (processingQueue.has(videoId) || activeRequests >= MAX_CONCURRENT) return null;
    processingQueue.add(videoId);
    activeRequests++;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch('/watch?v=' + videoId, { signal: controller.signal });
        clearTimeout(timer);
        const rawDate = await streamFindDate(response);
        if (rawDate) cacheRaw(videoId, rawDate);
        return rawDate;
    } catch (e) {
        // 逾時或網路失敗，靜默處理
        return null;
    } finally {
        activeRequests--;
        processingQueue.delete(videoId);
        // 空出名額 → 立即喚醒掃描，讓因額滿而等待的卡片馬上補位
        // （否則頁面靜止時要等 3 秒的安全網輪詢）
        scheduleScan();
    }
}

// ==========================================
// 1. 處理「一般影片播放頁面」：精確到秒
// ==========================================
function injectWatchPageDate() {
    if (!window.location.pathname.startsWith('/watch')) return;
    const videoId = getVideoId(window.location.href);
    if (!videoId) return;

    // badge 已存在且屬於當前影片 → 不需重做
    const existing = document.getElementById('yt-exact-date-watch-desc');
    if (existing && existing.getAttribute('data-video-id') === videoId) return;

    const rawDate = getPageDateForVideo(videoId, videoId === INITIAL_VIDEO_ID);
    if (rawDate) {
        cacheRaw(videoId, rawDate);
        renderWatchBadge(videoId, rawDate);
        return;
    }

    if (dateCache.has(videoId)) {
        renderWatchBadge(videoId, dateCache.get(videoId));
        return;
    }

    // SPA 換頁後頁面上沒有可驗證的日期 → fetch（結果以 videoId 為準，不會抓錯）
    requestRawDate(videoId).then(raw => {
        if (raw && getVideoId(window.location.href) === videoId) {
            renderWatchBadge(videoId, raw);
        }
    });
}

function renderWatchBadge(videoId, rawIso) {
    const infoTarget = findElementWithWarn([
        'ytd-watch-metadata #info',
        'ytd-watch-metadata #description-inner #info',
        'ytd-watch-metadata #info-container',
        '#above-the-fold #info',
        'ytd-video-primary-info-renderer #info',
        'ytd-watch-metadata #owner',                       // 備用：owner 區塊
        'ytd-watch-metadata',                               // 最後手段：整個 metadata 區塊
    ], 'watch page info target');
    if (!infoTarget) return;

    let descTag = document.getElementById('yt-exact-date-watch-desc');
    if (!descTag) {
        descTag = document.createElement('span');
        descTag.id = 'yt-exact-date-watch-desc';
        descTag.style.cssText = 'color: #065fd4; font-weight: 600; margin-left: 10px; font-size: 1.4rem; background: #e8f0fe; padding: 2px 6px; border-radius: 4px; display: inline-block; vertical-align: middle;';
        infoTarget.appendChild(descTag);
    }

    descTag.setAttribute('data-video-id', videoId);
    const text = displayDate(rawIso, true);
    if (descTag.textContent !== text) {
        descTag.textContent = text;
    }
}

// ==========================================
// 2. 處理「Shorts 播放頁面」：注入在標題下方
// ==========================================
const SHORTS_TITLE_SELECTORS = [
    '.ytShortsVideoTitleViewModelShortsVideoTitle',
    'yt-shorts-video-title-view-model',                // 可能的新版 tag
    '.shorts-video-title',                              // 備用 class
    'ytd-reel-video-renderer h2',                       // 舊版 Shorts 標題
];

// 舊版 Shorts 播放器會同時保留上下多支 reel 的 DOM，
// 必須鎖定「目前播放中」那支的標題，不能拿全文件第一個 match。
// 找不到時保持安靜：標題 overlay 在導航後要數秒才渲染，由
// noteShortsTitleMiss() 判斷是否「久到不正常」才警告。
function findActiveShortsTitle() {
    const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (activeReel) {
        const el = findElement(SHORTS_TITLE_SELECTORS, activeReel);
        if (el) return el;
    }
    // 2026-06 起：DOM 只保留一個 reel 容器（不再標 is-active），捲動時原地置換內容
    const reels = document.querySelectorAll('ytd-reel-video-renderer');
    if (reels.length === 1) {
        const el = findElement(SHORTS_TITLE_SELECTORS, reels[0]);
        if (el) return el;
    }
    // 備援：挑出現在視窗範圍內的標題（非當前 reel 的標題位於視窗外）
    for (const sel of SHORTS_TITLE_SELECTORS) {
        for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) return el;
        }
    }
    return findElement(SHORTS_TITLE_SELECTORS);
}

// 連續找不到標題超過這個時間才警告（正常渲染延遲實測約 4~5 秒）
const SHORTS_TITLE_WARN_AFTER_MS = 20000;
let shortsTitleMissSince = null; // 本次連續 miss 的起始時間戳
let shortsTitleWarned = false;   // 每段連續 miss 只警告一次

function noteShortsTitleMiss(now = Date.now()) {
    if (shortsTitleMissSince === null) shortsTitleMissSince = now;
    if (!shortsTitleWarned && now - shortsTitleMissSince >= SHORTS_TITLE_WARN_AFTER_MS) {
        shortsTitleWarned = true;
        console.warn(
            '[YT Upload Time] Shorts title element still missing after ' +
            Math.round((now - shortsTitleMissSince) / 1000) +
            's — YouTube DOM 可能已改版，選擇器需要更新:', SHORTS_TITLE_SELECTORS
        );
    }
}

function resetShortsTitleMiss() {
    shortsTitleMissSince = null;
    shortsTitleWarned = false;
}

function injectShortsWatchDate() {
    const shortsMatch = window.location.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (!shortsMatch) return;
    const videoId = shortsMatch[1];

    // badge 屬於當前 Short → 完成；屬於上一支 → 移除重來
    const existing = document.getElementById('yt-exact-date-shorts-watch');
    if (existing) {
        if (existing.getAttribute('data-video-id') === videoId) return;
        existing.remove();
    }

    const titleEl = findActiveShortsTitle();
    if (!titleEl) { noteShortsTitleMiss(); return; }
    resetShortsTitleMiss();

    // 只信任「可驗證屬於這支影片」的頁面日期；
    // head meta 僅在整頁載入的第一支 Short 有效，滑動切換後不可信
    const rawDate = getPageDateForVideo(videoId, videoId === INITIAL_VIDEO_ID);
    if (rawDate) {
        cacheRaw(videoId, rawDate);
        _doInjectShortsWatchBadge(titleEl, videoId, rawDate);
        return;
    }

    if (dateCache.has(videoId)) {
        _doInjectShortsWatchBadge(titleEl, videoId, dateCache.get(videoId));
        return;
    }

    _fetchAndInjectShortsWatchDate(videoId);
}

async function _fetchAndInjectShortsWatchDate(videoId) {
    const rawDate = await requestRawDate(videoId);
    if (!rawDate) return;
    // 確認使用者還停在同一支 Short
    const m = window.location.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (!m || m[1] !== videoId) return;
    const titleEl = findActiveShortsTitle();
    if (titleEl) _doInjectShortsWatchBadge(titleEl, videoId, rawDate);
}

function _doInjectShortsWatchBadge(titleEl, videoId, rawIso) {
    const existing = document.getElementById('yt-exact-date-shorts-watch');
    if (existing) {
        if (existing.getAttribute('data-video-id') === videoId) return;
        existing.remove();
    }
    const badge = document.createElement('div');
    badge.id = 'yt-exact-date-shorts-watch';
    badge.setAttribute('data-video-id', videoId);
    badge.style.cssText = 'color: #065fd4; font-weight: 600; font-size: 1.2rem; background: #e8f0fe; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px;';
    badge.textContent = displayDate(rawIso, true);
    titleEl.insertAdjacentElement('afterend', badge);
}

// ==========================================
// SPA 換頁事件：清除所有舊 badge 與 processedMark
// 讓下一次掃描重新注入（badge 另有 data-video-id 比對作雙保險，
// 涵蓋 Shorts 上下滑等不觸發此事件的切換方式）
// ==========================================
function onNavigateFinish() {
    // Watch page badge
    const oldTag = document.getElementById('yt-exact-date-watch-desc');
    if (oldTag) oldTag.remove();

    // Shorts watch page badge
    const oldShortsTag = document.getElementById('yt-exact-date-shorts-watch');
    if (oldShortsTag) oldShortsTag.remove();

    // 清除所有影片卡片上的舊標記和舊 badge
    // YouTube SPA 換頁後會原地更新卡片內容，若不清除則不會重新注入
    document.querySelectorAll('[' + processedMark + ']').forEach(el => {
        el.removeAttribute(processedMark);
        el.querySelectorAll('.yt-exact-date-grid').forEach(b => b.remove());
    });
}

// ==========================================
// 3. 處理所有影片卡片列表（首頁、推薦欄、訂閱、歷史、播放清單、Shorts ...）
// ==========================================
let observer = null; // IntersectionObserver，於 boot() 建立

function processGridVideos() {
    const selectors = [
        // 首頁舊版（ytd-rich-grid-media 是 ytd-rich-item-renderer 的子元素，有 #metadata-line）
        // 不用 ytd-rich-item-renderer（它和 ytd-rich-grid-media 同時存在會重複注入）
        'ytd-rich-grid-media',
        // 頻道、搜尋
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        // 推薦欄（watch page 右側）
        'ytd-compact-video-renderer',
        // 播放清單（Watch Later、Liked Videos、自訂播放清單）
        'ytd-playlist-video-renderer',
        // 新版 UI（首頁 / 訂閱頁 2024+ yt-lockup-view-model）
        'yt-lockup-view-model',
        'yt-lockup-view-model-wiz',
        // Shorts shelf 卡片（ytm- 前綴，桌面版實際 tag）
        'ytm-shorts-lockup-view-model',
        'ytm-shorts-lockup-view-model-wiz',
        // 舊版 reel item（保留備用）
        'ytd-reel-item-renderer',
    ].map(s => s + ':not([' + processedMark + '])').join(', ');

    document.querySelectorAll(selectors).forEach(container => {
        container.setAttribute(processedMark, 'true');
        observer.observe(container);
    });
}

async function fetchExactDateForVideo(container) {
    // 支援 /watch?v=ID 和 /shorts/ID 連結
    const linkEl =
        container.querySelector('a#video-title-link, a#video-title, a#thumbnail') ||
        container.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
    if (!linkEl || !linkEl.href) return;

    const videoId = getVideoId(linkEl.href);
    if (!videoId) return;

    const isHistoryPage = window.location.pathname === '/feed/history';

    // 根據 container 類型分層查找 metadata 注入目標
    const tag = container.tagName.toLowerCase();
    let metaLine = null;

    if (tag === 'ytd-video-renderer' && isHistoryPage) {
        // History 頁面：跳過 metaLine，使用獨立的 injectDateForHistory()
        // （History 的 DOM 容器包含 description，appendChild 會被 flex 擠到說明文字旁邊）

    } else if (tag === 'ytd-video-renderer') {
        // 訂閱頁列表格式（水平卡片：縮圖左、內容右）
        // 優先找右側內容區域（#meta/#info）內的 #metadata-line，避免誤抓縮圖左側
        metaLine =
            container.querySelector('#meta #metadata-line')                 ||
            container.querySelector('#info #metadata-line')                 ||
            container.querySelector('ytd-video-meta-block #metadata-line') ||
            container.querySelector('ytd-video-meta-block')                 ||
            container.querySelector('#metadata-line')                       ||
            container.querySelector('#metadata');

    } else if (tag === 'ytd-compact-video-renderer') {
        // 推薦欄緊湊格式（watch page 右側）
        metaLine =
            container.querySelector('ytd-compact-video-meta-block #metadata-line') ||
            container.querySelector('ytd-compact-video-meta-block')                 ||
            container.querySelector('#metadata-line')                               ||
            container.querySelector('#metadata');

    } else if (tag === 'ytd-rich-item-renderer' || tag === 'ytd-rich-grid-media') {
        // 首頁舊版 rich grid
        metaLine =
            container.querySelector('ytd-video-meta-block #metadata-line') ||
            container.querySelector('#metadata-line')                       ||
            container.querySelector('ytd-video-meta-block')                 ||
            container.querySelector('#metadata');

    } else if (tag === 'yt-lockup-view-model' || tag === 'yt-lockup-view-model-wiz') {
        // 首頁 / 訂閱頁 2024+ 新版 UI
        // DOM 結構：yt-content-metadata-view-model > div.metadata-row[0]=頻道 > div.metadata-row[1]=views•date
        // 注入到最後一個 metadata-row 才能和 "views • X ago" 同一行
        const contentMeta = container.querySelector('yt-content-metadata-view-model');
        if (contentMeta) {
            if (isHistoryPage) {
                metaLine = contentMeta.querySelector(
                    '.yt-content-metadata-view-model__metadata-row--metadata-row-padding'
                ) || contentMeta;
            } else {
                const rows = contentMeta.querySelectorAll('.yt-content-metadata-view-model__metadata-row');
                metaLine = rows[rows.length - 1] || contentMeta;
            }
        }
        metaLine = metaLine ||
            container.querySelector('.yt-lockup-metadata-view-model__metadata') ||
            container.querySelector('#metadata-line')                            ||
            container.querySelector('#metadata');

    } else if (
        tag === 'ytm-shorts-lockup-view-model' ||
        tag === 'ytm-shorts-lockup-view-model-wiz' ||
        tag === 'ytd-reel-item-renderer'
    ) {
        // Shorts shelf 卡片：注入到 views 旁邊的 subhead div
        metaLine =
            container.querySelector('.shortsLockupViewModelHostOutsideMetadataSubhead') ||
            container.querySelector('.shortsLockupViewModelHostMetadataSubhead')        ||
            container.querySelector('#metadata-line')                                   ||
            container.querySelector('#metadata');

    } else {
        // 其他（ytd-grid-video-renderer、ytd-playlist-video-renderer 等）
        metaLine =
            container.querySelector('#metadata-line')                       ||
            container.querySelector('ytd-video-meta-block #metadata-line') ||
            container.querySelector('#metadata')                            ||
            container.querySelector('yt-video-attributes-view-model')      ||
            container.querySelector('ytd-video-meta-block')                 ||
            container.querySelector('#meta')                                ||
            container.querySelector('#details');
    }

    // Fallback：找不到任何 metaLine 時，用 container 本身當作注入點（ytd-video-renderer on History 除外）
    if (!metaLine && !(isHistoryPage && tag === 'ytd-video-renderer')) metaLine = container;

    if (dateCache.has(videoId)) {
        const text = displayDate(dateCache.get(videoId), false);
        if (isHistoryPage && tag === 'ytd-video-renderer') {
            injectDateForHistory(container, text);
        } else {
            injectDateIntoDOM(metaLine, text);
        }
        observer.unobserve(container);
        return;
    }

    if (processingQueue.has(videoId) || activeRequests >= MAX_CONCURRENT) {
        // 放回去讓下次掃描重新處理：移除 processedMark + unobserve
        // （同一影片已在抓取中、或併發額滿 — 等 cache 就緒後再注入）
        // IntersectionObserver 不會對已可見元素重複觸發，需要重新 observe 才能再次觸發
        container.removeAttribute(processedMark);
        observer.unobserve(container);
        return;
    }

    const rawDate = await requestRawDate(videoId);
    if (rawDate) {
        const text = displayDate(rawDate, false);
        if (isHistoryPage && tag === 'ytd-video-renderer') {
            injectDateForHistory(container, text);
        } else {
            injectDateIntoDOM(metaLine, text);
        }
    }
    observer.unobserve(container);
}

function makeDateBadgeSpan(exactDate) {
    const badge = document.createElement('span');
    badge.style.cssText = 'color: #065fd4; font-weight: 600; font-size: 1.2rem; background: #e8f0fe; padding: 2px 5px; border-radius: 4px;';
    badge.textContent = exactDate;
    return badge;
}

function injectDateIntoDOM(metaLine, exactDate) {
    if (metaLine.querySelector('.yt-exact-date-grid')) return;

    const dateBadge = document.createElement('span');
    dateBadge.className = 'yt-exact-date-grid';
    dateBadge.style.cssText = 'display: inline-block; vertical-align: middle; margin-left: 4px;';

    const dot = document.createElement('span');
    dot.style.cssText = 'color: var(--yt-spec-text-secondary, #606060); margin-right: 6px;';
    dot.textContent = '•';
    dateBadge.appendChild(dot);
    dateBadge.appendChild(makeDateBadgeSpan(exactDate));

    metaLine.appendChild(dateBadge);
}

// History 頁面專用：在 ytd-video-meta-block 後面（description 前面）插入獨立日期行
// 不用 appendChild（會被 flex 擠進 description），改用 insertAdjacentElement 作為 sibling
function injectDateForHistory(container, exactDate) {
    if (container.querySelector('.yt-exact-date-grid')) return;

    const anchor = container.querySelector('ytd-video-meta-block');
    if (!anchor) return;

    const dateBadge = document.createElement('div');
    dateBadge.className = 'yt-exact-date-grid';
    dateBadge.style.cssText = 'margin-top: 2px;';
    dateBadge.appendChild(makeDateBadgeSpan(exactDate));

    anchor.insertAdjacentElement('afterend', dateBadge);
}

// ==========================================
// 啟動：MutationObserver 主動偵測 + setInterval 安全網
// ==========================================

// Throttle（非 debounce）：第一次 mutation 後最多 300ms 內必定執行一次掃描
// 避免影片播放時 DOM 不停更新導致 debounce 永遠無法觸發
let scanScheduled = false;
function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
        scanScheduled = false;
        injectWatchPageDate();
        injectShortsWatchDate();
        processGridVideos();
    }, 300);
}

function boot() {
    // 啟動時從 chrome.storage.local 載入持久化 cache（跨分頁、跨刷新永久有效）
    chrome.storage.local.get(null, (items) => {
        if (chrome.runtime.lastError) return;
        for (const [key, value] of Object.entries(items)) {
            if (key.startsWith(CACHE_PREFIX) && value && typeof value.raw === 'string') {
                dateCache.set(key.slice(CACHE_PREFIX.length), value.raw);
            }
        }
    });

    // 啟動時執行一次清理
    cleanupStaleCache();

    document.addEventListener('yt-navigate-finish', onNavigateFinish);

    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                fetchExactDateForVideo(entry.target);
            }
        });
    }, { rootMargin: '300px' });

    // 主要：YouTube 新增 DOM 節點時立即觸發
    const domMutationObserver = new MutationObserver(scheduleScan);
    domMutationObserver.observe(document.body, { childList: true, subtree: true });

    // 安全網：3 秒掃一次
    setInterval(scheduleScan, 3000);

    // 初始執行
    scheduleScan();
}

// 測試環境（Node/CommonJS）匯出純函式並跳過 boot；瀏覽器環境直接啟動
if (typeof module !== 'undefined' && module.exports !== undefined) {
    module.exports = {
        convertToLocalTime,
        hasTimeComponent,
        getVideoId,
        extractDateFromHtml,
        getPageDateForVideo,
        displayDate,
        findActiveShortsTitle,
        noteShortsTitleMiss,
        resetShortsTitleMiss,
        SHORTS_TITLE_WARN_AFTER_MS,
    };
} else {
    boot();
}
