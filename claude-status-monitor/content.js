(() => {
  "use strict";

  // ── Config ─────────────────────────────────────────────────────────
  const DAYS = 30;
  const POLL_MS = 30_000; // 30 seconds

  // ── Claude-inspired warm dark palette ──────────────────────────────
  const C = {
    bg:        "#1B1A17",
    surface:   "#292824",
    elevated:  "#35332E",
    border:    "#3E3D38",
    borderSub: "#4A4845",
    text:      "#E8E4DC",
    textSec:   "#9B9890",
    textMut:   "#6C6A63",
    accent:    "#D97756",
    green:     "#3D9B5A",
    yellow:    "#BFA716",
    orange:    "#CC6A1E",
    red:       "#CC3030",
    blue:      "#4B83D6",
    gray:      "#6C6A63",
    barOk:     "#3D9B5A",
    barMinor:  "#BFA716",
    barMajor:  "#CC6A1E",
    barCrit:   "#CC3030",
    barEmpty:  "#2E2D29",
  };

  const INDICATOR_COLOR = {
    none: C.green, minor: C.yellow, major: C.orange, critical: C.red, unknown: C.gray,
  };
  const COMP_STATUS = {
    operational:          { label: "Operational",    color: C.green },
    degraded_performance: { label: "Degraded",       color: C.yellow },
    partial_outage:       { label: "Partial Outage", color: C.orange },
    major_outage:         { label: "Major Outage",   color: C.red },
    under_maintenance:    { label: "Maintenance",    color: C.blue },
  };
  const BAR_COLOR = {
    operational: C.barOk, none: C.barOk,
    minor: C.barMinor, major: C.barMajor, critical: C.barCrit,
  };
  const BAR_LABEL = {
    operational: "No incidents",
    none: "No incidents",
    minor: "Minor incident",
    major: "Major incident",
    critical: "Critical incident",
  };

  // ── Helpers ────────────────────────────────────────────────────────
  function timeAgo(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  function fmtDate(d) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function esc(s) {
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

  // Pre-compute date array: index 0 = oldest, index DAYS-1 = today
  function buildDates() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const arr = [];
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (DAYS - 1 - i));
      arr.push(d);
    }
    return arr;
  }

  // ── Shadow DOM ─────────────────────────────────────────────────────
  const host = document.createElement("div");
  host.id = "claude-status-ext";
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :host {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483647;
      font-family: 'Söhne', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: ${C.text};
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    /* ── Badge ── */
    .badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-radius: 999px;
      background: ${C.surface};
      border: 1px solid ${C.border};
      cursor: pointer;
      user-select: none;
      box-shadow: 0 2px 10px rgba(0,0,0,.35);
      transition: all .15s ease;
    }
    .badge:hover {
      background: ${C.elevated};
      box-shadow: 0 4px 16px rgba(0,0,0,.45);
      transform: translateY(-1px);
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot.pulse { animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: .35; }
    }
    .badge-text {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      color: ${C.textSec};
    }

    /* ── Panel ── */
    .panel {
      display: none;
      flex-direction: column;
      width: 370px;
      max-height: 540px;
      background: ${C.bg};
      border: 1px solid ${C.border};
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,.55);
      overflow: hidden;
    }
    .panel.open { display: flex; }

    .p-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid ${C.border};
    }
    .p-header .dot { width: 10px; height: 10px; }
    .p-header-info { flex: 1; }
    .p-title { font-weight: 600; font-size: 14px; }
    .p-desc  { font-size: 12px; color: ${C.textSec}; }
    .close-btn {
      background: none; border: none; color: ${C.textMut};
      cursor: pointer; font-size: 18px; line-height: 1;
      padding: 4px; border-radius: 6px; transition: all .1s;
    }
    .close-btn:hover { color: ${C.text}; background: ${C.surface}; }

    /* ── Panel body ── */
    .p-body {
      flex: 1;
      overflow-y: auto;
      padding: 14px 16px;
    }
    .p-body::-webkit-scrollbar { width: 4px; }
    .p-body::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
    .p-body::-webkit-scrollbar-track { background: transparent; }

    /* Component block */
    .comp { margin-bottom: 16px; }
    .comp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .comp-name { font-size: 13px; font-weight: 500; }
    .comp-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: .3px;
    }

    /* Uptime bars */
    .bars-wrap { position: relative; }
    .bars {
      display: flex;
      gap: 2px;
      height: 30px;
    }
    .bar {
      flex: 1;
      min-width: 0;
      border-radius: 2px;
      cursor: pointer;
      transition: opacity .1s;
    }
    .bar:hover { opacity: .65; }
    .bar-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 10px;
      color: ${C.textMut};
    }

    /* Uptime percentage */
    .uptime-pct {
      font-size: 10px;
      color: ${C.textMut};
      text-align: right;
      margin-top: 2px;
    }

    /* Divider */
    .divider {
      height: 1px;
      background: ${C.border};
      margin: 8px 0 12px;
    }

    /* Section title */
    .sec-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: ${C.textMut};
      margin-bottom: 10px;
    }

    /* Incidents */
    .incident {
      padding: 10px 12px;
      border-radius: 8px;
      background: ${C.surface};
      margin-bottom: 8px;
    }
    .inc-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .inc-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .inc-name { font-size: 13px; font-weight: 600; }
    .inc-body { font-size: 12px; color: ${C.textSec}; margin-left: 14px; margin-top: 2px; }
    .inc-time { font-size: 11px; color: ${C.textMut}; margin-left: 14px; margin-top: 2px; }
    .no-incidents { font-size: 12px; color: ${C.textMut}; }

    /* Footer */
    .p-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-top: 1px solid ${C.border};
      font-size: 11px;
      color: ${C.textMut};
    }
    .p-footer a { color: ${C.accent}; text-decoration: none; }
    .p-footer a:hover { text-decoration: underline; }

    /* Loading / error */
    .loading, .error { text-align: center; padding: 32px 16px; font-size: 13px; }
    .error { color: ${C.red}; }
    .retry-btn {
      margin-top: 10px;
      padding: 5px 14px;
      border-radius: 8px;
      border: 1px solid ${C.border};
      background: ${C.surface};
      color: ${C.text};
      cursor: pointer;
      font-size: 12px;
      transition: background .1s;
    }
    .retry-btn:hover { background: ${C.elevated}; }

    /* Tooltip */
    .tooltip {
      position: fixed;
      pointer-events: none;
      padding: 6px 10px;
      border-radius: 8px;
      background: ${C.surface};
      border: 1px solid ${C.borderSub};
      font-size: 11px;
      line-height: 1.4;
      white-space: nowrap;
      opacity: 0;
      transition: opacity .12s;
      transform: translate(-50%, -100%);
      box-shadow: 0 4px 14px rgba(0,0,0,.45);
    }
    .tooltip.show { opacity: 1; }
    .tooltip-date { font-weight: 600; color: ${C.text}; }
    .tooltip-status { color: ${C.textSec}; }
  `;
  shadow.appendChild(style);

  // ── DOM structure ──────────────────────────────────────────────────
  const wrap = document.createElement("div");

  // Panel (appears above badge in visual order due to column layout)
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="p-header">
      <span class="dot pulse" style="width:10px;height:10px;background:${C.gray}"></span>
      <div class="p-header-info">
        <div class="p-title">Claude Status</div>
        <div class="p-desc">Loading…</div>
      </div>
      <button class="close-btn" title="Close">✕</button>
    </div>
    <div class="p-body"><div class="loading">Loading…</div></div>
    <div class="p-footer">
      <span class="updated-at"></span>
      <a href="https://status.claude.com" target="_blank" rel="noopener">status.claude.com</a>
    </div>`;

  // Badge
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.innerHTML = `<span class="dot pulse" style="background:${C.gray}"></span><span class="badge-text">Loading…</span>`;

  // Tooltip (global, repositioned on hover)
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";

  wrap.appendChild(panel);
  wrap.appendChild(badge);
  wrap.appendChild(tooltip);
  shadow.appendChild(wrap);
  document.body.appendChild(host);

  // Grab references
  const badgeDot  = badge.querySelector(".dot");
  const badgeText = badge.querySelector(".badge-text");
  const headerDot = panel.querySelector(".p-header .dot");
  const headerDesc = panel.querySelector(".p-desc");
  const panelBody = panel.querySelector(".p-body");
  const updatedAt = panel.querySelector(".updated-at");

  // ── Interaction ────────────────────────────────────────────────────
  let panelOpen = false;

  badge.addEventListener("click", () => {
    panelOpen = true;
    panel.classList.add("open");
    badge.style.display = "none";
  });

  panel.querySelector(".close-btn").addEventListener("click", () => {
    panelOpen = false;
    panel.classList.remove("open");
    badge.style.display = "flex";
    hideTooltip();
  });

  // ── Tooltip ────────────────────────────────────────────────────────
  let dates = buildDates();

  function showTooltip(barEl, dayIdx, status) {
    const date = dates[dayIdx];
    if (!date) return;
    const label = BAR_LABEL[status] || status;
    const color = BAR_COLOR[status] || C.barEmpty;
    tooltip.innerHTML =
      `<span class="tooltip-date">${fmtDate(date)}</span><br>` +
      `<span class="tooltip-status" style="color:${color}">${label}</span>`;
    const rect = barEl.getBoundingClientRect();
    tooltip.style.left = (rect.left + rect.width / 2) + "px";
    tooltip.style.top  = (rect.top - 8) + "px";
    tooltip.classList.add("show");
  }

  function hideTooltip() {
    tooltip.classList.remove("show");
  }

  // Event delegation for bar hover
  panelBody.addEventListener("mouseover", (e) => {
    const bar = e.target.closest(".bar");
    if (!bar) return;
    showTooltip(bar, parseInt(bar.dataset.idx), bar.dataset.status);
  });
  panelBody.addEventListener("mouseout", (e) => {
    if (e.target.closest(".bar")) hideTooltip();
  });

  // ── Render ─────────────────────────────────────────────────────────
  function render(data) {
    hideTooltip();
    dates = buildDates();

    const indicator = data.status?.indicator || "unknown";
    const iColor = INDICATOR_COLOR[indicator] || C.gray;
    const desc = data.status?.description || "Unknown";

    // Badge
    badgeDot.style.background = iColor;
    badgeText.textContent = desc;
    badgeDot.classList.toggle("pulse", indicator !== "none");

    // Panel header
    headerDot.style.background = iColor;
    headerDot.classList.toggle("pulse", indicator !== "none");
    headerDesc.textContent = desc;

    // Build body
    const components = (data.components || []).filter((c) => !c.group);
    const history = data.history || {};

    let html = "";

    for (const comp of components) {
      const s = COMP_STATUS[comp.status] || { label: comp.status, color: C.gray };
      const hist = history[comp.id] || new Array(DAYS).fill("operational");

      // Uptime %
      const okDays = hist.filter((d) => d === "operational" || d === "none").length;
      const pct = ((okDays / DAYS) * 100).toFixed(1);

      html += `<div class="comp">
        <div class="comp-header">
          <span class="comp-name">${esc(comp.name)}</span>
          <span class="comp-badge" style="color:${s.color};background:${s.color}18">${s.label}</span>
        </div>
        <div class="bars-wrap"><div class="bars">`;

      for (let i = 0; i < DAYS; i++) {
        const st = hist[i] || "operational";
        const bc = BAR_COLOR[st] || C.barEmpty;
        html += `<div class="bar" style="background:${bc}" data-idx="${i}" data-status="${st}"></div>`;
      }

      html += `</div>
        <div class="bar-labels">
          <span>${fmtDate(dates[0])}</span>
          <span>${pct}% uptime</span>
          <span>Today</span>
        </div>
        </div></div>`;
    }

    // Incidents
    html += `<div class="divider"></div><div class="sec-title">Active Incidents</div>`;

    if (data.incidents?.length) {
      for (const inc of data.incidents) {
        const ic = INDICATOR_COLOR[inc.impact] || C.gray;
        const upd = inc.incident_updates?.[0];
        html += `<div class="incident">
          <div class="inc-header">
            <span class="inc-dot" style="background:${ic}"></span>
            <span class="inc-name">${esc(inc.name)}</span>
          </div>`;
        if (upd) {
          html += `<div class="inc-body">${esc(upd.body)}</div>
            <div class="inc-time">${timeAgo(upd.updated_at)}</div>`;
        }
        html += `</div>`;
      }
    } else {
      html += `<div class="no-incidents">No active incidents — all systems normal.</div>`;
    }

    panelBody.innerHTML = html;

    // Footer
    if (data.updated_at) {
      updatedAt.textContent = "Updated " + timeAgo(data.updated_at);
    }
  }

  function renderError(msg) {
    panelBody.innerHTML = `<div class="error">${esc(msg)}<br><button class="retry-btn">Retry</button></div>`;
    panelBody.querySelector(".retry-btn").addEventListener("click", requestStatus);
    badgeDot.style.background = C.gray;
    badgeText.textContent = "Status unavailable";
  }

  // ── Fetching ───────────────────────────────────────────────────────
  function requestStatus() {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
      if (chrome.runtime.lastError) {
        renderError("Cannot reach extension background");
        return;
      }
      if (res?.ok) render(res.data);
      else renderError(res?.error || "Failed to load status");
    });
  }

  // Listen for pushed updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATUS_UPDATE") render(msg.data);
  });

  // Initial fetch + periodic polling
  requestStatus();
  setInterval(requestStatus, POLL_MS);
})();
