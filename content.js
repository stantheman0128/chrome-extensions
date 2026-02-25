
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
        
        // 如果需要包含精確到秒的時間 (用於播放頁面)
        if (includeTime) {
            const hh = String(localDate.getHours()).padStart(2, '0');
            const mm = String(localDate.getMinutes()).padStart(2, '0');
            const ss = String(localDate.getSeconds()).padStart(2, '0');
            return y + '-' + m + '-' + d + ' ' + hh + ':' + mm + ':' + ss;
        }
        
        // 首頁清單只需顯示日期
        return y + '-' + m + '-' + d;
    } catch(e) {
        return null;
    }
}

// ==========================================
// 1. 處理「影片播放頁面」：只顯示在資訊欄，精確到秒，不要多餘文字
// ==========================================
function injectWatchPageDate() {
    if (!window.location.pathname.startsWith('/watch')) return;
    
    const metaDate = document.querySelector('meta[itemprop="uploadDate"]') || document.querySelector('meta[itemprop="datePublished"]');
    if (!metaDate) return;
    
    const rawDate = metaDate.getAttribute('content');
    
    // 取得包含時分秒的精準時間
    const exactDateTime = convertToLocalTime(rawDate, true) || rawDate.replace('T', ' ').split('+')[0];
    
    // 只針對資訊欄注入
    // 修正：必須加上 ytd-watch-metadata 前綴，否則會抓到網頁其他隱藏的同名區塊 (如留言區或側邊欄)
    const infoTarget = document.querySelector('ytd-watch-metadata #description-inner #info') || 
                       document.querySelector('ytd-watch-metadata #info-container') || 
                       document.querySelector('ytd-watch-metadata #description-inner');

    if (infoTarget) {
        let descTag = document.getElementById('yt-exact-date-watch-desc');
        if (!descTag) {
            descTag = document.createElement('span');
            descTag.id = 'yt-exact-date-watch-desc';
            descTag.style.cssText = 'color: #065fd4; font-weight: 600; margin-left: 10px; font-size: 1.4rem; background: #e8f0fe; padding: 2px 6px; border-radius: 4px; display: inline-block; vertical-align: middle;';
            
            // 將日期標籤安插在觀看次數與時間的文字區塊旁邊
            if (infoTarget.id === 'info') {
                infoTarget.insertAdjacentElement('afterend', descTag); // 精準插在文字的後方
            } else {
                infoTarget.appendChild(descTag); // 備用方案：塞在容器最後面
            }
        }
        // 直接寫入日期時間，不加「當地時間」
        if (descTag.textContent !== exactDateTime) {
            descTag.textContent = exactDateTime;
        }
    }
}

// ==========================================
// 2. 處理「首頁 / 頻道清單」：擴大掃描範圍
// ==========================================
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            fetchExactDateForVideo(entry.target);
        }
    });
}, { rootMargin: '100px' });

function processGridVideos() {
    // 擴大了選擇器：包含首頁、頻道頁、搜尋結果與側邊欄
    const selectors = [
        'ytd-rich-item-renderer',
        'ytd-rich-grid-media',
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        'ytd-compact-video-renderer'
    ].map(s => s + ':not([' + processedMark + '])').join(', ');

    const videoContainers = document.querySelectorAll(selectors);
    
    videoContainers.forEach(container => {
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

    const metaLine = container.querySelector('#metadata-line');
    if (!metaLine) return;

    if (dateCache.has(videoId)) {
        injectDateIntoDOM(metaLine, dateCache.get(videoId));
        observer.unobserve(container);
        return;
    }

    if (processingQueue.has(videoId)) return;
    processingQueue.add(videoId);

    try {
        const response = await fetch('/watch?v=' + videoId);
        const htmlText = await response.text();

        const match = htmlText.match(/<meta\s+itemprop="uploadDate"\s+content="([^"]+)">/) || 
                      htmlText.match(/<meta\s+itemprop="datePublished"\s+content="([^"]+)">/);

        if (match && match[1]) {
            const rawDate = match[1];
            const exactDate = convertToLocalTime(rawDate, false) || rawDate.split('T')[0];
            
            dateCache.set(videoId, exactDate);
            injectDateIntoDOM(metaLine, exactDate);
        }
    } catch (e) {
        // 抓取失敗靜默處理
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
    
    // 使用傳統字串相加，避免環境封裝引發語法錯誤
    dateBadge.innerHTML = '<span style="color: var(--yt-spec-text-secondary, #606060); margin-right: 6px;">•</span><span style="color: #065fd4; font-weight: 600; font-size: 1.2rem; background: #e8f0fe; padding: 2px 5px; border-radius: 4px;">' + exactDate + '</span>';
    
    metaLine.appendChild(dateBadge);
}

// 啟動巡邏
setInterval(() => {
    injectWatchPageDate();
    processGridVideos();
}, 800);
