
const dateCache = new Map();
const processingQueue = new Set();
const processedMark = 'data-exact-date-processed';
let lastWatchVideoId = null;

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

// 判斷 ISO 字串是否真的包含時間資訊
function hasTimeComponent(isoStr) {
    return typeof isoStr === 'string' && isoStr.includes('T') && isoStr.length > 11;
}

// 從 meta tag 讀取最佳精度日期（用於 watch page，CSS 選擇器不受屬性順序影響）
function getBestMetaDate() {
    const published = document.querySelector('meta[itemprop="datePublished"]');
    const uploaded  = document.querySelector('meta[itemprop="uploadDate"]');

    const pubContent = published ? published.getAttribute('content') : null;
    const upContent  = uploaded  ? uploaded.getAttribute('content')  : null;

    if (pubContent && hasTimeComponent(pubContent)) return pubContent;
    if (upContent  && hasTimeComponent(upContent))  return upContent;

    return pubContent || upContent || null;
}

// 從 fetch 回來的 HTML 文字中擷取日期（容錯：屬性順序 + JSON 回退）
function extractDateFromHtml(htmlText) {
    // 嘗試 meta tag（兩種屬性順序）
    const patterns = [
        /<meta\s+itemprop="datePublished"\s+content="([^"]+)"/,
        /<meta\s+content="([^"]+)"\s+itemprop="datePublished"/,
        /<meta\s+itemprop="uploadDate"\s+content="([^"]+)"/,
        /<meta\s+content="([^"]+)"\s+itemprop="uploadDate"/,
    ];
    for (const re of patterns) {
        const m = htmlText.match(re);
        if (m && m[1]) return m[1];
    }

    // 回退：從頁面嵌入的 JSON (ytInitialPlayerResponse) 中擷取
    const jsonMatch = htmlText.match(/"publishDate"\s*:\s*"(\d{4}-\d{2}-\d{2}[^"]*)"/);
    if (jsonMatch) return jsonMatch[1];

    return null;
}

// ==========================================
// 1. 處理「影片播放頁面」：精確到秒
// ==========================================
function injectWatchPageDate() {
    if (!window.location.pathname.startsWith('/watch')) return;

    // 偵測 SPA 換片：清除舊 badge，避免顯示上一支影片的日期
    const params = new URLSearchParams(window.location.search);
    const currentVideoId = params.get('v');
    if (currentVideoId !== lastWatchVideoId) {
        const oldTag = document.getElementById('yt-exact-date-watch-desc');
        if (oldTag) oldTag.remove();
        lastWatchVideoId = currentVideoId;
    }

    const rawDate = getBestMetaDate();
    if (!rawDate) return;

    const includeTime = hasTimeComponent(rawDate);
    const exactDateTime = convertToLocalTime(rawDate, includeTime) || rawDate.split('T')[0];

    // 選擇器優先順序：
    //   1. ytd-watch-metadata #info  → 新版 YouTube UI（2024+），info row 直接在 watch-metadata 下
    //   2. ytd-watch-metadata #description-inner #info → 舊版 UI
    //   3. ytd-watch-metadata #info-container          → 另一種舊版結構
    //   4. #above-the-fold #info                       → polymer 版本
    //   5. ytd-video-primary-info-renderer #info       → 更舊版 UI
    //   6. ytd-watch-metadata                          → 最終 fallback
    const infoTarget =
        document.querySelector('ytd-watch-metadata #info')                  ||
        document.querySelector('ytd-watch-metadata #description-inner #info') ||
        document.querySelector('ytd-watch-metadata #info-container')          ||
        document.querySelector('#above-the-fold #info')                       ||
        document.querySelector('ytd-video-primary-info-renderer #info')       ||
        document.querySelector('ytd-watch-metadata');

    if (!infoTarget) return;

    let descTag = document.getElementById('yt-exact-date-watch-desc');
    if (!descTag) {
        descTag = document.createElement('span');
        descTag.id = 'yt-exact-date-watch-desc';
        descTag.style.cssText = 'color: #065fd4; font-weight: 600; margin-left: 10px; font-size: 1.4rem; background: #e8f0fe; padding: 2px 6px; border-radius: 4px; display: inline-block; vertical-align: middle;';

        // id === 'info' → 附加在 info row 內部（和觀看次數並排）
        // 其他 → appendChild 到容器尾端
        if (infoTarget.id === 'info') {
            infoTarget.appendChild(descTag);
        } else {
            infoTarget.appendChild(descTag);
        }
    }

    if (descTag.textContent !== exactDateTime) {
        descTag.textContent = exactDateTime;
    }
}

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
    // 涵蓋舊版 polymer 架構 + 新版 yt-lockup-view-model（首頁 2024+ UI）
    const selectors = [
        'ytd-rich-item-renderer',
        'ytd-rich-grid-media',
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        'ytd-compact-video-renderer',
        'yt-lockup-view-model',         // 新版首頁卡片
    ].map(s => s + ':not([' + processedMark + '])').join(', ');

    document.querySelectorAll(selectors).forEach(container => {
        container.setAttribute(processedMark, 'true');
        observer.observe(container);
    });
}

async function fetchExactDateForVideo(container) {
    // 支援舊版 id 選擇器 + 新版任意含 watch?v= 的連結
    const linkEl =
        container.querySelector('a#video-title-link, a#video-title, a#thumbnail') ||
        container.querySelector('a[href*="watch?v="]');
    if (!linkEl || !linkEl.href) return;

    let videoId;
    try {
        const url = new URL(linkEl.href);
        videoId = url.searchParams.get('v');
    } catch(e) {
        return;
    }
    if (!videoId) return;

    // 找 metadata-line / 新版 UI 的對應容器
    const metaLine =
        container.querySelector('#metadata-line') ||
        container.querySelector('ytd-video-meta-block #metadata-line') ||
        container.querySelector('#metadata') ||
        container.querySelector('yt-video-attributes-view-model') || // yt-lockup-view-model 內部
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
