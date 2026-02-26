
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

// 判斷 ISO 字串是否真的包含時間資訊（例如 "2023-04-15T09:32:07+00:00"）
// 純日期字串（"2023-04-15"）不含時間，不應虛構時分秒
function hasTimeComponent(isoStr) {
    return typeof isoStr === 'string' && isoStr.includes('T') && isoStr.length > 11;
}

// 從多個 meta tag 中選出精度最高的日期字串
// 優先 datePublished（較可能含完整時間），其次 uploadDate
function getBestMetaDate() {
    const published = document.querySelector('meta[itemprop="datePublished"]');
    const uploaded  = document.querySelector('meta[itemprop="uploadDate"]');

    const pubContent = published ? published.getAttribute('content') : null;
    const upContent  = uploaded  ? uploaded.getAttribute('content')  : null;

    // 優先選有時間精度的那個
    if (pubContent && hasTimeComponent(pubContent)) return pubContent;
    if (upContent  && hasTimeComponent(upContent))  return upContent;

    // 兩者都只有日期，取任意一個
    return pubContent || upContent || null;
}

// ==========================================
// 1. 處理「影片播放頁面」：精確到秒（前提是 YouTube 有提供時間）
// ==========================================
function injectWatchPageDate() {
    if (!window.location.pathname.startsWith('/watch')) return;

    const rawDate = getBestMetaDate();
    if (!rawDate) return;

    // 只有當 meta tag 真的包含時間時才顯示時分秒，否則誠實顯示日期
    const includeTime = hasTimeComponent(rawDate);
    const exactDateTime = convertToLocalTime(rawDate, includeTime) || rawDate.split('T')[0];

    // 擴充選擇器，涵蓋新舊版 YouTube UI
    const infoTarget =
        document.querySelector('ytd-watch-metadata #description-inner #info') ||
        document.querySelector('ytd-watch-metadata #info-container')           ||
        document.querySelector('ytd-watch-metadata #description-inner')        ||
        document.querySelector('#above-the-fold #info')                        ||
        document.querySelector('ytd-video-primary-info-renderer #info')        ||
        document.querySelector('ytd-watch-metadata');

    if (!infoTarget) return;

    let descTag = document.getElementById('yt-exact-date-watch-desc');
    if (!descTag) {
        descTag = document.createElement('span');
        descTag.id = 'yt-exact-date-watch-desc';
        descTag.style.cssText = 'color: #065fd4; font-weight: 600; margin-left: 10px; font-size: 1.4rem; background: #e8f0fe; padding: 2px 6px; border-radius: 4px; display: inline-block; vertical-align: middle;';

        if (infoTarget.id === 'info') {
            infoTarget.insertAdjacentElement('afterend', descTag);
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
    // 涵蓋首頁、頻道頁、搜尋結果、側邊欄
    const selectors = [
        'ytd-rich-item-renderer',
        'ytd-rich-grid-media',
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        'ytd-compact-video-renderer'
    ].map(s => s + ':not([' + processedMark + '])').join(', ');

    document.querySelectorAll(selectors).forEach(container => {
        container.setAttribute(processedMark, 'true');
        observer.observe(container);
    });
}

async function fetchExactDateForVideo(container) {
    const linkEl = container.querySelector('a#video-title-link, a#video-title, a#thumbnail');
    if (!linkEl || !linkEl.href) return;

    const url = new URL(linkEl.href);
    const videoId = url.searchParams.get('v');
    if (!videoId) return;

    // 找 metadata-line，加備用選擇器應對不同版型
    const metaLine =
        container.querySelector('#metadata-line') ||
        container.querySelector('ytd-video-meta-block #metadata-line') ||
        container.querySelector('#metadata');
    if (!metaLine) return;

    if (dateCache.has(videoId)) {
        injectDateIntoDOM(metaLine, dateCache.get(videoId));
        observer.unobserve(container);
        return;
    }

    if (processingQueue.has(videoId)) return;
    processingQueue.add(videoId);

    try {
        // 加 5 秒 timeout，避免請求無限等待
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('/watch?v=' + videoId, { signal: controller.signal });
        clearTimeout(timer);

        const htmlText = await response.text();

        // 優先抓 datePublished（較可能含時間），其次 uploadDate
        const matchPublished = htmlText.match(/<meta\s+itemprop="datePublished"\s+content="([^"]+)">/);
        const matchUploaded  = htmlText.match(/<meta\s+itemprop="uploadDate"\s+content="([^"]+)">/);

        const pubContent = matchPublished ? matchPublished[1] : null;
        const upContent  = matchUploaded  ? matchUploaded[1]  : null;

        // 選精度最高的
        const rawDate = (pubContent && hasTimeComponent(pubContent)) ? pubContent :
                        (upContent  && hasTimeComponent(upContent))  ? upContent  :
                        pubContent || upContent;

        if (rawDate) {
            // 清單頁只顯示日期（不管有無時間，保持清單整潔）
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
    dateBadge.innerHTML = '<span style="color: var(--yt-spec-text-secondary, #606060); margin-right: 6px;">•</span>' +
                          '<span style="color: #065fd4; font-weight: 600; font-size: 1.2rem; background: #e8f0fe; padding: 2px 5px; border-radius: 4px;">' + exactDate + '</span>';

    metaLine.appendChild(dateBadge);
}

// 啟動巡邏
setInterval(() => {
    injectWatchPageDate();
    processGridVideos();
}, 800);
