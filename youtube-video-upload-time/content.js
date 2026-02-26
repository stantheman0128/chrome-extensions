
const dateCache = new Map();
const processingQueue = new Set();
const processedMark = 'data-exact-date-processed';
let activeRequests = 0;
const MAX_CONCURRENT = 3;

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
// 1b. 處理「Shorts 全屏頁面」：直讀 meta tag，固定顯示在畫面頂部中央
// ==========================================
function injectShortsPageDate() {
    if (!window.location.pathname.startsWith('/shorts/')) return;

    const rawDate = getBestWatchPageDate();
    if (!rawDate) return;

    const includeTime = hasTimeComponent(rawDate);
    const exactDateTime = convertToLocalTime(rawDate, includeTime) || rawDate.split('T')[0];

    // 使用 position:fixed 貼在 YouTube 導覽列正下方中央
    // 不依賴 Shorts 的任何 DOM 結構，避免覆蓋影片畫面
    let descTag = document.getElementById('yt-exact-date-shorts-desc');
    if (!descTag) {
        descTag = document.createElement('div');
        descTag.id = 'yt-exact-date-shorts-desc';
        descTag.style.cssText =
            'position: fixed; top: 68px; left: 50%; transform: translateX(-50%); ' +
            'color: #065fd4; font-weight: 700; font-size: 1.3rem; ' +
            'background: rgba(232, 240, 254, 0.95); padding: 5px 14px; ' +
            'border-radius: 20px; z-index: 10000; pointer-events: none; ' +
            'white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.2);';
        document.body.appendChild(descTag);
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

    // Shorts 全屏 badge
    const oldShortsTag = document.getElementById('yt-exact-date-shorts-desc');
    if (oldShortsTag) oldShortsTag.remove();

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
}, { rootMargin: '0px' });

function processGridVideos() {
    // Shorts 全屏頁已由 injectShortsPageDate() 透過 meta tag 處理，
    // 不需要 card fetch（避免預載影片觸發大量 fetch 造成卡頓）
    if (window.location.pathname.startsWith('/shorts/')) return;

    const selectors = [
        // 首頁
        'ytd-rich-item-renderer',
        // 頻道、搜尋
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        // 推薦欄（watch page 右側）
        'ytd-compact-video-renderer',
        // 播放清單（Watch Later、Liked Videos、自訂播放清單）
        'ytd-playlist-video-renderer',
        // Shorts shelf
        'ytd-reel-item-renderer',
        'ytd-reel-video-renderer',
        // 新版 UI（首頁 2024+ yt-lockup-view-model）
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

    // 根據 container 類型分層查找 metadata 注入目標
    const tag = container.tagName.toLowerCase();
    let metaLine = null;

    if (tag === 'ytd-video-renderer') {
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
        // 首頁 2024+ 新版 UI
        metaLine =
            container.querySelector('yt-video-attributes-view-model') ||
            container.querySelector('#metadata-line')                  ||
            container.querySelector('#metadata')                       ||
            container.querySelector('#details');

    } else if (tag === 'ytd-reel-item-renderer' || tag === 'ytd-reel-video-renderer') {
        // Shorts shelf 卡片
        metaLine =
            container.querySelector('#details') ||
            container.querySelector('#meta')    ||
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

    // Fallback：找不到任何 metaLine 時，用 container 本身當作注入點
    if (!metaLine) metaLine = container;

    if (dateCache.has(videoId)) {
        injectDateIntoDOM(metaLine, dateCache.get(videoId));
        observer.unobserve(container);
        return;
    }

    if (processingQueue.has(videoId)) return;
    if (activeRequests >= MAX_CONCURRENT) return; // 讓 observer 下次重試
    processingQueue.add(videoId);
    activeRequests++;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);

        // 不論是 /watch?v=ID 或 /shorts/ID，都用 /watch?v=ID 取得 HTML（含 ld+json）
        const response = await fetch('/watch?v=' + videoId, { signal: controller.signal });
        clearTimeout(timer);

        const htmlText = await response.text();
        const rawDate = extractDateFromHtml(htmlText);

        if (rawDate) {
            const exactDate = convertToLocalTime(rawDate, false) || rawDate.split('T')[0];
            dateCache.set(videoId, exactDate);
            injectDateIntoDOM(metaLine, exactDate);
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

// ==========================================
// 啟動：MutationObserver 主動偵測 + setInterval 安全網
// ==========================================
let domScanTimer;
function debouncedScan() {
    clearTimeout(domScanTimer);
    domScanTimer = setTimeout(() => {
        injectWatchPageDate();
        injectShortsPageDate();
        processGridVideos();
    }, 200);
}

// 主要：YouTube 新增 DOM 節點時立即觸發（比 setInterval 快 4 倍）
const domMutationObserver = new MutationObserver(debouncedScan);
domMutationObserver.observe(document.body, { childList: true, subtree: true });

// 安全網：3 秒掃一次（頻率降低為原來的 1/3.75）
setInterval(debouncedScan, 3000);

// 初始執行
debouncedScan();
