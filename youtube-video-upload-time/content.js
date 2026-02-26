
const dateCache = new Map();
const processingQueue = new Set();
const processedMark = 'data-exact-date-processed';

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

// ==========================================
// 取得 watch page 的日期（meta tag → JSON-LD 兩條路）
// ==========================================
function getBestWatchPageDate() {
    // 方法一：meta tag（CSS 選擇器，與屬性順序無關）
    const published = document.querySelector('meta[itemprop="datePublished"]');
    const uploaded  = document.querySelector('meta[itemprop="uploadDate"]');
    const pubContent = published ? published.getAttribute('content') : null;
    const upContent  = uploaded  ? uploaded.getAttribute('content')  : null;

    if (pubContent && hasTimeComponent(pubContent)) return pubContent;
    if (upContent  && hasTimeComponent(upContent))  return upContent;
    if (pubContent || upContent) return pubContent || upContent;

    // 方法二：JSON-LD（YouTube 也會將結構化資料寫進 <script type="application/ld+json">）
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

// ==========================================
// 從 fetch 回來的 HTML 文字中擷取日期
// 嘗試順序：meta tag（兩種屬性順序）→ JSON-LD uploadDate → publishDate
// ==========================================
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

    // JSON-LD（含完整時間，格式如 "2023-04-15T09:32:07+00:00"）
    const ldMatch = htmlText.match(/"uploadDate"\s*:\s*"([^"]+)"/);
    if (ldMatch) return ldMatch[1];

    // ytInitialPlayerResponse publishDate（日期只版）
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

    // 選擇器優先順序（不再 fallback 到整個 ytd-watch-metadata 以免注入到描述區底部）
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

// SPA 換頁時清除舊 badge，讓下一次 setInterval 重新注入
document.addEventListener('yt-navigate-finish', () => {
    const oldTag = document.getElementById('yt-exact-date-watch-desc');
    if (oldTag) oldTag.remove();
});

// ==========================================
// 2. 處理「首頁 / 頻道 / 搜尋清單」：懶加載 + 快取
// ==========================================
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            fetchExactDateForVideo(entry.target);
        }
    });
}, { rootMargin: '100px' });

function processGridVideos() {
    const selectors = [
        'ytd-rich-item-renderer',
        'ytd-rich-grid-media',
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        'ytd-compact-video-renderer',
        'yt-lockup-view-model',         // 首頁新版卡片（YouTube 2024+）
        'yt-lockup-view-model-wiz',     // 可能的變體元素名稱
    ].map(s => s + ':not([' + processedMark + '])').join(', ');

    document.querySelectorAll(selectors).forEach(container => {
        container.setAttribute(processedMark, 'true');
        observer.observe(container);
    });
}

async function fetchExactDateForVideo(container) {
    // 支援舊版 id 選擇器與新版任意含 watch?v= 的連結
    const linkEl =
        container.querySelector('a#video-title-link, a#video-title, a#thumbnail') ||
        container.querySelector('a[href*="watch?v="]');
    if (!linkEl || !linkEl.href) return;

    let videoId;
    try {
        videoId = new URL(linkEl.href).searchParams.get('v');
    } catch(e) { return; }
    if (!videoId) return;

    // 找 metadata 注入目標（涵蓋舊版 polymer + 新版 yt-lockup-view-model）
    const metaLine =
        container.querySelector('#metadata-line')                      ||
        container.querySelector('ytd-video-meta-block #metadata-line') ||
        container.querySelector('#metadata')                           ||
        container.querySelector('yt-video-attributes-view-model')      || // 新版 UI
        container.querySelector('ytd-video-meta-block');
    if (!metaLine) return;

    if (dateCache.has(videoId)) {
        injectDateIntoDOM(metaLine, dateCache.get(videoId));
        observer.unobserve(container);
        return;
    }

    if (processingQueue.has(videoId)) return;
    processingQueue.add(videoId);

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);

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

// 啟動巡邏
setInterval(() => {
    injectWatchPageDate();
    processGridVideos();
}, 800);
