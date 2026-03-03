(() => {
  "use strict";

  // ── Config ─────────────────────────────────────────────────────────
  const DAYS = 30;
  const POLL_MS = 30_000;
  const TICK_MS = 15_000;

  // ── Claude light-mode palette ───────────────────────────────────
  const C = {
    bg:        "#F4F3EE",
    surface:   "#FFFFFF",
    elevated:  "#EAE9E5",
    border:    "#D9D8D4",
    borderSub: "#C8C7C3",
    text:      "#1F1E1D",
    textSec:   "#6B6A68",
    textMut:   "#9B9A97",
    accent:    "#D97756",
    green:     "#2D8A4E",
    yellow:    "#9A7B00",
    orange:    "#C75A1E",
    red:       "#CC3030",
    blue:      "#3574D1",
    gray:      "#9B9A97",
    barOk:     "#45B26B",
    barMinor:  "#E5B800",
    barMajor:  "#E87C2A",
    barCrit:   "#E04040",
    barEmpty:  "#E2E1DD",
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
    operational: "No incidents", none: "No incidents",
    minor: "Minor incident", major: "Major incident", critical: "Critical incident",
  };
  const UPDATE_COLOR = {
    investigating: C.orange, identified: C.yellow, monitoring: C.blue,
    update: C.textSec, resolved: C.green, postmortem: C.textMut,
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
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function cleanName(name) {
    return name.replace(/\s*\(formerly[^)]*\)/gi, "").trim();
  }
  function buildDates() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
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
      font-size: 14px;
      line-height: 1.5;
      color: ${C.text};
      pointer-events: none;
    }

    /* Wrapper anchors the badge; panel floats above it */
    .wrap { position: relative; }

    /* ── Badge ────────────────────────────── */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 999px;
      background: ${C.surface};
      border: 1px solid ${C.border};
      cursor: pointer;
      user-select: none;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
      pointer-events: auto;
      transition: opacity .18s ease, transform .18s ease, background .12s ease, box-shadow .12s ease;
    }
    .badge:hover {
      background: ${C.elevated};
      box-shadow: 0 4px 14px rgba(0,0,0,.12);
      transform: translateY(-1px);
    }
    .badge.hide {
      opacity: 0;
      transform: scale(.85);
      pointer-events: none;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot.pulse { animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
    .badge-text {
      font-size: 13px; font-weight: 500; color: ${C.textSec};
      white-space: nowrap;
    }

    /* ── Panel (absolutely positioned above badge) ── */
    .panel {
      position: absolute;
      bottom: calc(100% + 8px);
      right: 0;
      width: 640px;
      max-width: calc(100vw - 32px);
      height: 460px;
      max-height: calc(100vh - 80px);
      background: ${C.bg};
      border: 1px solid ${C.border};
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,.12);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      pointer-events: none;

      visibility: hidden;
      opacity: 0;
      transform: scale(.96) translateY(8px);
      transition:
        visibility 0s .22s,
        opacity .22s ease,
        transform .22s cubic-bezier(.16,1,.3,1);
    }
    .panel.open {
      visibility: visible;
      opacity: 1;
      transform: scale(1) translateY(0);
      pointer-events: auto;
      transition-delay: 0s;
    }

    /* Header */
    .p-header {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid ${C.border};
      background: ${C.surface};
    }
    .p-header .dot { width: 10px; height: 10px; }
    .p-header-info { flex: 1; min-width: 0; }
    .p-title { font-weight: 600; font-size: 15px; }
    .p-desc  { font-size: 13px; color: ${C.textSec}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .close-btn {
      background: none; border: none; color: ${C.textMut};
      cursor: pointer; font-size: 18px; line-height: 1;
      padding: 4px 6px; border-radius: 6px; transition: all .1s;
    }
    .close-btn:hover { color: ${C.text}; background: ${C.elevated}; }

    /* ── Two-column body ── */
    .p-body {
      flex: 1;
      display: flex;
      overflow: hidden;
      min-height: 0;
    }
    .col { overflow-y: auto; padding: 14px 16px; }
    .col::-webkit-scrollbar { width: 4px; }
    .col::-webkit-scrollbar-thumb { background: ${C.borderSub}; border-radius: 2px; }
    .col::-webkit-scrollbar-track { background: transparent; }
    .col-left {
      flex: 1; min-width: 0;
      border-right: 1px solid ${C.border};
    }
    .col-right { width: 270px; flex-shrink: 0; }

    .sec-title {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .6px; color: ${C.textMut}; margin-bottom: 10px;
    }

    /* ── Components + bars ── */
    .comp { margin-bottom: 14px; }
    .comp-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 5px;
    }
    .comp-name { font-size: 13px; font-weight: 500; }
    .comp-badge {
      font-size: 11px; font-weight: 600; padding: 2px 8px;
      border-radius: 999px; letter-spacing: .2px;
    }
    .bars { display: flex; gap: 2px; height: 28px; }
    .bar {
      flex: 1; min-width: 0; border-radius: 2px;
      cursor: pointer; transition: opacity .1s;
    }
    .bar:hover { opacity: .6; }
    .bar-labels {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 3px; font-size: 11px; color: ${C.textMut};
    }
    .bar-labels-center { text-align: center; }

    /* ── Incidents ── */
    .incident {
      background: ${C.surface};
      border: 1px solid ${C.border};
      border-radius: 10px;
      margin-bottom: 10px;
      overflow: hidden;
    }
    .inc-top {
      padding: 12px 14px;
      cursor: pointer;
      transition: background .1s;
    }
    .inc-top:hover { background: ${C.elevated}; }
    .inc-header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
    .inc-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
    .inc-name { font-size: 13px; font-weight: 600; line-height: 1.35; }
    .inc-status-line { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .inc-status-badge {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .3px;
    }
    .inc-time { font-size: 11px; color: ${C.textMut}; }
    .inc-body {
      font-size: 12px; color: ${C.textSec}; line-height: 1.5;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .incident.expanded .inc-body { -webkit-line-clamp: unset; }

    /* Expand toggle */
    .inc-toggle {
      display: flex; align-items: center; gap: 5px;
      padding: 6px 14px 8px;
      font-size: 11px; color: ${C.accent}; cursor: pointer;
    }
    .inc-toggle:hover { text-decoration: underline; }
    .inc-toggle .arrow {
      display: inline-block;
      transition: transform .2s ease;
      font-size: 9px;
    }
    .incident.expanded .inc-toggle .arrow { transform: rotate(180deg); }
    .when-expanded { display: none; }
    .incident.expanded .when-collapsed { display: none; }
    .incident.expanded .when-expanded { display: inline; }

    /* Timeline */
    .inc-timeline {
      max-height: 0;
      overflow: hidden;
      transition: max-height .3s ease-out;
    }
    .inc-tl-inner {
      margin: 4px 14px 12px 18px;
      border-left: 2px solid ${C.border};
      padding-left: 14px;
    }
    .inc-update { position: relative; margin-bottom: 12px; }
    .inc-update:last-child { margin-bottom: 0; }
    .tl-dot {
      position: absolute; left: -19px; top: 5px;
      width: 8px; height: 8px; border-radius: 50%;
    }
    .inc-update .inc-body {
      -webkit-line-clamp: unset;
    }

    .no-incidents {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; text-align: center;
      padding: 32px 12px; color: ${C.textMut};
    }
    .no-inc-icon {
      width: 36px; height: 36px; border-radius: 50%;
      background: ${C.green}18; color: ${C.green};
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; margin-bottom: 8px;
    }
    .no-inc-title { font-size: 14px; font-weight: 600; color: ${C.textSec}; }
    .no-inc-sub { font-size: 12px; margin-top: 2px; }

    /* ── Footer ── */
    .p-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 16px;
      border-top: 1px solid ${C.border};
      font-size: 12px; color: ${C.textMut};
      background: ${C.surface};
    }
    .p-footer-left { display: flex; align-items: center; gap: 6px; }
    .refresh-btn {
      background: none; border: none; color: ${C.textMut};
      cursor: pointer; font-size: 15px; line-height: 1;
      padding: 2px; border-radius: 4px; transition: all .1s;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .refresh-btn:hover { color: ${C.text}; background: ${C.elevated}; }
    .refresh-btn.spinning { animation: spin .6s ease; }
    @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
    .p-footer a { color: ${C.accent}; text-decoration: none; }
    .p-footer a:hover { text-decoration: underline; }

    /* ── Tooltip ── */
    .tooltip {
      position: fixed; pointer-events: none;
      padding: 6px 10px; border-radius: 6px;
      background: ${C.surface}; border: 1px solid ${C.borderSub};
      font-size: 12px; line-height: 1.4; white-space: nowrap;
      opacity: 0; transition: opacity .1s;
      transform: translate(-50%, -100%);
      box-shadow: 0 3px 10px rgba(0,0,0,.1);
    }
    .tooltip.show { opacity: 1; }
    .tooltip-date { font-weight: 600; color: ${C.text}; }
    .tooltip-status { color: ${C.textSec}; }

    /* Loading / error */
    .loading, .error {
      display: flex; align-items: center; justify-content: center;
      height: 100%; text-align: center; font-size: 13px; color: ${C.textMut};
      padding: 24px;
    }
    .error { color: ${C.red}; flex-direction: column; }
    .retry-btn {
      margin-top: 10px; padding: 5px 14px; border-radius: 8px;
      border: 1px solid ${C.border}; background: ${C.surface};
      color: ${C.text}; cursor: pointer; font-size: 12px; transition: background .1s;
    }
    .retry-btn:hover { background: ${C.elevated}; }
  `;
  shadow.appendChild(style);

  // ── DOM ────────────────────────────────────────────────────────────
  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="p-header">
      <span class="dot pulse" style="background:${C.gray}"></span>
      <div class="p-header-info">
        <div class="p-title">Claude Status</div>
        <div class="p-desc">Loading…</div>
      </div>
      <button class="close-btn" title="Close">✕</button>
    </div>
    <div class="p-body">
      <div class="col col-left"><div class="loading">Loading…</div></div>
      <div class="col col-right"><div class="loading">Loading…</div></div>
    </div>
    <div class="p-footer">
      <div class="p-footer-left">
        <span class="updated-at"></span>
        <button class="refresh-btn" title="Refresh now">↻</button>
      </div>
      <a href="https://status.claude.com" target="_blank" rel="noopener">status.claude.com</a>
    </div>`;

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.innerHTML = `<span class="dot pulse" style="background:${C.gray}"></span><span class="badge-text">Loading…</span>`;

  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";

  wrap.appendChild(panel);
  wrap.appendChild(badge);
  wrap.appendChild(tooltip);
  shadow.appendChild(wrap);
  document.body.appendChild(host);

  // Refs
  const badgeDot    = badge.querySelector(".dot");
  const badgeText   = badge.querySelector(".badge-text");
  const headerDot   = panel.querySelector(".p-header .dot");
  const headerDesc  = panel.querySelector(".p-desc");
  const colLeft     = panel.querySelector(".col-left");
  const colRight    = panel.querySelector(".col-right");
  const updatedAtEl = panel.querySelector(".updated-at");
  const refreshBtn  = panel.querySelector(".refresh-btn");

  // ── State ──────────────────────────────────────────────────────────
  let panelOpen = false;
  let lastUpdatedAt = null;
  let dates = buildDates();

  // ── Panel open / close ─────────────────────────────────────────────
  function openPanel() {
    panelOpen = true;
    panel.classList.add("open");
    badge.classList.add("hide");
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panel.classList.remove("open");
    badge.classList.remove("hide");
    hideTooltip();
  }

  badge.addEventListener("click", openPanel);
  panel.querySelector(".close-btn").addEventListener("click", closePanel);

  // Click outside to close
  document.addEventListener("pointerdown", (e) => {
    if (!panelOpen) return;
    if (!host.contains(e.target) && e.target !== host) closePanel();
  });
  // Also handle clicks that land on the host but outside the panel (shadow retargeting)
  wrap.addEventListener("pointerdown", (e) => {
    if (!panelOpen) return;
    // If the click is not inside the panel, close it
    if (!panel.contains(e.target)) closePanel();
  });

  // ── Tooltip ────────────────────────────────────────────────────────
  function showTooltip(barEl, dayIdx, status) {
    const d = dates[dayIdx]; if (!d) return;
    const label = BAR_LABEL[status] || status;
    const color = BAR_COLOR[status] || C.barEmpty;
    tooltip.innerHTML = `<span class="tooltip-date">${fmtDate(d)}</span><br><span class="tooltip-status" style="color:${color}">${label}</span>`;
    const r = barEl.getBoundingClientRect();
    tooltip.style.left = (r.left + r.width / 2) + "px";
    tooltip.style.top  = (r.top - 6) + "px";
    tooltip.classList.add("show");
  }
  function hideTooltip() { tooltip.classList.remove("show"); }

  colLeft.addEventListener("mouseover", (e) => {
    const bar = e.target.closest(".bar");
    if (bar) showTooltip(bar, +bar.dataset.idx, bar.dataset.status);
  });
  colLeft.addEventListener("mouseout", (e) => {
    if (e.target.closest(".bar")) hideTooltip();
  });

  // ── Incident expand / collapse ─────────────────────────────────────
  colRight.addEventListener("click", (e) => {
    const toggle = e.target.closest(".inc-top, .inc-toggle");
    if (!toggle) return;
    const card = toggle.closest(".incident");
    if (!card) return;
    const timeline = card.querySelector(".inc-timeline");
    if (!timeline) return;

    if (card.classList.contains("expanded")) {
      card.classList.remove("expanded");
      timeline.style.maxHeight = "0";
    } else {
      card.classList.add("expanded");
      timeline.style.maxHeight = timeline.scrollHeight + "px";
    }
  });

  // ── Refresh button ─────────────────────────────────────────────────
  refreshBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    refreshBtn.classList.remove("spinning");
    void refreshBtn.offsetWidth; // reflow to restart animation
    refreshBtn.classList.add("spinning");
    requestStatus(true);
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

    // Header
    headerDot.style.background = iColor;
    headerDot.classList.toggle("pulse", indicator !== "none");
    headerDesc.textContent = desc;

    // ── Left column: components ──
    const comps = (data.components || []).filter((c) => !c.group);
    const history = data.history || {};
    let left = '<div class="sec-title">Components</div>';

    for (const comp of comps) {
      const s = COMP_STATUS[comp.status] || { label: comp.status, color: C.gray };
      const hist = history[comp.id] || new Array(DAYS).fill("operational");
      const okDays = hist.filter((d) => d === "operational" || d === "none").length;
      const pct = ((okDays / DAYS) * 100).toFixed(1);

      left += `<div class="comp">
        <div class="comp-header">
          <span class="comp-name">${esc(cleanName(comp.name))}</span>
          <span class="comp-badge" style="color:${s.color};background:${s.color}18">${s.label}</span>
        </div>
        <div class="bars">`;
      for (let i = 0; i < DAYS; i++) {
        const st = hist[i] || "operational";
        left += `<div class="bar" style="background:${BAR_COLOR[st] || C.barEmpty}" data-idx="${i}" data-status="${st}"></div>`;
      }
      left += `</div>
        <div class="bar-labels">
          <span>${fmtDate(dates[0])}</span>
          <span class="bar-labels-center">${pct}% uptime</span>
          <span>Today</span>
        </div></div>`;
    }
    colLeft.innerHTML = left;

    // ── Right column: incidents ──
    let right = '<div class="sec-title">Active Incidents</div>';

    if (data.incidents?.length) {
      for (const inc of data.incidents) {
        const ic = INDICATOR_COLOR[inc.impact] || C.gray;
        const updates = inc.incident_updates || [];
        const latest = updates[0];
        const previous = updates.slice(1);

        right += `<div class="incident">
          <div class="inc-top">
            <div class="inc-header">
              <span class="inc-dot" style="background:${ic}"></span>
              <span class="inc-name">${esc(inc.name)}</span>
            </div>`;

        if (latest) {
          const sc = UPDATE_COLOR[latest.status] || C.textSec;
          right += `<div class="inc-status-line">
              <span class="inc-status-badge" style="color:${sc}">${capitalize(latest.status)}</span>
              <span class="inc-time">${timeAgo(latest.updated_at)}</span>
            </div>
            <div class="inc-body">${esc(latest.body)}</div>`;
        }
        right += `</div>`; // close inc-top

        if (previous.length) {
          right += `<div class="inc-toggle">
            <span class="arrow">▾</span>
            <span class="when-collapsed">${previous.length} previous update${previous.length > 1 ? "s" : ""}</span>
            <span class="when-expanded">Collapse</span>
          </div>
          <div class="inc-timeline"><div class="inc-tl-inner">`;

          for (const upd of previous) {
            const uc = UPDATE_COLOR[upd.status] || C.textSec;
            right += `<div class="inc-update">
              <span class="tl-dot" style="background:${uc}"></span>
              <div class="inc-status-line">
                <span class="inc-status-badge" style="color:${uc}">${capitalize(upd.status)}</span>
                <span class="inc-time">${timeAgo(upd.updated_at)}</span>
              </div>
              <div class="inc-body">${esc(upd.body)}</div>
            </div>`;
          }
          right += `</div></div>`; // close inc-tl-inner, inc-timeline
        }

        right += `</div>`; // close incident
      }
    } else {
      right += `<div class="no-incidents">
        <div class="no-inc-icon">✓</div>
        <div class="no-inc-title">All Systems Operational</div>
        <div class="no-inc-sub">No active incidents</div>
      </div>`;
    }
    colRight.innerHTML = right;

    // Footer
    lastUpdatedAt = data.updated_at;
    updateFooterTime();
  }

  function renderError(msg) {
    colLeft.innerHTML = `<div class="error">${esc(msg)}<br><button class="retry-btn">Retry</button></div>`;
    colRight.innerHTML = "";
    colLeft.querySelector(".retry-btn")?.addEventListener("click", () => requestStatus(true));
    badgeDot.style.background = C.gray;
    badgeText.textContent = "Unavailable";
    headerDot.style.background = C.gray;
    headerDesc.textContent = "Unable to load status";
  }

  // ── Footer time ticker ─────────────────────────────────────────────
  function updateFooterTime() {
    if (lastUpdatedAt) {
      updatedAtEl.textContent = "Updated " + timeAgo(lastUpdatedAt);
    }
  }
  setInterval(updateFooterTime, TICK_MS);

  // ── Data fetching ──────────────────────────────────────────────────
  function requestStatus(force = false) {
    chrome.runtime.sendMessage({ type: "GET_STATUS", force }, (res) => {
      if (chrome.runtime.lastError) {
        renderError("Cannot reach extension background");
        return;
      }
      if (res?.ok) render(res.data);
      else renderError(res?.error || "Failed to load status");
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATUS_UPDATE") render(msg.data);
  });

  // Initial + periodic
  requestStatus();
  setInterval(requestStatus, POLL_MS);
})();
