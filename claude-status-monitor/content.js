(() => {
  "use strict";

  // ── Config ─────────────────────────────────────────────────────────
  const DAYS = 30; // fallback; the real count comes from data.historyDays
  const POLL_MS = 30_000;
  const TICK_MS = 15_000;

  // Day count actually rendered — synced to background's HISTORY_DAYS via
  // data.historyDays so the two files can't silently drift apart.
  let dayCount = DAYS;

  const DEFAULTS = {
    badgeX: null,
    badgeY: null,
    panelW: 640,
    panelH: 460,
    colRightW: 270,
    fontSize: 14,
    locale: null,
    badgeScale: 1.0,
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

  // ── i18n strings ──────────────────────────────────────────────────
  const STRINGS = {
    en: {
      panelTitle: "Claude Status",
      loading: "Loading\u2026",
      close: "Close",
      refreshNow: "Refresh now",
      resetTitle: "Reset all settings to defaults",
      resetLabel: "\u21BA Reset",
      footerLink: "status.claude.com \u2197",
      fontLabel: "A",
      statusOperational: "Operational",
      statusDegraded: "Degraded",
      statusPartialOutage: "Partial Outage",
      statusMajorOutage: "Major Outage",
      statusMaintenance: "Maintenance",
      barNoIncidents: "No incidents",
      barMinor: "Minor incident",
      barMajor: "Major incident",
      barCritical: "Critical incident",
      timeJustNow: "just now",
      timeMinAgo: "$1m ago",
      timeHourAgo: "$1h ago",
      timeDayAgo: "$1d ago",
      sectionComponents: "Components",
      sectionActiveIncidents: "Active Incidents",
      sectionIncidents: "Incidents",
      allOperational: "All Systems Operational",
      noActiveIncidents: "No active incidents",
      recentIncidents: "Recent Incidents",
      today: "Today",
      uptime: "% uptime",
      previousUpdate: "$1 previous update",
      previousUpdates: "$1 previous updates",
      collapse: "Collapse",
      resolved: "Resolved",
      incInvestigating: "Investigating",
      incIdentified: "Identified",
      incMonitoring: "Monitoring",
      incUpdate: "Update",
      incResolved: "Resolved",
      incPostmortem: "Postmortem",
      errorBackground: "Cannot reach extension background",
      errorLoad: "Failed to load status",
      errorUnableToLoad: "Unable to load status",
      unavailable: "Unavailable",
      retry: "Retry",
      updatedPrefix: "Updated ",
      dateLocale: "en-US",
    },
    zh_TW: {
      panelTitle: "Claude \u670D\u52D9\u72C0\u614B",
      loading: "\u8F09\u5165\u4E2D\u2026",
      close: "\u95DC\u9589",
      refreshNow: "\u7ACB\u5373\u91CD\u65B0\u6574\u7406",
      resetTitle: "\u91CD\u8A2D\u6240\u6709\u8A2D\u5B9A\u70BA\u9810\u8A2D\u503C",
      resetLabel: "\u21BA \u91CD\u8A2D",
      footerLink: "status.claude.com \u2197",
      fontLabel: "A",
      statusOperational: "\u6B63\u5E38\u904B\u4F5C",
      statusDegraded: "\u6548\u80FD\u964D\u4F4E",
      statusPartialOutage: "\u90E8\u5206\u4E2D\u65B7",
      statusMajorOutage: "\u91CD\u5927\u4E2D\u65B7",
      statusMaintenance: "\u7DAD\u8B77\u4E2D",
      barNoIncidents: "\u7121\u4E8B\u4EF6",
      barMinor: "\u8F15\u5FAE\u4E8B\u4EF6",
      barMajor: "\u91CD\u5927\u4E8B\u4EF6",
      barCritical: "\u56B4\u91CD\u4E8B\u4EF6",
      timeJustNow: "\u525B\u525B",
      timeMinAgo: "$1 \u5206\u9418\u524D",
      timeHourAgo: "$1 \u5C0F\u6642\u524D",
      timeDayAgo: "$1 \u5929\u524D",
      sectionComponents: "\u670D\u52D9\u5143\u4EF6",
      sectionActiveIncidents: "\u9032\u884C\u4E2D\u7684\u4E8B\u4EF6",
      sectionIncidents: "\u4E8B\u4EF6",
      allOperational: "\u6240\u6709\u7CFB\u7D71\u6B63\u5E38\u904B\u4F5C",
      noActiveIncidents: "\u76EE\u524D\u7121\u9032\u884C\u4E2D\u7684\u4E8B\u4EF6",
      recentIncidents: "\u8FD1\u671F\u4E8B\u4EF6",
      today: "\u4ECA\u5929",
      uptime: "% \u6B63\u5E38\u904B\u884C",
      previousUpdate: "$1 \u5247\u5148\u524D\u66F4\u65B0",
      previousUpdates: "$1 \u5247\u5148\u524D\u66F4\u65B0",
      collapse: "\u6536\u5408",
      resolved: "\u5DF2\u89E3\u6C7A",
      incInvestigating: "\u8ABF\u67E5\u4E2D",
      incIdentified: "\u5DF2\u78BA\u8A8D",
      incMonitoring: "\u76E3\u63A7\u4E2D",
      incUpdate: "\u66F4\u65B0",
      incResolved: "\u5DF2\u89E3\u6C7A",
      incPostmortem: "\u4E8B\u5F8C\u5206\u6790",
      errorBackground: "\u7121\u6CD5\u9023\u7DDA\u81F3\u64F4\u5145\u529F\u80FD\u80CC\u666F\u7A0B\u5F0F",
      errorLoad: "\u7121\u6CD5\u8F09\u5165\u72C0\u614B",
      errorUnableToLoad: "\u7121\u6CD5\u8F09\u5165\u72C0\u614B",
      unavailable: "\u7121\u6CD5\u4F7F\u7528",
      retry: "\u91CD\u8A66",
      updatedPrefix: "\u66F4\u65B0\u65BC ",
      dateLocale: "zh-TW",
    },
  };

  function getLocale() {
    if (settings.locale) return settings.locale;
    try {
      const uiLang = chrome.i18n.getUILanguage();
      if (uiLang.startsWith("zh")) return "zh_TW";
    } catch (e) {}
    return "en";
  }

  function msg(key) {
    const locale = getLocale();
    return STRINGS[locale]?.[key] || STRINGS.en[key] || key;
  }

  // ── Status mappings ───────────────────────────────────────────────
  const INDICATOR_COLOR = {
    none: C.green, minor: C.yellow, major: C.orange, critical: C.red, unknown: C.gray,
  };
  const COMP_STATUS = {
    operational:          { key: "statusOperational",    color: C.green },
    degraded_performance: { key: "statusDegraded",       color: C.yellow },
    partial_outage:       { key: "statusPartialOutage",  color: C.orange },
    major_outage:         { key: "statusMajorOutage",    color: C.red },
    under_maintenance:    { key: "statusMaintenance",    color: C.blue },
  };
  const DESC_KEY = {
    none: "allOperational", minor: "statusDegraded",
    major: "statusPartialOutage", critical: "statusMajorOutage",
    maintenance: "statusMaintenance",
  };
  const BAR_COLOR = {
    operational: C.barOk, none: C.barOk,
    minor: C.barMinor, major: C.barMajor, critical: C.barCrit,
  };
  const BAR_LABEL_KEY = {
    operational: "barNoIncidents", none: "barNoIncidents",
    minor: "barMinor", major: "barMajor", critical: "barCritical",
  };
  const UPDATE_COLOR = {
    investigating: C.orange, identified: C.yellow, monitoring: C.blue,
    update: C.textSec, resolved: C.green, postmortem: C.textMut,
  };
  const INC_STATUS_KEY = {
    investigating: "incInvestigating", identified: "incIdentified",
    monitoring: "incMonitoring", update: "incUpdate",
    resolved: "incResolved", postmortem: "incPostmortem",
  };

  // ── Helpers ────────────────────────────────────────────────────────
  function timeAgo(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return msg("timeJustNow");
    if (m < 60) return msg("timeMinAgo").replace("$1", m);
    const h = Math.floor(m / 60);
    if (h < 24) return msg("timeHourAgo").replace("$1", h);
    return msg("timeDayAgo").replace("$1", Math.floor(h / 24));
  }
  function fmtDate(d) {
    return d.toLocaleDateString(msg("dateLocale"), { month: "short", day: "numeric" });
  }
  function esc(s) {
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function incStatusLabel(status) {
    return INC_STATUS_KEY[status] ? msg(INC_STATUS_KEY[status]) : capitalize(status);
  }
  function cleanName(name) {
    return name.replace(/\s*\(formerly[^)]*\)/gi, "").trim();
  }
  function buildDates() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const arr = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (dayCount - 1 - i));
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
    refreshUI();
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

    badge.style.transform = `scale(${settings.badgeScale})`;

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
      transform-origin: center center;
    }
    .badge:hover {
      background: ${C.elevated};
      box-shadow: 0 4px 14px rgba(0,0,0,.12);
    }
    .badge.dragging { cursor: grabbing; }
    .badge.resize-cursor { cursor: nwse-resize !important; }
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

    .lang-btn {
      display: inline-flex; align-items: center;
      background: ${C.bg}; border: 1px solid ${C.border};
      color: ${C.textSec}; cursor: pointer;
      font-size: .79em; font-weight: 500;
      padding: 4px 10px; border-radius: 8px;
      transition: all .15s ease; white-space: nowrap;
    }
    .lang-btn:hover {
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
        <div class="p-title">${msg("panelTitle")}</div>
        <div class="p-desc">${msg("loading")}</div>
      </div>
      <div class="header-controls">
        <div class="font-control">
          <label>${msg("fontLabel")}</label>
          <input type="range" class="font-slider" min="10" max="20" value="14" step="1">
          <span class="font-label">14px</span>
        </div>
        <button class="close-btn" title="${msg("close")}">&#x2715;</button>
      </div>
    </div>
    <div class="p-body">
      <div class="col col-left"><div class="loading">${msg("loading")}</div></div>
      <div class="col-divider"></div>
      <div class="col col-right"><div class="loading">${msg("loading")}</div></div>
    </div>
    <div class="p-footer">
      <div class="p-footer-left">
        <span class="updated-at"></span>
        <button class="refresh-btn" title="${msg("refreshNow")}">&#x21BB;</button>
      </div>
      <button class="reset-btn" title="${msg("resetTitle")}">${msg("resetLabel")}</button>
      <button class="lang-btn">${getLocale() === "en" ? "\u4E2D\u6587" : "EN"}</button>
      <a class="footer-link" href="https://status.claude.com" target="_blank" rel="noopener">${msg("footerLink")}</a>
    </div>`;

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.innerHTML = `<span class="dot pulse" style="background:${C.gray}"></span><span class="badge-text">${msg("loading")}</span>`;

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
  const langBtn     = panel.querySelector(".lang-btn");
  const fontSlider  = panel.querySelector(".font-slider");
  const fontLabel   = panel.querySelector(".font-label");

  // ── State ──────────────────────────────────────────────────────────
  let panelOpen = false;
  let panelWasDragged = false;
  let lastUpdatedAt = null;
  let lastData = null;
  let dates = buildDates();
  let badgeResizeState = null;
  let pollTimer = null, tickTimer = null;

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

  // ── Draggable badge + badge resize ──────────────────────────────
  let dragState = null;

  badge.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const rect = badge.getBoundingClientRect();
    const threshold = 8;
    const nearEdge = (
      e.clientX - rect.left < threshold ||
      rect.right - e.clientX < threshold ||
      e.clientY - rect.top < threshold ||
      rect.bottom - e.clientY < threshold
    );

    if (nearEdge) {
      // Start badge resize
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const startDist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
      badgeResizeState = {
        startDist: startDist || 1,
        startScale: settings.badgeScale,
        centerX,
        centerY,
      };
      badge.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // Start badge drag
    const hostRect = host.getBoundingClientRect();
    dragState = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: hostRect.left,
      startY: hostRect.top,
      moved: false,
    };
    badge.classList.add("dragging");
    badge.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  badge.addEventListener("pointermove", (e) => {
    if (badgeResizeState) {
      const dist = Math.hypot(e.clientX - badgeResizeState.centerX, e.clientY - badgeResizeState.centerY);
      const ratio = dist / badgeResizeState.startDist;
      settings.badgeScale = clamp(badgeResizeState.startScale * ratio, 0.5, 2.5);
      badge.style.transform = `scale(${settings.badgeScale})`;
      badge._wasDragged = true;
      return;
    }

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
    if (badgeResizeState) {
      badgeResizeState = null;
      saveSettings();
      return;
    }

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

  // Badge edge hover cursor
  badge.addEventListener("mousemove", (e) => {
    if (dragState || badgeResizeState) return;
    const rect = badge.getBoundingClientRect();
    const threshold = 8;
    const nearEdge = (
      e.clientX - rect.left < threshold ||
      rect.right - e.clientX < threshold ||
      e.clientY - rect.top < threshold ||
      rect.bottom - e.clientY < threshold
    );
    badge.classList.toggle("resize-cursor", nearEdge);
  });
  badge.addEventListener("mouseleave", () => {
    badge.classList.remove("resize-cursor");
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

  // ── Language toggle ──────────────────────────────────────────────
  langBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    settings.locale = getLocale() === "en" ? "zh_TW" : "en";
    saveSettings();
    refreshUI();
  });

  // ── Refresh UI (language change) ─────────────────────────────────
  function refreshUI() {
    // Header
    panel.querySelector(".p-title").textContent = msg("panelTitle");
    panel.querySelector(".close-btn").title = msg("close");
    panel.querySelector(".font-control label").textContent = msg("fontLabel");

    // Footer
    refreshBtn.title = msg("refreshNow");
    resetBtn.title = msg("resetTitle");
    resetBtn.textContent = msg("resetLabel");
    langBtn.textContent = getLocale() === "en" ? "\u4E2D\u6587" : "EN";
    panel.querySelector(".footer-link").textContent = msg("footerLink");

    updateFooterTime();

    // Re-render data if available
    if (lastData) render(lastData);
  }

  // ── Tooltip ────────────────────────────────────────────────────────
  function showTooltip(barEl, dayIdx, status) {
    const d = dates[dayIdx]; if (!d) return;
    const labelKey = BAR_LABEL_KEY[status];
    const label = labelKey ? msg(labelKey) : status;
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
          <span class="inc-status-badge" style="color:${sc}">${incStatusLabel(latest.status)}</span>
          <span class="inc-time">${timeAgo(latest.updated_at)}</span>
        </div>
        <div class="inc-body">${esc(latest.body)}</div>`;
    }
    html += `</div>`;

    if (previous.length) {
      const prevText = previous.length === 1
        ? msg("previousUpdate").replace("$1", previous.length)
        : msg("previousUpdates").replace("$1", previous.length);
      html += `<div class="inc-toggle">
        <span class="arrow">\u25BE</span>
        <span class="when-collapsed">${prevText}</span>
        <span class="when-expanded">${msg("collapse")}</span>
      </div>
      <div class="inc-timeline"><div class="inc-tl-inner">`;

      for (const upd of previous) {
        const uc = UPDATE_COLOR[upd.status] || C.textSec;
        html += `<div class="inc-update">
          <span class="tl-dot" style="background:${uc}"></span>
          <div class="inc-status-line">
            <span class="inc-status-badge" style="color:${uc}">${incStatusLabel(upd.status)}</span>
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
    lastData = data;
    hideTooltip();
    dayCount = data.historyDays || DAYS;
    dates = buildDates();

    const indicator = data.status?.indicator || "unknown";
    const iColor = INDICATOR_COLOR[indicator] || C.gray;
    const desc = DESC_KEY[indicator] ? msg(DESC_KEY[indicator]) : (data.status?.description || msg("unavailable"));

    badgeDot.style.background = iColor;
    badgeText.textContent = desc;
    badgeDot.classList.toggle("pulse", indicator !== "none");

    headerDot.style.background = iColor;
    headerDot.classList.toggle("pulse", indicator !== "none");
    headerDesc.textContent = desc;

    // ── Left column: components ──
    const comps = (data.components || []).filter((c) => !c.group);
    const history = data.history || {};
    let left = `<div class="sec-title">${msg("sectionComponents")}</div>`;

    for (const comp of comps) {
      const s = COMP_STATUS[comp.status] || { key: null, color: C.gray };
      const label = s.key ? msg(s.key) : comp.status;
      const hist = history[comp.id] || new Array(dayCount).fill("operational");
      const okDays = hist.filter((d) => d === "operational" || d === "none").length;
      const pct = ((okDays / dayCount) * 100).toFixed(1);

      left += `<div class="comp">
        <div class="comp-header">
          <span class="comp-name">${esc(cleanName(comp.name))}</span>
          <span class="comp-badge" style="color:${s.color};background:${s.color}18">${label}</span>
        </div>
        <div class="bars">`;
      for (let i = 0; i < dayCount; i++) {
        const st = hist[i] || "operational";
        left += `<div class="bar" style="background:${BAR_COLOR[st] || C.barEmpty}" data-idx="${i}" data-status="${st}"></div>`;
      }
      left += `</div>
        <div class="bar-labels">
          <span>${fmtDate(dates[0])}</span>
          <span class="bar-labels-center">${pct}${msg("uptime")}</span>
          <span>${msg("today")}</span>
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
      right += `<div class="sec-title">${msg("sectionActiveIncidents")}</div>`;
      for (const inc of data.incidents) {
        right += renderIncidentCard(inc);
      }
      colRight.style.display = "";
      colDivider.style.display = "";
    } else if (hasRecent) {
      // Compact mode: all operational + collapsed recent list
      right += `<div class="sec-title">${msg("sectionIncidents")}</div>`;
      right += `<div class="no-incidents">
        <div class="no-inc-icon">\u2713</div>
        <div class="no-inc-title">${msg("allOperational")}</div>
        <div class="no-inc-sub">${msg("noActiveIncidents")}</div>
      </div>`;
      right += `<div class="recent-toggle">
        <span class="arrow">\u25BE</span>
        <span>${msg("recentIncidents")}</span>
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
              <span class="inc-status-badge" style="color:${C.green}">${msg("resolved")}</span>
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

  function renderError(errText) {
    colLeft.innerHTML = `<div class="error">${esc(errText)}<br><button class="retry-btn">${msg("retry")}</button></div>`;
    colRight.innerHTML = "";
    colLeft.querySelector(".retry-btn")?.addEventListener("click", () => requestStatus(true));
    badgeDot.style.background = C.gray;
    badgeText.textContent = msg("unavailable");
    headerDot.style.background = C.gray;
    headerDesc.textContent = msg("errorUnableToLoad");
  }

  // ── Footer time ticker ─────────────────────────────────────────────
  function updateFooterTime() {
    if (lastUpdatedAt) {
      updatedAtEl.textContent = msg("updatedPrefix") + timeAgo(lastUpdatedAt);
    }
  }
  tickTimer = setInterval(updateFooterTime, TICK_MS);

  // ── Data fetching ──────────────────────────────────────────────────
  // After the extension reloads/updates, this content script keeps running but
  // chrome.runtime is torn down: chrome.runtime.id goes undefined and
  // sendMessage throws synchronously. Guard for it and stop the timers so we
  // don't spam "Extension context invalidated" every poll.
  function contextValid() {
    return !!(chrome.runtime && chrome.runtime.id);
  }
  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
  function requestStatus(force = false) {
    if (!contextValid()) { stopTimers(); return; }
    try {
      chrome.runtime.sendMessage({ type: "GET_STATUS", force }, (res) => {
        if (chrome.runtime.lastError) {
          renderError(msg("errorBackground"));
          return;
        }
        if (res?.ok) render(res.data);
        else renderError(res?.error || msg("errorLoad"));
      });
    } catch (e) {
      stopTimers();
    }
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === "STATUS_UPDATE") render(m.data);
  });

  // ── Init ───────────────────────────────────────────────────────────
  loadSettings().then(() => {
    applySettings();
    refreshUI();
    requestStatus();
  });
  pollTimer = setInterval(requestStatus, POLL_MS);
})();
