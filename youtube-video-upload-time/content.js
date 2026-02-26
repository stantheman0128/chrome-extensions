
const dateCache = new Map();

// 啟動時從 chrome.storage.local 載入持久化 cache（跨分頁、跨刷新永久有效）
chrome.storage.local.get(null, (items) => {
    if (chrome.runtime.lastError) return;
    for (const [key, value] of Object.entries(items)) {
        if (key.startsWith('v_')) {
            dateCache.set(key.slice(2), value);
        }
    }
});

const processingQueue = new Set();
const processedMark = 'data-exact-date-processed';
let activeRequests = 0;
const MAX_CONCURRENT = 8;

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
// 取得 watch page 的日期（meta tag → JSON-LD 兩條路）
// ==========================================
function getBestWatchPageDate() {
    const published = document.querySelector('meta[itemprop="datePublished"]');
    const uploaded  = document.querySelector('meta[itemprop="uploadDate"]');
    const pubContent = published ? published.getAttribute('content') : null;
    const upContent  = uploaded  ? uploaded.getAttribute('content')  : null;

    if (pubContent && hasTimeComponent(pubContent)) return pubContent;
    if (upContent  && hasTimeComponent(upContent))  return upContent;
    if (pubContent || upContent) return pubContent || upContent;

    // 備援：JSON-LD schema（YouTube 的 <script type="application/ld+json">）
    const ldScript = document.querySelector('script[type="application/ld+json"]');
    if (ldScript) {
        try {
            const data = JSON.parse(ldScript.textContent);
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
// 1. 處理「影片播放頁面」：精確到秒
// ==========================================
function injectWatchPageDate() {
    if (!window.location.pathname.startsWith('/watch')) return;

    const rawDate = getBestWatchPageDate();
    if (!rawDate) return;

    const includeTime = hasTimeComponent(rawDate);
    const exactDateTime = convertToLocalTime(rawDate, includeTime) || rawDate.split('T')[0];

    const infoTarget =
        document.querySelector('ytd-watch-metadata #info')                    ||
        document.querySelector('ytd-watch-metadata #description-inner #info') ||
        document.querySelector('ytd-watch-metadata #info-container')          ||
        document.querySelector('#above-the-fold #info')                       ||
        document.querySelector('ytd-video-primary-info-renderer #info');

    if (!infoTarget) return;

    let descTag = document.getElementById('yt-exact-date-watch-desc');
    if (!descTag) {
        descTag = document.createElement('span');
        descTag.id = 'yt-exact-date-watch-desc';
        descTag.style.cssText = 'color: #065fd4; font-weight: 600; margin-left: 10px; font-size: 1.4rem; background: #e8f0fe; padding: 2px 6px; border-radius: 4px; display: inline-block; vertical-align: middle;';
        infoTarget.appendChild(descTag);
    }

    if (descTag.textContent !== exactDateTime) {
        descTag.textContent = exactDateTime;
    }
}

// ==========================================
// SPA 換頁事件：清除所有舊 badge 與 processedMark
// 讓下一次 setInterval 重新掃描所有影片卡片
// ==========================================
document.addEventListener('yt-navigate-finish', () => {
    // Watch page badge
    const oldTag = document.getElementById('yt-exact-date-watch-desc');
    if (oldTag) oldTag.remove();

    // 清除所有影片卡片上的舊標記和舊 badge
    // YouTube SPA 換頁後會原地更新卡片內容，若不清除則不會重新注入
    document.querySelectorAll('[' + processedMark + ']').forEach(el => {
        el.removeAttribute(processedMark);
        el.querySelectorAll('.yt-exact-date-grid').forEach(b => b.remove());
    });
});

// ==========================================
// 2. 處理所有影片卡片列表（首頁、推薦欄、訂閱、歷史、播放清單、Shorts ...）
// ==========================================
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            fetchExactDateForVideo(entry.target);
        }
    });
}, { rootMargin: '300px' });

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
        if (isHistoryPage && tag === 'ytd-video-renderer') {
            injectDateForHistory(container, dateCache.get(videoId));
        } else {
            injectDateIntoDOM(metaLine, dateCache.get(videoId));
        }
        observer.unobserve(container);
        return;
    }

    if (processingQueue.has(videoId)) return;
    if (activeRequests >= MAX_CONCURRENT) {
        // 放回去讓下次掃描重新處理：移除 processedMark + unobserve
        // IntersectionObserver 不會對已可見元素重複觸發，需要重新 observe 才能再次觸發
        container.removeAttribute(processedMark);
        observer.unobserve(container);
        return;
    }
    processingQueue.add(videoId);
    activeRequests++;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);

        // 用 /watch?v=ID 取得 HTML，stream 讀取找到日期就立即停止
        const response = await fetch('/watch?v=' + videoId, { signal: controller.signal });
        clearTimeout(timer);
        const rawDate = await streamFindDate(response);

        if (rawDate) {
            const exactDate = convertToLocalTime(rawDate, false) || rawDate.split('T')[0];
            dateCache.set(videoId, exactDate);
            chrome.storage.local.set({ ['v_' + videoId]: exactDate });
            if (isHistoryPage && tag === 'ytd-video-renderer') {
                injectDateForHistory(container, exactDate);
            } else {
                injectDateIntoDOM(metaLine, exactDate);
            }
        }
    } catch (e) {
        // 逾時或網路失敗，靜默處理
    } finally {
        activeRequests--;
        processingQueue.delete(videoId);
        observer.unobserve(container);
    }
}

function injectDateIntoDOM(metaLine, exactDate) {
    if (metaLine.querySelector('.yt-exact-date-grid')) return;

    const dateBadge = document.createElement('span');
    dateBadge.className = 'yt-exact-date-grid';
    dateBadge.style.cssText = 'display: inline-block; vertical-align: middle; margin-left: 4px;';
    dateBadge.innerHTML =
        '<span style="color: var(--yt-spec-text-secondary, #606060); margin-right: 6px;">•</span>' +
        '<span style="color: #065fd4; font-weight: 600; font-size: 1.2rem; background: #e8f0fe; padding: 2px 5px; border-radius: 4px;">' + exactDate + '</span>';

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
    dateBadge.innerHTML =
        '<span style="color: #065fd4; font-weight: 600; font-size: 1.2rem; background: #e8f0fe; padding: 2px 5px; border-radius: 4px;">' + exactDate + '</span>';

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
        processGridVideos();
    }, 300);
}

// 主要：YouTube 新增 DOM 節點時立即觸發
const domMutationObserver = new MutationObserver(scheduleScan);
domMutationObserver.observe(document.body, { childList: true, subtree: true });

// 安全網：3 秒掃一次
setInterval(scheduleScan, 3000);

// 初始執行
scheduleScan();
