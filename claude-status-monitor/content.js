(() => {
  "use strict";

  // ── Config ─────────────────────────────────────────────────────────
  const DAYS = 30;
  const POLL_MS = 30_000;
  const TICK_MS = 15_000;

  const DEFAULTS = {
    badgeX: null,
    badgeY: null,
    panelW: 640,
    panelH: 460,
    colRightW: 270,
    fontSize: 14,
  };

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
  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  // ── Settings persistence ─────────────────────────────────────────
  let settings = { ...DEFAULTS };

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get("csm_settings", (result) => {
        if (result.csm_settings) {
          settings = { ...DEFAULTS, ...result.csm_settings };
        }
        resolve();
      });
    });
  }

  function saveSettings() {
    chrome.storage.local.set({ csm_settings: settings });
  }

  function resetSettings() {
    settings = { ...DEFAULTS };
    chrome.storage.local.remove("csm_settings");
    applySettings();
  }

  function applySettings() {
    if (settings.badgeX !== null && settings.badgeY !== null) {
      host.style.right = "auto";
      host.style.bottom = "auto";
      host.style.left = clamp(settings.badgeX, 0, window.innerWidth - 60) + "px";
      host.style.top = clamp(settings.badgeY, 0, window.innerHeight - 30) + "px";
    } else {
      host.style.right = "16px";
      host.style.bottom = "16px";
      host.style.left = "auto";
      host.style.top = "auto";
    }

    panel.style.width = settings.panelW + "px";
    panel.style.height = settings.panelH + "px";
    colRight.style.width = settings.colRightW + "px";

    host.style.fontSize = settings.fontSize + "px";
    if (fontSlider) fontSlider.value = settings.fontSize;
    if (fontLabel) fontLabel.textContent = settings.fontSize + "px";

    updateLayout();
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
      cursor: grab;
      user-select: none;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
      pointer-events: auto;
      transition: opacity .18s ease, background .12s ease, box-shadow .12s ease;
    }
    .badge:hover {
      background: ${C.elevated};
      box-shadow: 0 4px 14px rgba(0,0,0,.12);
    }
    .badge.dragging { cursor: grabbing; }
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

    /* ── Panel (fixed position, JS-placed) ── */
    .panel {
      position: fixed;
      width: 640px;
      max-width: calc(100vw - 16px);
      height: 460px;
      max-height: calc(100vh - 16px);
      min-width: 300px;
      min-height: 250px;
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
      transform: scale(.96);
      transition:
        visibility 0s .22s,
        opacity .22s ease,
        transform .22s cubic-bezier(.16,1,.3,1);
    }
    .panel.open {
      visibility: visible;
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
      transition-delay: 0s;
    }

    /* ── Resize handles ── */
    .resize-handle {
      position: absolute;
      z-index: 10;
    }
    .resize-n  { top: -4px; left: 14px; right: 14px; height: 8px; cursor: n-resize; }
    .resize-s  { bottom: -4px; left: 14px; right: 14px; height: 8px; cursor: s-resize; }
    .resize-w  { left: -4px; top: 14px; bottom: 14px; width: 8px; cursor: w-resize; }
    .resize-e  { right: -4px; top: 14px; bottom: 14px; width: 8px; cursor: e-resize; }
    .resize-nw { top: -4px; left: -4px; width: 14px; height: 14px; cursor: nw-resize; }
    .resize-ne { top: -4px; right: -4px; width: 14px; height: 14px; cursor: ne-resize; }
    .resize-sw { bottom: -4px; left: -4px; width: 14px; height: 14px; cursor: sw-resize; }
    .resize-se { bottom: -4px; right: -4px; width: 14px; height: 14px; cursor: se-resize; }

    /* Header */
    .p-header {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid ${C.border};
      background: ${C.surface};
      cursor: grab;
      user-select: none;
      border-radius: 14px 14px 0 0;
    }
    .p-header.dragging { cursor: grabbing; }
    .p-header .dot { width: 10px; height: 10px; }
    .p-header-info { flex: 1; min-width: 0; }
    .p-title { font-weight: 600; font-size: 1.07em; }
    .p-desc  { font-size: .93em; color: ${C.textSec}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .header-controls {
      display: flex; align-items: center; gap: 8px;
      flex-shrink: 0;
    }
    .font-control {
      display: flex; align-items: center; gap: 4px;
      font-size: 11px; color: ${C.textMut};
    }
    .font-control label { white-space: nowrap; }
    .font-slider {
      width: 60px; height: 3px;
      -webkit-appearance: none; appearance: none;
      background: ${C.border}; border-radius: 2px;
      outline: none; cursor: pointer;
    }
    .font-slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 12px; height: 12px; border-radius: 50%;
      background: ${C.accent}; cursor: pointer;
      border: none;
    }
    .font-label { min-width: 30px; text-align: center; }

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
    .p-body.stacked {
      flex-direction: column-reverse;
    }
    .col { overflow-y: auto; padding: 14px 16px; }
    .col::-webkit-scrollbar { width: 3px; }
    .col::-webkit-scrollbar-thumb { background: ${C.borderSub}; border-radius: 2px; }
    .col::-webkit-scrollbar-track { background: transparent; }
    .col-left {
      flex: 1; min-width: 0;
    }
    .col-right { width: 270px; flex-shrink: 0; }

    /* ── Column divider ── */
    .col-divider {
      width: 5px;
      flex-shrink: 0;
      cursor: col-resize;
      position: relative;
      background: transparent;
      transition: background .15s;
    }
    .col-divider::after {
      content: '';
      position: absolute;
      top: 0; bottom: 0;
      left: 2px;
      width: 1px;
      background: ${C.border};
    }
    .col-divider:hover, .col-divider.active {
      background: ${C.accent}22;
    }
    .col-divider:hover::after, .col-divider.active::after {
      background: ${C.accent};
    }

    .p-body.stacked .col-divider {
      display: none;
    }
    .p-body.stacked .col-left {
      border-top: 1px solid ${C.border};
    }
    .p-body.stacked .col-right {
      width: auto;
      flex-shrink: 1;
    }

    .sec-title {
      font-size: .79em; font-weight: 600; text-transform: uppercase;
      letter-spacing: .6px; color: ${C.textMut}; margin-bottom: 10px;
    }

    /* ── Components + bars ── */
    .comp { margin-bottom: 14px; }
    .comp-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 5px;
    }
    .comp-name { font-size: .93em; font-weight: 500; }
    .comp-badge {
      font-size: .79em; font-weight: 600; padding: 2px 8px;
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
      margin-top: 3px; font-size: .79em; color: ${C.textMut};
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
    .inc-name { font-size: .93em; font-weight: 600; line-height: 1.35; }
    .inc-status-line { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .inc-status-badge {
      font-size: .79em; font-weight: 600; text-transform: uppercase;
      letter-spacing: .3px;
    }
    .inc-time { font-size: .79em; color: ${C.textMut}; }
    .inc-body {
      font-size: .86em; color: ${C.textSec}; line-height: 1.5;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .incident.expanded .inc-body { -webkit-line-clamp: unset; }

    .inc-toggle {
      display: flex; align-items: center; gap: 5px;
      padding: 6px 14px 8px;
      font-size: .79em; color: ${C.accent}; cursor: pointer;
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
    .inc-update .inc-body { -webkit-line-clamp: unset; }

    .no-incidents {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; text-align: center;
      padding: 24px 12px 16px; color: ${C.textMut};
    }
    .no-inc-icon {
      width: 36px; height: 36px; border-radius: 50%;
      background: ${C.green}18; color: ${C.green};
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; margin-bottom: 8px;
    }
    .no-inc-title { font-size: 1em; font-weight: 600; color: ${C.textSec}; }
    .no-inc-sub { font-size: .86em; margin-top: 2px; }

    /* Recent incidents toggle */
    .recent-toggle {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 14px;
      font-size: .86em; font-weight: 500; color: ${C.accent};
      cursor: pointer;
      border-top: 1px solid ${C.border};
      transition: background .1s;
    }
    .recent-toggle:hover { background: ${C.elevated}; }
    .recent-toggle .arrow {
      display: inline-block; font-size: 9px;
      transition: transform .2s ease;
    }
    .recent-toggle.expanded .arrow { transform: rotate(180deg); }
    .recent-list { padding: 0 8px 8px; }
    .recent-list .incident { opacity: .7; }
    .recent-list .incident:hover { opacity: 1; }

    /* ── Footer ── */
    .p-footer {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px;
      border-top: 1px solid ${C.border};
      font-size: .86em; color: ${C.textMut};
      background: ${C.surface};
      border-radius: 0 0 14px 14px;
    }
    .p-footer-left { display: flex; align-items: center; gap: 6px; flex: 1; }
    .refresh-btn {
      background: none; border: none; color: ${C.textMut};
      cursor: pointer; font-size: 15px; line-height: 1;
      padding: 2px; border-radius: 4px; transition: all .1s;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .refresh-btn:hover { color: ${C.text}; background: ${C.elevated}; }
    .refresh-btn.spinning { animation: spin .6s ease; }
    @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }

    .reset-btn {
      display: inline-flex; align-items: center; gap: 4px;
      background: ${C.bg}; border: 1px solid ${C.border};
      color: ${C.textSec}; cursor: pointer;
      font-size: .79em; font-weight: 500;
      padding: 4px 10px; border-radius: 8px;
      transition: all .15s ease; white-space: nowrap;
    }
    .reset-btn:hover {
      color: ${C.text}; background: ${C.elevated};
      border-color: ${C.borderSub};
    }

    .footer-link {
      color: ${C.accent}; text-decoration: none;
      font-weight: 500; font-size: .86em;
      padding: 4px 10px; border-radius: 8px;
      transition: all .15s; white-space: nowrap;
    }
    .footer-link:hover {
      background: ${C.accent}14;
      text-decoration: none;
    }

    /* ── Tooltip ── */
    .tooltip {
      position: fixed; pointer-events: none;
      padding: 6px 10px; border-radius: 6px;
      background: ${C.surface}; border: 1px solid ${C.borderSub};
      font-size: .86em; line-height: 1.4; white-space: nowrap;
      opacity: 0; transition: opacity .1s;
      transform: translate(-50%, -100%);
      box-shadow: 0 3px 10px rgba(0,0,0,.1);
    }
    .tooltip.show { opacity: 1; }
    .tooltip-date { font-weight: 600; color: ${C.text}; }
    .tooltip-status { color: ${C.textSec}; }

    .loading, .error {
      display: flex; align-items: center; justify-content: center;
      height: 100%; text-align: center; font-size: .93em; color: ${C.textMut};
      padding: 24px;
    }
    .error { color: ${C.red}; flex-direction: column; }
    .retry-btn {
      margin-top: 10px; padding: 5px 14px; border-radius: 8px;
      border: 1px solid ${C.border}; background: ${C.surface};
      color: ${C.text}; cursor: pointer; font-size: .86em; transition: background .1s;
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
    <div class="resize-handle resize-n"></div>
    <div class="resize-handle resize-s"></div>
    <div class="resize-handle resize-w"></div>
    <div class="resize-handle resize-e"></div>
    <div class="resize-handle resize-nw"></div>
    <div class="resize-handle resize-ne"></div>
    <div class="resize-handle resize-sw"></div>
    <div class="resize-handle resize-se"></div>
    <div class="p-header">
      <span class="dot pulse" style="background:${C.gray}"></span>
      <div class="p-header-info">
        <div class="p-title">Claude Status</div>
        <div class="p-desc">Loading…</div>
      </div>
      <div class="header-controls">
        <div class="font-control">
          <label>A</label>
          <input type="range" class="font-slider" min="10" max="20" value="14" step="1">
          <span class="font-label">14px</span>
        </div>
        <button class="close-btn" title="Close">✕</button>
      </div>
    </div>
    <div class="p-body">
      <div class="col col-left"><div class="loading">Loading…</div></div>
      <div class="col-divider"></div>
      <div class="col col-right"><div class="loading">Loading…</div></div>
    </div>
    <div class="p-footer">
      <div class="p-footer-left">
        <span class="updated-at"></span>
        <button class="refresh-btn" title="Refresh now">↻</button>
      </div>
      <button class="reset-btn" title="Reset all settings to defaults">↺ Reset</button>
      <a class="footer-link" href="https://status.claude.com" target="_blank" rel="noopener">status.claude.com ↗</a>
    </div>`;

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.innerHTML = `<span class="dot pulse" style="background:${C.gray}"></span><span class="badge-text">Loading…</span>`;

  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";

  wrap.appendChild(badge);
  wrap.appendChild(tooltip);
  shadow.appendChild(panel);
  shadow.appendChild(wrap);
  document.body.appendChild(host);

  // Refs
  const badgeDot    = badge.querySelector(".dot");
  const badgeText   = badge.querySelector(".badge-text");
  const pHeader     = panel.querySelector(".p-header");
  const headerDot   = panel.querySelector(".p-header .dot");
  const headerDesc  = panel.querySelector(".p-desc");
  const colLeft     = panel.querySelector(".col-left");
  const colDivider  = panel.querySelector(".col-divider");
  const colRight    = panel.querySelector(".col-right");
  const pBody       = panel.querySelector(".p-body");
  const updatedAtEl = panel.querySelector(".updated-at");
  const refreshBtn  = panel.querySelector(".refresh-btn");
  const resetBtn    = panel.querySelector(".reset-btn");
  const fontSlider  = panel.querySelector(".font-slider");
  const fontLabel   = panel.querySelector(".font-label");

  // ── State ──────────────────────────────────────────────────────────
  let panelOpen = false;
  let panelWasDragged = false;
  let lastUpdatedAt = null;
  let dates = buildDates();

  // ── Smart panel positioning ──────────────────────────────────────
  // Centers panel horizontally on badge, opens vertically toward screen center
  function positionPanel() {
    const badgeRect = badge.getBoundingClientRect();
    const bCx = badgeRect.left + badgeRect.width / 2;
    const bCy = badgeRect.top + badgeRect.height / 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = settings.panelW;
    const ph = settings.panelH;
    const gap = 8;
    const margin = 8;

    // Horizontal: CENTER the panel on the badge
    let left = bCx - pw / 2;

    // Vertical: open toward where there's more space
    let top;
    if (bCy > vh / 2) {
      top = badgeRect.top - gap - ph;
    } else {
      top = badgeRect.bottom + gap;
    }

    // Clamp to viewport
    left = clamp(left, margin, vw - pw - margin);
    top = clamp(top, margin, vh - ph - margin);

    panel.style.left = left + "px";
    panel.style.top = top + "px";

    // Set transform-origin so animation grows from badge direction
    const originX = clamp((bCx - left) / pw * 100, 0, 100);
    const originY = clamp((bCy - top) / ph * 100, 0, 100);
    panel.style.transformOrigin = `${Math.round(originX)}% ${Math.round(originY)}%`;
  }

  // ── Panel open / close ─────────────────────────────────────────────
  function openPanel() {
    panelOpen = true;
    panelWasDragged = false;
    positionPanel();
    panel.classList.add("open");
    badge.classList.add("hide");
    updateLayout();
  }

  function closePanel() {
    if (!panelOpen) return;

    // If panel was dragged, move badge to panel center
    if (panelWasDragged) {
      const pr = panel.getBoundingClientRect();
      const bw = badge.offsetWidth || 120;
      const bh = badge.offsetHeight || 32;
      const newX = clamp(pr.left + pr.width / 2 - bw / 2, 0, window.innerWidth - bw);
      const newY = clamp(pr.top + pr.height / 2 - bh / 2, 0, window.innerHeight - bh);

      host.style.left = newX + "px";
      host.style.top = newY + "px";
      host.style.right = "auto";
      host.style.bottom = "auto";

      settings.badgeX = newX;
      settings.badgeY = newY;
      saveSettings();
    }

    panelWasDragged = false;
    panelOpen = false;
    panel.classList.remove("open");
    badge.classList.remove("hide");
    hideTooltip();
  }

  badge.addEventListener("click", (e) => {
    if (badge._wasDragged) { badge._wasDragged = false; return; }
    openPanel();
  });
  panel.querySelector(".close-btn").addEventListener("click", closePanel);

  // Click outside to close
  document.addEventListener("pointerdown", (e) => {
    if (!panelOpen) return;
    if (panel.contains(e.composedPath()[0])) return;
    if (host.contains(e.target) || e.target === host) return;
    closePanel();
  });
  wrap.addEventListener("pointerdown", (e) => {
    if (!panelOpen) return;
    closePanel();
  });
  panel.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });

  // ── Draggable badge ──────────────────────────────────────────────
  let dragState = null;

  badge.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const rect = host.getBoundingClientRect();
    dragState = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: rect.left,
      startY: rect.top,
      moved: false,
    };
    badge.classList.add("dragging");
    badge.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  badge.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startMouseX;
    const dy = e.clientY - dragState.startMouseY;
    if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    dragState.moved = true;

    const newX = clamp(dragState.startX + dx, 0, window.innerWidth - 60);
    const newY = clamp(dragState.startY + dy, 0, window.innerHeight - 30);

    host.style.left = newX + "px";
    host.style.top = newY + "px";
    host.style.right = "auto";
    host.style.bottom = "auto";
  });

  badge.addEventListener("pointerup", (e) => {
    if (!dragState) return;
    badge.classList.remove("dragging");
    if (dragState.moved) {
      badge._wasDragged = true;
      const rect = host.getBoundingClientRect();
      settings.badgeX = rect.left;
      settings.badgeY = rect.top;
      saveSettings();
    }
    dragState = null;
  });

  // ── Draggable panel (via header) ─────────────────────────────────
  let panelDragState = null;

  pHeader.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".close-btn, .font-control, button, input")) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const panelRect = panel.getBoundingClientRect();
    panelDragState = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startLeft: panelRect.left,
      startTop: panelRect.top,
    };
    pHeader.classList.add("dragging");
    pHeader.setPointerCapture(e.pointerId);
  });

  pHeader.addEventListener("pointermove", (e) => {
    if (!panelDragState) return;
    panelWasDragged = true;
    const dx = e.clientX - panelDragState.startMouseX;
    const dy = e.clientY - panelDragState.startMouseY;

    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const newLeft = clamp(panelDragState.startLeft + dx, 0, window.innerWidth - pw);
    const newTop = clamp(panelDragState.startTop + dy, 0, window.innerHeight - ph);

    panel.style.left = newLeft + "px";
    panel.style.top = newTop + "px";
  });

  pHeader.addEventListener("pointerup", () => {
    if (!panelDragState) return;
    panelDragState = null;
    pHeader.classList.remove("dragging");
  });

  // ── Resizable panel ──────────────────────────────────────────────
  let resizeState = null;

  function startResize(e, dir) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = panel.getBoundingClientRect();
    resizeState = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      startW: r.width,
      startH: r.height,
      startLeft: r.left,
      startTop: r.top,
    };
    document.addEventListener("pointermove", onResizeMove, true);
    document.addEventListener("pointerup", onResizeEnd, true);
  }

  function onResizeMove(e) {
    if (!resizeState) return;
    const dx = e.clientX - resizeState.startX;
    const dy = e.clientY - resizeState.startY;
    const { dir, startW, startH, startLeft, startTop } = resizeState;
    const maxW = window.innerWidth - 16;
    const maxH = window.innerHeight - 16;

    if (dir.includes("n")) {
      const newH = clamp(startH - dy, 250, maxH);
      panel.style.height = newH + "px";
      panel.style.top = Math.max(0, startTop + (startH - newH)) + "px";
      settings.panelH = newH;
    }
    if (dir.includes("s")) {
      const newH = clamp(startH + dy, 250, maxH);
      panel.style.height = newH + "px";
      settings.panelH = newH;
    }
    if (dir.includes("w")) {
      const newW = clamp(startW - dx, 300, maxW);
      panel.style.width = newW + "px";
      panel.style.left = Math.max(0, startLeft + (startW - newW)) + "px";
      settings.panelW = newW;
    }
    if (dir.includes("e")) {
      const newW = clamp(startW + dx, 300, maxW);
      panel.style.width = newW + "px";
      settings.panelW = newW;
    }
    updateLayout();
  }

  function onResizeEnd() {
    if (!resizeState) return;
    resizeState = null;
    document.removeEventListener("pointermove", onResizeMove, true);
    document.removeEventListener("pointerup", onResizeEnd, true);
    saveSettings();
  }

  for (const dir of ["n", "s", "w", "e", "nw", "ne", "sw", "se"]) {
    panel.querySelector(`.resize-${dir}`).addEventListener("pointerdown", (e) => startResize(e, dir));
  }

  // ── Draggable column divider ─────────────────────────────────────
  let dividerState = null;

  colDivider.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dividerState = {
      startX: e.clientX,
      startRightW: colRight.offsetWidth,
    };
    colDivider.classList.add("active");
    colDivider.setPointerCapture(e.pointerId);
  });

  colDivider.addEventListener("pointermove", (e) => {
    if (!dividerState) return;
    const dx = e.clientX - dividerState.startX;
    const newW = clamp(dividerState.startRightW - dx, 120, panel.offsetWidth - 200);
    colRight.style.width = newW + "px";
    settings.colRightW = newW;
  });

  colDivider.addEventListener("pointerup", () => {
    if (!dividerState) return;
    dividerState = null;
    colDivider.classList.remove("active");
    saveSettings();
  });

  // ── Responsive layout ────────────────────────────────────────────
  function updateLayout() {
    const w = parseInt(panel.style.width) || settings.panelW;
    if (w < 480) {
      pBody.classList.add("stacked");
    } else {
      pBody.classList.remove("stacked");
    }
  }

  // ── Font-size slider ─────────────────────────────────────────────
  fontSlider.addEventListener("input", (e) => {
    const size = parseInt(e.target.value);
    settings.fontSize = size;
    host.style.fontSize = size + "px";
    fontLabel.textContent = size + "px";
  });
  fontSlider.addEventListener("change", () => {
    saveSettings();
  });

  // ── Reset button ─────────────────────────────────────────────────
  resetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    resetSettings();
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

  // ── Right column click handling ──────────────────────────────────
  colRight.addEventListener("click", (e) => {
    // Recent incidents toggle
    const recentToggle = e.target.closest(".recent-toggle");
    if (recentToggle) {
      const list = colRight.querySelector(".recent-list");
      if (list) {
        const isShown = list.style.display !== "none";
        list.style.display = isShown ? "none" : "";
        recentToggle.classList.toggle("expanded", !isShown);
      }
      return;
    }

    // Incident expand/collapse
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
    void refreshBtn.offsetWidth;
    refreshBtn.classList.add("spinning");
    requestStatus(true);
  });

  // ── Render helpers ─────────────────────────────────────────────────
  function renderIncidentCard(inc) {
    const ic = INDICATOR_COLOR[inc.impact] || C.gray;
    const updates = inc.incident_updates || [];
    const latest = updates[0];
    const previous = updates.slice(1);

    let html = `<div class="incident">
      <div class="inc-top">
        <div class="inc-header">
          <span class="inc-dot" style="background:${ic}"></span>
          <span class="inc-name">${esc(inc.name)}</span>
        </div>`;

    if (latest) {
      const sc = UPDATE_COLOR[latest.status] || C.textSec;
      html += `<div class="inc-status-line">
          <span class="inc-status-badge" style="color:${sc}">${capitalize(latest.status)}</span>
          <span class="inc-time">${timeAgo(latest.updated_at)}</span>
        </div>
        <div class="inc-body">${esc(latest.body)}</div>`;
    }
    html += `</div>`;

    if (previous.length) {
      html += `<div class="inc-toggle">
        <span class="arrow">▾</span>
        <span class="when-collapsed">${previous.length} previous update${previous.length > 1 ? "s" : ""}</span>
        <span class="when-expanded">Collapse</span>
      </div>
      <div class="inc-timeline"><div class="inc-tl-inner">`;

      for (const upd of previous) {
        const uc = UPDATE_COLOR[upd.status] || C.textSec;
        html += `<div class="inc-update">
          <span class="tl-dot" style="background:${uc}"></span>
          <div class="inc-status-line">
            <span class="inc-status-badge" style="color:${uc}">${capitalize(upd.status)}</span>
            <span class="inc-time">${timeAgo(upd.updated_at)}</span>
          </div>
          <div class="inc-body">${esc(upd.body)}</div>
        </div>`;
      }
      html += `</div></div>`;
    }

    html += `</div>`;
    return html;
  }

  // ── Render ─────────────────────────────────────────────────────────
  function render(data) {
    hideTooltip();
    dates = buildDates();

    const indicator = data.status?.indicator || "unknown";
    const iColor = INDICATOR_COLOR[indicator] || C.gray;
    const desc = data.status?.description || "Unknown";

    badgeDot.style.background = iColor;
    badgeText.textContent = desc;
    badgeDot.classList.toggle("pulse", indicator !== "none");

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
    const hasActive = data.incidents?.length > 0;
    const recentIncs = data.recentIncidents || [];
    const hasRecent = recentIncs.length > 0;

    let right = "";

    if (hasActive) {
      // Show active incidents
      right += '<div class="sec-title">Active Incidents</div>';
      for (const inc of data.incidents) {
        right += renderIncidentCard(inc);
      }
      colRight.style.display = "";
      colDivider.style.display = "";
    } else if (hasRecent) {
      // Compact mode: all operational + collapsed recent list
      right += '<div class="sec-title">Incidents</div>';
      right += `<div class="no-incidents">
        <div class="no-inc-icon">✓</div>
        <div class="no-inc-title">All Systems Operational</div>
        <div class="no-inc-sub">No active incidents</div>
      </div>`;
      right += `<div class="recent-toggle">
        <span class="arrow">▾</span>
        <span>Recent Incidents</span>
      </div>
      <div class="recent-list" style="display:none">`;
      for (const inc of recentIncs) {
        const ic = C.green;
        right += `<div class="incident">
          <div class="inc-top">
            <div class="inc-header">
              <span class="inc-dot" style="background:${ic}"></span>
              <span class="inc-name">${esc(inc.name)}</span>
            </div>
            <div class="inc-status-line">
              <span class="inc-status-badge" style="color:${C.green}">Resolved</span>
              <span class="inc-time">${timeAgo(inc.resolved_at)}</span>
            </div>
          </div>
        </div>`;
      }
      right += `</div>`;
      colRight.style.display = "";
      colDivider.style.display = "";
    } else {
      // No incidents at all → hide right column
      colRight.style.display = "none";
      colDivider.style.display = "none";
    }

    colRight.innerHTML = right;

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

  // ── Init ───────────────────────────────────────────────────────────
  loadSettings().then(() => {
    applySettings();
    requestStatus();
  });
  setInterval(requestStatus, POLL_MS);
})();
