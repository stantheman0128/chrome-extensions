'use strict';

// =====================================================================
// Pure helpers — no DOM, no chrome. Exported under CommonJS for unit tests
// (tests/popup-aggregate.test.js); the browser path skips the export and
// runs boot() instead.
// =====================================================================

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

// Lifetime dice fairness. Mirrors content.js chiSquare()/luckTier() (10 dof:
// χ²₀.₀₅(10)=18.31, χ²₀.₀₁(10)=23.21). Duplicated on purpose — popup.js and
// content.js are separate, unbundled scripts with no shared module.
const EXPECTED_PCT = {
  2: 2.78, 3: 5.56, 4: 8.33, 5: 11.11, 6: 13.89,
  7: 16.67, 8: 13.89, 9: 11.11, 10: 8.33, 11: 5.56, 12: 2.78,
};
const CHI_MIN_ROLLS = 24;

function chiSquareLife(counts, total) {
  if (!total || total < CHI_MIN_ROLLS) return null;
  let chi = 0;
  for (let n = 2; n <= 12; n++) {
    const exp = total * EXPECTED_PCT[n] / 100;
    if (exp <= 0) continue;
    const diff = (counts[n] || 0) - exp;
    chi += (diff * diff) / exp;
  }
  return chi;
}

function luckTier(chi) {
  if (chi == null) return null;
  if (chi > 23.21) return 'verySkewed';
  if (chi > 18.31) return 'skewed';
  return 'fair';
}

// Roll up the per-game history into lifetime ("your luck over time") stats.
// Dice are summed across EVERY game (fairness is about the dice, not you); the
// "you" metrics use each record's own selfName, so games you only spectated
// (selfName null) count toward the dice but not toward win rate / income /
// turns / steals. Per-opponent stats (nemesis) are deliberately omitted — the
// opponents differ from game to game, so aggregating their names is noise.
function aggregate(history) {
  const list = Array.isArray(history) ? history : [];
  const diceCounts = {};
  for (let n = 2; n <= 12; n++) diceCounts[n] = 0;
  let diceTotal = 0;
  let played = 0, wins = 0;
  let durSum = 0, durCount = 0;
  let incomeSum = 0, turnMsSum = 0, turnsSum = 0, stoleSum = 0, lostSum = 0;

  for (const g of list) {
    const dc = (g && g.diceCounts) || {};
    for (let n = 2; n <= 12; n++) {
      const c = +dc[n] || 0;
      diceCounts[n] += c;
      diceTotal += c;
    }
    if (g && Number.isFinite(g.duration) && g.duration >= 0) { durSum += g.duration; durCount++; }

    const self = g && g.selfName;
    if (!self) continue;                       // spectated — dice only
    played++;
    if (g.winner && g.winner === self) wins++;
    const t = (g.tally && g.tally[self]) || {};
    incomeSum += +t.gained || 0;
    turnMsSum += +t.turnMs || 0;
    turnsSum  += +t.turns  || 0;
    stoleSum  += +t.stole  || 0;
    lostSum   += +t.lost   || 0;
  }

  const chi = chiSquareLife(diceCounts, diceTotal);
  return {
    games: list.length,
    played,
    wins,
    winRate: played ? wins / played : null,
    totalDurationMs: durSum,
    avgDurationMs: durCount ? durSum / durCount : null,
    diceCounts,
    diceTotal,
    chi,
    fairness: luckTier(chi),
    avgIncome: played ? incomeSum / played : null,
    avgTurnMs: turnsSum ? turnMsSum / turnsSum : null,
    avgSteals: played ? stoleSum / played : null,
    avgLosses: played ? lostSum / played : null,
  };
}

// =====================================================================
// Browser UI — runs only in the popup (guarded out of the Node test path).
// =====================================================================

