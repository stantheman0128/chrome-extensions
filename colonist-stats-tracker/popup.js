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

// ---- per-game history (written by the content script when someone wins) ----
const HISTORY_KEY = 'cst-history';
const histEl = document.getElementById('history');
const exportLink = document.getElementById('export');

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function handTotal(p) {
  return Object.values(p.hand || {}).reduce((a, b) => a + b, 0) + (p.unknown || 0);
}

function renderHistory(history) {
  histEl.textContent = '';
  if (!history.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.style.fontSize = '11px';
    p.textContent = '還沒有完成的對局 — 打完一場（有人獲勝）就會自動存一筆，最多保留 50 場。';
    histEl.appendChild(p);
    exportLink.style.display = 'none';
    return;
  }
  // Newest first. Click a line to fold out the per-player summary.
  [...history].reverse().forEach((g) => {
    const line = document.createElement('div');
    line.className = 'hist-line';
    line.textContent = `${fmtDate(g.date)} · 🏆 ${g.winner || '—'} · ` +
      `${g.totalRolls || 0} rolls · ⏱ ${fmtDuration(g.duration)}`;
    const det = document.createElement('div');
    det.className = 'hist-det';
    det.style.display = 'none';
    det.textContent = (g.players || []).map((p) => {
      const t = (g.tally && g.tally[p.name]) || {};
      const bits = [`${handTotal(p)} 張手牌`];
      if (t.stole) bits.push(`偷到 ${t.stole}`);
      if (t.lost) bits.push(`被偷 ${t.lost}`);
      return `${p.name}${p.name === g.winner ? ' 🏆' : ''}：${bits.join('、')}`;
    }).join('\n');
    line.addEventListener('click', () => {
      det.style.display = det.style.display === 'none' ? 'block' : 'none';
    });
    histEl.append(line, det);
  });
}

chrome.storage.local.get([HISTORY_KEY], (data) => {
  renderHistory(Array.isArray(data && data[HISTORY_KEY]) ? data[HISTORY_KEY] : []);
});

exportLink.addEventListener('click', async (e) => {
  e.preventDefault();
  const data = await chrome.storage.local.get([HISTORY_KEY]);
  const blob = new Blob(
    [JSON.stringify(data[HISTORY_KEY] || [], null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'colonist-stats-history.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

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
