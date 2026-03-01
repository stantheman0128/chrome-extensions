(function () {
  'use strict';

  // ── URL pattern: Dcard article pages ──
  const ARTICLE_RE = /^\/f\/[^/]+\/p\/\d+/;

  // ── CJK character detection ──
  const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

  // ── Half-width → Full-width punctuation map (for CJK context) ──
  const PUNCT_MAP = {
    ',': '\uff0c', '!': '\uff01', '?': '\uff1f',
    ':': '\uff1a', ';': '\uff1b',
    '(': '\uff08', ')': '\uff09',
  };

  // ── State ──
  let original = null;
  let formatted = false;
  let button = null;
  let contentEl = null;

  // =============================================
  // Find article content container
  // =============================================
  function findContent() {
    const article = document.querySelector('article');
    if (!article) return null;

    // Strategy 1: class-based selectors (Dcard uses CSS modules)
    const keywords = ['content', 'body', 'text', 'Content', 'Body', 'Text'];
    for (const kw of keywords) {
      const el = article.querySelector(
        `[class*="${kw}_"], [class*="${kw}-"], [class*="${kw}__"]`
      );
      if (el && el.textContent.trim().length > 50) return el;
    }

    // Strategy 2: largest direct child div of article
    const children = article.querySelectorAll(':scope > div');
    let best = null;
    let bestLen = 0;
    for (const child of children) {
      const len = child.textContent.trim().length;
      if (len > bestLen) {
        bestLen = len;
        best = child;
      }
    }
    if (best && bestLen > 50) return best;

    // Strategy 3: fallback to article itself
    return article;
  }

  // =============================================
  // Normalize punctuation (half-width → full-width in CJK context)
  // =============================================
  function normalizePunct(text) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const fw = PUNCT_MAP[ch];
      if (fw && (CJK_RE.test(text[i - 1] || '') || CJK_RE.test(text[i + 1] || ''))) {
        result += fw;
      } else {
        result += ch;
      }
    }
    return result;
  }

  // =============================================
  // Add space between CJK and Latin/number characters (盤古之白)
  // =============================================
  function panguSpacing(text) {
    text = text.replace(/([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])([A-Za-z0-9])/g, '$1 $2');
    text = text.replace(/([A-Za-z0-9])([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])/g, '$1 $2');
    return text;
  }

  // =============================================
  // Process a single text node:
  //   1. Normalize punctuation
  //   2. Add Pangu spacing
  //   3. Insert <br> after sentence-ending punctuation
  // =============================================
  function processTextNode(node) {
    let text = node.textContent;
    if (text.trim().length < 4) return;

    // Step 1 & 2: normalize punctuation and add spacing
    text = normalizePunct(text);
    text = panguSpacing(text);

    // Step 3: split on sentence-ending punctuation (keep punctuation attached)
    // Matches: 。！？…⋯ (and sequences of them)
    const parts = text.split(/(?<=[。！？…⋯\u3002\uff01\uff1f\u2026\u22ef]+)/);

    if (parts.length <= 1) {
      // No sentence breaks, just update normalized text
      node.textContent = text;
      return;
    }

    const frag = document.createDocumentFragment();
    parts.forEach(function (part, i) {
      if (!part) return;
      frag.appendChild(document.createTextNode(part));
      // Insert <br> between sentences (not after the last one)
      if (i < parts.length - 1 && part.trim()) {
        frag.appendChild(document.createElement('br'));
      }
    });

    node.parentNode.replaceChild(frag, node);
  }

  // =============================================
  // Walk DOM tree and process all text nodes
  // =============================================
  function walkAndProcess(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(processTextNode);
  }

  // =============================================
  // Format the article
  // =============================================
  function formatArticle() {
    const el = findContent();
    if (!el) {
      showToast('找不到文章內容，請確認是否在文章頁面');
      return;
    }

    contentEl = el;
    original = el.innerHTML;

    // Process text nodes
    walkAndProcess(el);

    // Improve visual spacing
    el.style.lineHeight = '2';
    el.querySelectorAll('p').forEach(function (p) {
      p.style.marginBottom = '0.8em';
    });

    formatted = true;
    updateButton();
    showToast('排版優化完成');
  }

  // =============================================
  // Restore original content
  // =============================================
  function restoreArticle() {
    if (!contentEl || original === null) return;
    contentEl.innerHTML = original;
    contentEl.style.lineHeight = '';
    formatted = false;
    original = null;
    contentEl = null;
    updateButton();
    showToast('已還原原始排版');
  }

  // =============================================
  // Toast notification
  // =============================================
  function showToast(msg) {
    const existing = document.getElementById('dcard-fmt-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'dcard-fmt-toast';
    toast.textContent = msg;
    toast.style.cssText =
      'position:fixed;bottom:80px;right:24px;z-index:100000;' +
      'padding:10px 20px;background:rgba(0,0,0,0.75);color:#fff;' +
      'border-radius:8px;font-size:13px;pointer-events:none;' +
      'opacity:1;transition:opacity 0.4s';
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 400);
    }, 1800);
  }

  // =============================================
  // Floating button
  // =============================================
  function updateButton() {
    if (!button) return;
    button.textContent = formatted ? '還原排版' : '一鍵排版';
  }

  function createButton() {
    if (button) return;

    const btn = document.createElement('button');
    btn.id = 'dcard-fmt-btn';
    btn.textContent = '一鍵排版';
    btn.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:99999;' +
      'padding:10px 20px;background:#006aa6;color:#fff;border:none;' +
      'border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:all 0.2s;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

    btn.addEventListener('mouseenter', function () {
      btn.style.background = '#005580';
      btn.style.transform = 'scale(1.05)';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.background = '#006aa6';
      btn.style.transform = 'scale(1)';
    });
    btn.addEventListener('click', function () {
      if (formatted) restoreArticle();
      else formatArticle();
    });

    document.body.appendChild(btn);
    button = btn;
  }

  function removeButton() {
    if (button) {
      button.remove();
      button = null;
    }
  }

  // =============================================
  // Initialize and handle SPA navigation
  // =============================================
  function init() {
    if (ARTICLE_RE.test(location.pathname)) {
      // Wait a moment for Dcard's React content to render
      setTimeout(createButton, 500);
    } else {
      removeButton();
    }
  }

  // Initial run
  init();

  // Watch for SPA navigation (Dcard is a single-page app)
  let lastPath = location.pathname;
  new MutationObserver(function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      // Reset state on navigation
      formatted = false;
      original = null;
      contentEl = null;
      removeButton();
      init();
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