function boot() {
  // i18n: Chrome picks _locales/<UI language>; {x} placeholders are ours (the
  // same scheme the content script uses), substituted here.
  const M = (key, subs) => {
    let m = chrome.i18n.getMessage(key) || '';
    if (m && subs) for (const k of Object.keys(subs)) m = m.split('{' + k + '}').join(subs[k]);
    return m;
  };

  // MV3 popups disallow inline scripts (CSP), so the version is injected here
  // from the manifest — a single source of truth, no hard-coded string to drift.
  document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;

  // Swap the static zh-TW copy in popup.html for the user's UI language.
  // popupIntro carries author-controlled markup (a link + a highlight span).
  {
    const intro = M('popupIntro');
    if (intro) document.getElementById('intro').innerHTML = intro;
    for (const [id, key] of Object.entries({
      hint: 'popupHint', histTitle: 'histTitle', export: 'exportJson',
      srcLink: 'srcLink', privacyLink: 'privacyLink', legal: 'popupLegal',
    })) {
      const msg = M(key);
      if (msg) document.getElementById(id).textContent = msg;
    }
  }

  const HISTORY_KEY = 'cst-history';
  const summaryEl = document.getElementById('summary');
  const histEl = document.getElementById('history');
  const exportLink = document.getElementById('export');

  // ---- lifetime summary (your luck over time) ----
  const fmtPct = (x) => (x * 100).toFixed(0);
  const fmtNum = (x) => (Math.round(x * 10) / 10).toString(); // 1 dp, no trailing .0 noise

  // Lifetime dice distribution as a compact 11-bar histogram: a bars row (heights
  // scaled to the busiest sum) over a labels row, so the percentage heights resolve
  // cleanly against a fixed-height track and the 2-12 labels share a baseline.
  function diceHistogram(agg) {
    const wrap = document.createElement('div');
    wrap.className = 'sum-dice';
    const bars = document.createElement('div'); bars.className = 'sum-bars';
    const nums = document.createElement('div'); nums.className = 'sum-nums';
    const max = Math.max(1, ...Object.values(agg.diceCounts));
    for (let n = 2; n <= 12; n++) {
      const c = agg.diceCounts[n] || 0;
      const bar = document.createElement('div');
      bar.className = 'sum-bar' + (n === 7 ? ' sum-bar-7' : '');
      bar.style.height = `${Math.round((c / max) * 100)}%`;
      bar.title = `${n}: ${c}`;
      bars.appendChild(bar);
      const lab = document.createElement('div');
      lab.className = 'sum-num';
      lab.textContent = n;
      nums.appendChild(lab);
    }
    wrap.append(bars, nums);
    return wrap;
  }

  // Summary lines are plain text (emoji + numbers + author-controlled i18n), so
  // textContent keeps them XSS-proof — no player names or markup flow through here.
  function line(text) {
    const d = document.createElement('div');
    d.className = 'sum-line';
    d.textContent = text;
    return d;
  }

  function renderSummary(history) {
    summaryEl.textContent = '';
    const agg = aggregate(history);
    if (!agg.games) { summaryEl.style.display = 'none'; return; }
    summaryEl.style.display = '';

    const title = document.createElement('div');
    title.className = 'sum-head';
    title.textContent = M('sumTitle') || '📊 長期統計';
    summaryEl.appendChild(title);

    // Games + win rate (emoji live inside the i18n strings, so each line is a
    // self-contained, translator-controlled message).
    if (agg.winRate != null) {
      summaryEl.appendChild(line(
        M('sumWin', { n: agg.games, p: fmtPct(agg.winRate), w: agg.wins, t: agg.played })
        || `🎮 ${agg.games} 場 · 🏆 勝率 ${fmtPct(agg.winRate)}%（${agg.wins}/${agg.played}）`));
    } else {
      summaryEl.appendChild(line(M('sumGames', { n: agg.games }) || `🎮 ${agg.games} 場`));
    }

    // Lifetime dice distribution + fairness.
    summaryEl.appendChild(diceHistogram(agg));
    if (agg.fairness) {
      const tier = M('luck' + agg.fairness.charAt(0).toUpperCase() + agg.fairness.slice(1))
        || agg.fairness;
      summaryEl.appendChild(line(
        M('sumDice', { tier, x: agg.chi.toFixed(1), n: agg.diceTotal })
        || `⚖️ 骰子${tier}（χ²=${agg.chi.toFixed(1)} / ${agg.diceTotal} 次）`));
    }

    // "You" metrics (only meaningful if you actually played, never spectated).
    if (agg.played) {
      if (agg.avgIncome != null) {
        summaryEl.appendChild(line(
          M('sumIncome', { n: fmtNum(agg.avgIncome) }) || `📈 平均收入 ${fmtNum(agg.avgIncome)} 張/場`));
      }
      summaryEl.appendChild(line(
        M('sumSteal', { s: fmtNum(agg.avgSteals), l: fmtNum(agg.avgLosses) })
        || `⚔️ 每場偷 ${fmtNum(agg.avgSteals)} · 💔 被偷 ${fmtNum(agg.avgLosses)}`));
      if (agg.avgTurnMs != null) {
        summaryEl.appendChild(line(
          M('sumTurn', { d: fmtDuration(agg.avgTurnMs) }) || `⏱ 平均回合 ${fmtDuration(agg.avgTurnMs)}`));
      }
    }

    // Average game length.
    if (agg.avgDurationMs != null) {
      summaryEl.appendChild(line(
        M('sumGame', { d: fmtDuration(agg.avgDurationMs) }) || `🕐 每場平均 ${fmtDuration(agg.avgDurationMs)}`));
    }
  }

  // ---- per-game history (written by the content script when someone wins) ----
  function renderHistory(history) {
    histEl.textContent = '';
    if (!history.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.style.fontSize = '11px';
      p.textContent = M('histEmpty') ||
        '還沒有完成的對局 — 打完一場（有人獲勝）就會自動存一筆，最多保留 50 場。';
      histEl.appendChild(p);
      exportLink.style.display = 'none';
      return;
    }
    // Newest first. Click a line to fold out the per-player summary.
    [...history].reverse().forEach((g) => {
      const ln = document.createElement('div');
      ln.className = 'hist-line';
      ln.textContent = `${fmtDate(g.date)} · 🏆 ${g.winner || '—'} · ` +
        `${M('rollsCount', { n: g.totalRolls || 0 }) || `${g.totalRolls || 0} rolls`} · ⏱ ${fmtDuration(g.duration)}`;
      const det = document.createElement('div');
      det.className = 'hist-det';
      det.style.display = 'none';
      det.textContent = (g.players || []).map((p) => {
        const t = (g.tally && g.tally[p.name]) || {};
        const bits = [M('histHand', { n: handTotal(p) }) || `${handTotal(p)} cards`];
        if (t.stole) bits.push(M('histStole', { n: t.stole }) || `stole ${t.stole}`);
        if (t.lost) bits.push(M('histLost', { n: t.lost }) || `lost ${t.lost}`);
        return `${p.name}${p.name === g.winner ? ' 🏆' : ''}：${bits.join('、')}`;
      }).join('\n');
      ln.addEventListener('click', () => {
        det.style.display = det.style.display === 'none' ? 'block' : 'none';
      });
      histEl.append(ln, det);
    });
  }

  chrome.storage.local.get([HISTORY_KEY], (data) => {
    const history = Array.isArray(data && data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
    renderSummary(history);
    renderHistory(history);
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
}

if (typeof module !== 'undefined' && module.exports) {
  // boot is exported too so a jsdom smoke test can drive the whole render path
  // (it reads document/chrome from globals at call time, never at import time).
  module.exports = { aggregate, chiSquareLife, luckTier, fmtDuration, fmtDate, handTotal, boot };
} else {
  boot();
}
