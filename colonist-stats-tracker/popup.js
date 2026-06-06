'use strict';

// MV3 popups disallow inline scripts (CSP), so the version is injected here
// from the manifest — a single source of truth, no hard-coded string to drift.
document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;

// "Force re-scan this game" — the manual hard-reset fallback. New games are
// detected automatically; this is for the rare case the panel is stuck on a
// previous game. We message the content script (which owns the tracked state);
// sendMessage rejects when there's no content script (i.e. not a colonist.io tab).
const btn = document.getElementById('newgame');
const status = document.getElementById('status');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('no active tab');
    const reply = await chrome.tabs.sendMessage(tab.id, { cmd: 'cst-new-game' });
    if (!reply || !reply.ok) throw new Error('no reply');
    status.textContent = '✓ 已清空並重新抓取目前這局。';
    status.style.color = '#2f6f9f';
  } catch (e) {
    status.textContent = '請先切到 colonist.io 的對局分頁，面板出現後再試一次。';
    status.style.color = '#c0533a';
  } finally {
    btn.disabled = false;
  }
});
