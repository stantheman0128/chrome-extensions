(() => {
  "use strict";

  const DAY = 86400000;
  const POLL_MS = 30_000;
  const TICK_MS = 15_000;
  const DEFAULT_DAYS = 30;

  const DEFAULTS = {
    badgeX: null, badgeY: null,
    panelW: 640, panelH: 470, colRightW: 270,
    fontSize: 14, locale: null, badgeScale: 1.0,
  };

  // ChatGPT light-mode palette (2025 monochrome). Status green is a generic
  // success green, deliberately not OpenAI's brand teal.
  const C = {
    bg: "#FFFFFF", surface: "#F7F7F8", elevated: "#ECECEC",
    border: "#E5E5E5", borderSub: "#D1D1D1",
    text: "#0D0D0D", textSec: "#5D5D5D", textMut: "#8E8EA0",
    accent: "#0D0D0D", green: "#16A34A",
    yellow: "#B7791F", orange: "#C2410C", red: "#DC2626", blue: "#2563EB", gray: "#8E8EA0",
    barOk: "#22C55E", barMinor: "#E0A800", barMajor: "#E8702A", barCrit: "#DC2626",
    barMaint: "#3B82F6", barEmpty: "#ECECEC",
  };

  const STRINGS = {
    en: {
      panelTitle: "ChatGPT Status", loading: "Loading…", close: "Close",
      refreshNow: "Refresh now", resetTitle: "Reset all settings to defaults", resetLabel: "↺ Reset",
      footerLink: "status.openai.com ↗", fontLabel: "A",
      allOperational: "All Systems Operational", degraded: "Degraded Performance",
      partialOutage: "Partial Outage", majorOutage: "Major Outage", maintenance: "Maintenance",
      sectionActive: "Current Incidents", sectionHistory: "Past Incidents",
      noActiveTitle: "All Systems Operational", noActiveSub: "No active incidents",
      noHistory: "No incidents in this period", uptime: "uptime",
      barNoIncidents: "No incidents", barMinor: "Degraded", barMajor: "Partial outage",
      barCritical: "Major outage", barMaint: "Maintenance",
      prevWindow: "Earlier", nextWindow: "Later",
      incInvestigating: "Investigating", incIdentified: "Identified", incMonitoring: "Monitoring",
      incUpdate: "Update", incResolved: "Resolved", incPostmortem: "Postmortem",
      previousUpdate: "$1 previous update", previousUpdates: "$1 previous updates", collapse: "Collapse",
      timeJustNow: "just now", timeMinAgo: "$1m ago", timeHourAgo: "$1h ago", timeDayAgo: "$1d ago",
      errorBackground: "Cannot reach extension background", errorLoad: "Failed to load status",
      unavailable: "Unavailable", retry: "Retry", updatedPrefix: "Updated ",
      dateLocale: "en-US",
    },
    zh_TW: {
      panelTitle: "ChatGPT 服務狀態", loading: "載入中…", close: "關閉",
      refreshNow: "立即重新整理", resetTitle: "重設所有設定為預設值", resetLabel: "↺ 重設",
      footerLink: "status.openai.com ↗", fontLabel: "A",
      allOperational: "所有系統正常運作", degraded: "效能降低",
      partialOutage: "部分中斷", majorOutage: "重大中斷", maintenance: "維護中",
      sectionActive: "進行中的事件", sectionHistory: "歷史事件",
      noActiveTitle: "所有系統正常運作", noActiveSub: "目前無進行中的事件",
      noHistory: "這段期間沒有事件", uptime: "正常運行",
      barNoIncidents: "無事件", barMinor: "效能降低", barMajor: "部分中斷",
      barCritical: "重大中斷", barMaint: "維護中",
      prevWindow: "更早", nextWindow: "更晚",
      incInvestigating: "調查中", incIdentified: "已確認", incMonitoring: "監控中",
      incUpdate: "更新", incResolved: "已解決", incPostmortem: "事後分析",
      previousUpdate: "$1 則先前更新", previousUpdates: "$1 則先前更新", collapse: "收合",
      timeJustNow: "剛剛", timeMinAgo: "$1 分鐘前", timeHourAgo: "$1 小時前", timeDayAgo: "$1 天前",
      errorBackground: "無法連線至擴充功能背景程式", errorLoad: "無法載入狀態",
      unavailable: "無法使用", retry: "重試", updatedPrefix: "更新於 ",
      dateLocale: "zh-TW",
    },
  };

  function getLocale() {
    if (settings.locale) return settings.locale;
    try { if (chrome.i18n.getUILanguage().startsWith("zh")) return "zh_TW"; } catch (e) {}
    return "en";
  }
  function msg(k) { const l = getLocale(); return STRINGS[l]?.[k] || STRINGS.en[k] || k; }

  const INDICATOR_COLOR = { none: C.green, minor: C.yellow, major: C.orange, critical: C.red, unknown: C.gray };
  const INDICATOR_DESC = { none: "allOperational", minor: "degraded", major: "partialOutage", critical: "majorOutage" };
  const BAR_COLOR = { operational: C.barOk, minor: C.barMinor, major: C.barMajor, critical: C.barCrit, maintenance: C.barMaint };
  const BAR_LABEL = { operational: "barNoIncidents", minor: "barMinor", major: "barMajor", critical: "barCritical", maintenance: "barMaint" };
  const DOT_COLOR = { operational: C.green, minor: C.yellow, major: C.orange, critical: C.red, maintenance: C.blue };
  const UPDATE_COLOR = { investigating: C.orange, identified: C.yellow, monitoring: C.blue, update: C.textSec, resolved: C.green, postmortem: C.textMut };
  const INC_STATUS_KEY = { investigating: "incInvestigating", identified: "incIdentified", monitoring: "incMonitoring", update: "incUpdate", resolved: "incResolved", postmortem: "incPostmortem" };

  function timeAgo(iso) {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return msg("timeJustNow");
    if (m < 60) return msg("timeMinAgo").replace("$1", m);
    const h = Math.floor(m / 60);
    if (h < 24) return msg("timeHourAgo").replace("$1", h);
    return msg("timeDayAgo").replace("$1", Math.floor(h / 24));
  }
  function fmtDay(ms) { return new Date(ms).toLocaleDateString(msg("dateLocale"), { month: "short", day: "numeric" }); }
  function fmtMonthYear(ms) { return new Date(ms).toLocaleDateString(msg("dateLocale"), { month: "short", year: "numeric" }); }
  function esc(s) { const e = document.createElement("span"); e.textContent = s == null ? "" : s; return e.innerHTML; }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function incLabel(s) { return INC_STATUS_KEY[s] ? msg(INC_STATUS_KEY[s]) : capitalize(s); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function compCount(n) { return getLocale() === "en" ? n + " component" + (n === 1 ? "" : "s") : n + " 個服務"; }

  // ── settings ────────────────────────────────────────────────────
  let settings = { ...DEFAULTS };
  function loadSettings() {
    return new Promise((res) => {
      chrome.storage.local.get("csgm_settings", (r) => {
        if (r.csgm_settings) settings = { ...DEFAULTS, ...r.csgm_settings };
        res();
      });
    });
  }
  function saveSettings() { chrome.storage.local.set({ csgm_settings: settings }); }
  function resetSettings() { settings = { ...DEFAULTS }; chrome.storage.local.remove("csgm_settings"); applySettings(); refreshUI(); }
  function applySettings() {
    if (settings.badgeX !== null && settings.badgeY !== null) {
      host.style.right = "auto"; host.style.bottom = "auto";
      host.style.left = clamp(settings.badgeX, 0, window.innerWidth - 60) + "px";
      host.style.top = clamp(settings.badgeY, 0, window.innerHeight - 30) + "px";
    } else { host.style.right = "16px"; host.style.bottom = "16px"; host.style.left = "auto"; host.style.top = "auto"; }
    panel.style.width = settings.panelW + "px";
    panel.style.height = settings.panelH + "px";
    colRight.style.width = settings.colRightW + "px";
    host.style.fontSize = settings.fontSize + "px";
    if (fontSlider) fontSlider.value = settings.fontSize;
    if (fontLabel) fontLabel.textContent = settings.fontSize + "px";
    badge.style.transform = `scale(${settings.badgeScale})`;
    updateLayout();
  }

  // ── shadow DOM ──────────────────────────────────────────────────
  const host = document.createElement("div");
  host.id = "chatgpt-status-ext";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :host{position:fixed;bottom:16px;right:16px;z-index:2147483647;
      font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;
      font-size:14px;line-height:1.5;color:${C.text};pointer-events:none}
    .wrap{position:relative}
    .badge{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;background:${C.bg};
      border:1px solid ${C.border};cursor:grab;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.08);pointer-events:auto;
      transition:opacity .18s,background .12s,box-shadow .12s;transform-origin:center}
    .badge:hover{background:${C.surface};box-shadow:0 4px 14px rgba(0,0,0,.12)}
    .badge.dragging{cursor:grabbing}.badge.resize-cursor{cursor:nwse-resize !important}
    .badge.hide{opacity:0;transform:scale(.85);pointer-events:none}
    .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .dot.pulse{animation:pulse 2s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
    .badge-text{font-size:13px;font-weight:500;color:${C.textSec};white-space:nowrap}

    .panel{position:fixed;width:640px;max-width:calc(100vw - 16px);height:470px;max-height:calc(100vh - 16px);
      min-width:300px;min-height:260px;background:${C.bg};border:1px solid ${C.border};border-radius:14px;
      box-shadow:0 8px 32px rgba(0,0,0,.12);display:flex;flex-direction:column;overflow:hidden;pointer-events:none;
      visibility:hidden;opacity:0;transform:scale(.96);
      transition:visibility 0s .22s,opacity .22s ease,transform .22s cubic-bezier(.16,1,.3,1)}
    .panel.open{visibility:visible;opacity:1;transform:scale(1);pointer-events:auto;transition-delay:0s}

    .resize-handle{position:absolute;z-index:10}
    .resize-n{top:-4px;left:14px;right:14px;height:8px;cursor:n-resize}.resize-s{bottom:-4px;left:14px;right:14px;height:8px;cursor:s-resize}
    .resize-w{left:-4px;top:14px;bottom:14px;width:8px;cursor:w-resize}.resize-e{right:-4px;top:14px;bottom:14px;width:8px;cursor:e-resize}
    .resize-nw{top:-4px;left:-4px;width:14px;height:14px;cursor:nw-resize}.resize-ne{top:-4px;right:-4px;width:14px;height:14px;cursor:ne-resize}
    .resize-sw{bottom:-4px;left:-4px;width:14px;height:14px;cursor:sw-resize}.resize-se{bottom:-4px;right:-4px;width:14px;height:14px;cursor:se-resize}

    .p-header{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid ${C.border};
      background:${C.surface};cursor:grab;user-select:none;border-radius:14px 14px 0 0}
    .p-header.dragging{cursor:grabbing}.p-header .dot{width:10px;height:10px}
    .p-header-info{flex:1;min-width:0}.p-title{font-weight:600;font-size:1.07em}
    .p-desc{font-size:.93em;color:${C.textSec};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .header-controls{display:flex;align-items:center;gap:8px;flex-shrink:0}
    .font-control{display:flex;align-items:center;gap:4px;font-size:11px;color:${C.textMut}}
    .font-slider{width:60px;height:3px;-webkit-appearance:none;appearance:none;background:${C.border};border-radius:2px;outline:none;cursor:pointer}
    .font-slider::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:${C.accent};cursor:pointer;border:none}
    .font-label{min-width:30px;text-align:center}
    .close-btn{background:none;border:none;color:${C.textMut};cursor:pointer;font-size:18px;line-height:1;padding:4px 6px;border-radius:6px;transition:all .1s}
    .close-btn:hover{color:${C.text};background:${C.elevated}}

    .daterange{display:flex;align-items:center;justify-content:center;gap:14px;padding:8px 16px;border-bottom:1px solid ${C.border};background:${C.bg}}
    .nav-btn{background:none;border:1px solid ${C.border};color:${C.textSec};width:24px;height:24px;border-radius:7px;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1;transition:all .12s}
    .nav-btn:hover:not(:disabled){background:${C.elevated};color:${C.text}}
    .nav-btn:disabled{opacity:.35;cursor:default}
    .range-label{font-size:.88em;font-weight:600;color:${C.text};min-width:150px;text-align:center}

    .p-body{flex:1;display:flex;overflow:hidden;min-height:0}
    .p-body.stacked{flex-direction:column-reverse}
    .col{overflow-y:auto;padding:12px 14px}
    .col::-webkit-scrollbar{width:4px}.col::-webkit-scrollbar-thumb{background:${C.borderSub};border-radius:2px}
    .col-left{flex:1;min-width:0}.col-right{width:270px;flex-shrink:0}
    .col-divider{width:5px;flex-shrink:0;cursor:col-resize;position:relative;background:transparent;transition:background .15s}
    .col-divider::after{content:'';position:absolute;top:0;bottom:0;left:2px;width:1px;background:${C.border}}
    .col-divider:hover,.col-divider.active{background:${C.accent}1A}
    .col-divider:hover::after,.col-divider.active::after{background:${C.accent}}
    .p-body.stacked .col-divider{display:none}
    .p-body.stacked .col-left{border-top:1px solid ${C.border}}
    .p-body.stacked .col-right{width:auto;flex-shrink:1}

    .sec-title{font-size:.78em;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:${C.textMut};margin-bottom:9px}
    .sec-title.spaced{margin-top:18px}

    /* groups (left) */
    .group{border-bottom:1px solid ${C.border};padding:9px 0}
    .group:last-child{border-bottom:none}
    .grp-head{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
    .gdot{width:14px;height:14px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700}
    .grp-name{font-size:.95em;font-weight:600}
    .grp-meta{font-size:.82em;color:${C.textMut};display:inline-flex;align-items:center;gap:3px}
    .grp-meta .caret{display:inline-block;font-size:9px;transition:transform .25s ease}
    .group.open .grp-meta .caret{transform:rotate(180deg)}
    .grp-spacer{flex:1}.grp-uptime{font-size:.82em;color:${C.textMut};white-space:nowrap}
    .bars{display:flex;gap:2px;height:28px;margin-top:7px}
    .bar{flex:1;min-width:0;border-radius:2px;cursor:default;transition:opacity .1s}.bar:hover{opacity:.55}
    .grp-agg{overflow:hidden;transition:max-height .28s ease,opacity .2s ease;max-height:60px;opacity:1}
    .group.open .grp-agg{max-height:0;opacity:0;margin:0}
    .grp-children{max-height:0;overflow:hidden;transition:max-height .28s ease}
    .comp{padding:7px 0 3px 22px}
    .comp-head{display:flex;align-items:center;gap:8px}
    .comp-name{font-size:.88em;font-weight:500}.comp-spacer{flex:1}
    .comp-uptime{font-size:.79em;color:${C.textMut};white-space:nowrap}
    .comp .bars{height:20px;margin-top:5px}

    /* incidents (right) */
    .incident{background:${C.bg};border:1px solid ${C.border};border-radius:10px;margin-bottom:9px;overflow:hidden}
    .inc-top{padding:11px 13px;cursor:pointer;transition:background .1s}.inc-top:hover{background:${C.surface}}
    .inc-header{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px}
    .inc-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:3px}
    .inc-name{font-size:.92em;font-weight:600;line-height:1.35}
    .inc-status-line{display:flex;align-items:center;flex-wrap:wrap;gap:8px;row-gap:3px;margin-bottom:4px}
    .inc-badge{font-size:.78em;font-weight:600;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap}
    .inc-time{font-size:.78em;color:${C.textMut};white-space:nowrap}
    .inc-body{font-size:.86em;color:${C.textSec};line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .incident.expanded .inc-body{-webkit-line-clamp:unset}
    .inc-toggle{display:flex;align-items:center;gap:5px;padding:5px 13px 7px;font-size:.78em;color:${C.accent};cursor:pointer}
    .inc-toggle:hover{text-decoration:underline}.inc-toggle .arrow{display:inline-block;transition:transform .2s;font-size:9px}
    .incident.expanded .inc-toggle .arrow{transform:rotate(180deg)}
    .when-exp{display:none}.incident.expanded .when-col{display:none}.incident.expanded .when-exp{display:inline}
    .inc-timeline{max-height:0;overflow:hidden;transition:max-height .3s ease-out}
    .inc-tl-inner{margin:2px 13px 10px 17px;border-left:2px solid ${C.border};padding-left:13px}
    .inc-upd{position:relative;margin-bottom:11px}.inc-upd:last-child{margin-bottom:0}
    .tl-dot{position:absolute;left:-18px;top:5px;width:8px;height:8px;border-radius:50%}
    .inc-upd .inc-body{-webkit-line-clamp:unset}
    .no-incidents{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:22px 12px 14px;color:${C.textMut}}
    .no-inc-icon{width:36px;height:36px;border-radius:50%;background:${C.green}18;color:${C.green};display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:8px}
    .no-inc-title{font-size:1em;font-weight:600;color:${C.textSec}}.no-inc-sub{font-size:.86em;margin-top:2px}

    /* history (right) */
    .hist-row{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid ${C.border};cursor:pointer}
    .hist-row:last-child{border-bottom:none}.hist-row:hover{background:${C.surface}}
    .hist-date{font-size:.79em;color:${C.textMut};white-space:nowrap;flex-shrink:0}
    .hist-name{font-size:.86em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .hist-badge{font-size:.73em;font-weight:600;text-transform:uppercase;white-space:nowrap;flex-shrink:0}
    .hist-empty{font-size:.86em;color:${C.textMut};padding:6px 0}

    .p-footer{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid ${C.border};
      font-size:.86em;color:${C.textMut};background:${C.surface};border-radius:0 0 14px 14px}
    .p-footer-left{display:flex;align-items:center;gap:6px;flex:1}
    .refresh-btn{background:none;border:none;color:${C.textMut};cursor:pointer;font-size:15px;padding:2px;border-radius:4px;transition:all .1s;display:inline-flex}
    .refresh-btn:hover{color:${C.text};background:${C.elevated}}
    .refresh-btn.spinning{animation:spin .6s ease}@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
    .reset-btn,.lang-btn{display:inline-flex;align-items:center;gap:4px;background:${C.bg};border:1px solid ${C.border};
      color:${C.textSec};cursor:pointer;font-size:.79em;font-weight:500;padding:4px 10px;border-radius:8px;transition:all .15s;white-space:nowrap}
    .reset-btn:hover,.lang-btn:hover{color:${C.text};background:${C.elevated};border-color:${C.borderSub}}
    .footer-link{color:${C.accent};text-decoration:none;font-weight:500;font-size:.86em;padding:4px 10px;border-radius:8px;transition:all .15s;white-space:nowrap}
    .footer-link:hover{background:${C.elevated}}

    .tooltip{position:fixed;pointer-events:none;padding:6px 10px;border-radius:6px;background:${C.bg};border:1px solid ${C.borderSub};
      font-size:.86em;line-height:1.4;white-space:nowrap;opacity:0;transition:opacity .1s;transform:translate(-50%,-100%);box-shadow:0 3px 10px rgba(0,0,0,.1)}
    .tooltip.show{opacity:1}.tooltip-date{font-weight:600;color:${C.text}}.tooltip-status{color:${C.textSec}}

    .loading,.error{display:flex;align-items:center;justify-content:center;height:100%;text-align:center;font-size:.93em;color:${C.textMut};padding:24px}
    .error{color:${C.red};flex-direction:column}
    .retry-btn{margin-top:10px;padding:5px 14px;border-radius:8px;border:1px solid ${C.border};background:${C.bg};color:${C.text};cursor:pointer;font-size:.86em}
    .retry-btn:hover{background:${C.elevated}}
  `;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="resize-handle resize-n"></div><div class="resize-handle resize-s"></div>
    <div class="resize-handle resize-w"></div><div class="resize-handle resize-e"></div>
    <div class="resize-handle resize-nw"></div><div class="resize-handle resize-ne"></div>
    <div class="resize-handle resize-sw"></div><div class="resize-handle resize-se"></div>
    <div class="p-header">
      <span class="dot pulse" style="background:${C.gray}"></span>
      <div class="p-header-info"><div class="p-title">${msg("panelTitle")}</div><div class="p-desc">${msg("loading")}</div></div>
      <div class="header-controls">
        <div class="font-control"><label>${msg("fontLabel")}</label>
          <input type="range" class="font-slider" min="10" max="20" value="14" step="1"><span class="font-label">14px</span></div>
        <button class="close-btn" title="${msg("close")}">&#x2715;</button>
      </div>
    </div>
    <div class="daterange">
      <button class="nav-btn nav-prev" title="${msg("prevWindow")}">&#x2039;</button>
      <span class="range-label"></span>
      <button class="nav-btn nav-next" title="${msg("nextWindow")}">&#x203A;</button>
    </div>
    <div class="p-body">
      <div class="col col-left"><div class="loading">${msg("loading")}</div></div>
      <div class="col-divider"></div>
      <div class="col col-right"><div class="loading">${msg("loading")}</div></div>
    </div>
    <div class="p-footer">
      <div class="p-footer-left"><span class="updated-at"></span>
        <button class="refresh-btn" title="${msg("refreshNow")}">&#x21BB;</button></div>
      <button class="reset-btn" title="${msg("resetTitle")}">${msg("resetLabel")}</button>
      <button class="lang-btn">${getLocale() === "en" ? "中文" : "EN"}</button>
      <a class="footer-link" href="https://status.openai.com" target="_blank" rel="noopener">${msg("footerLink")}</a>
    </div>`;

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.innerHTML = `<span class="dot pulse" style="background:${C.gray}"></span><span class="badge-text">${msg("loading")}</span>`;
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";

  wrap.appendChild(badge); wrap.appendChild(tooltip);
  shadow.appendChild(panel); shadow.appendChild(wrap);
  document.body.appendChild(host);

  const badgeDot = badge.querySelector(".dot");
  const badgeText = badge.querySelector(".badge-text");
  const pHeader = panel.querySelector(".p-header");
  const headerDot = panel.querySelector(".p-header .dot");
  const headerDesc = panel.querySelector(".p-desc");
  const colLeft = panel.querySelector(".col-left");
  const colDivider = panel.querySelector(".col-divider");
  const colRight = panel.querySelector(".col-right");
  const pBody = panel.querySelector(".p-body");
  const rangeLabel = panel.querySelector(".range-label");
  const navPrev = panel.querySelector(".nav-prev");
  const navNext = panel.querySelector(".nav-next");
  const updatedAtEl = panel.querySelector(".updated-at");
  const refreshBtn = panel.querySelector(".refresh-btn");
  const resetBtn = panel.querySelector(".reset-btn");
  const langBtn = panel.querySelector(".lang-btn");
  const fontSlider = panel.querySelector(".font-slider");
  const fontLabel = panel.querySelector(".font-label");

  // ── state ───────────────────────────────────────────────────────
  let panelOpen = false, panelWasDragged = false;
  let lastUpdatedAt = null, lastData = null;
  let badgeResizeState = null, pollTimer = null, tickTimer = null;
  let rangeEnd = endOfToday(), rangeDays = DEFAULT_DAYS;
  const expandedGroups = new Set();
  const expandedIncidents = new Set();

  function endOfToday() { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }
  function rangeStart() { return rangeEnd - rangeDays * DAY; }

  function positionPanel() {
    const r = badge.getBoundingClientRect();
    const bCx = r.left + r.width / 2, bCy = r.top + r.height / 2;
    const vw = window.innerWidth, vh = window.innerHeight, pw = settings.panelW, ph = settings.panelH, gap = 8, m = 8;
    let left = clamp(bCx - pw / 2, m, vw - pw - m);
    let top = bCy > vh / 2 ? r.top - gap - ph : r.bottom + gap;
    top = clamp(top, m, vh - ph - m);
    panel.style.left = left + "px"; panel.style.top = top + "px";
    panel.style.transformOrigin = `${Math.round(clamp((bCx - left) / pw * 100, 0, 100))}% ${Math.round(clamp((bCy - top) / ph * 100, 0, 100))}%`;
  }
  function openPanel() { panelOpen = true; panelWasDragged = false; positionPanel(); panel.classList.add("open"); badge.classList.add("hide"); updateLayout(); }
  function closePanel() {
    if (!panelOpen) return;
    if (panelWasDragged) {
      const pr = panel.getBoundingClientRect(), bw = badge.offsetWidth || 120, bh = badge.offsetHeight || 32;
      const nx = clamp(pr.left + pr.width / 2 - bw / 2, 0, window.innerWidth - bw);
      const ny = clamp(pr.top + pr.height / 2 - bh / 2, 0, window.innerHeight - bh);
      host.style.left = nx + "px"; host.style.top = ny + "px"; host.style.right = "auto"; host.style.bottom = "auto";
      settings.badgeX = nx; settings.badgeY = ny; saveSettings();
    }
    panelWasDragged = false; panelOpen = false; panel.classList.remove("open"); badge.classList.remove("hide"); hideTooltip();
  }
  badge.addEventListener("click", () => { if (badge._wasDragged) { badge._wasDragged = false; return; } openPanel(); });
  panel.querySelector(".close-btn").addEventListener("click", closePanel);
  document.addEventListener("pointerdown", (e) => {
    if (!panelOpen) return;
    if (panel.contains(e.composedPath()[0])) return;
    if (host.contains(e.target) || e.target === host) return;
    closePanel();
  });
  wrap.addEventListener("pointerdown", () => { if (panelOpen) closePanel(); });
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());

  // ── draggable / resizable badge ─────────────────────────────────
  let dragState = null;
  badge.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = badge.getBoundingClientRect(), t = 8;
    const edge = e.clientX - r.left < t || r.right - e.clientX < t || e.clientY - r.top < t || r.bottom - e.clientY < t;
    if (edge) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      badgeResizeState = { startDist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, startScale: settings.badgeScale, cx, cy };
      badge.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    const hr = host.getBoundingClientRect();
    dragState = { mx: e.clientX, my: e.clientY, x: hr.left, y: hr.top, moved: false };
    badge.classList.add("dragging"); badge.setPointerCapture(e.pointerId); e.preventDefault();
  });
  badge.addEventListener("pointermove", (e) => {
    if (badgeResizeState) {
      const d = Math.hypot(e.clientX - badgeResizeState.cx, e.clientY - badgeResizeState.cy);
      settings.badgeScale = clamp(badgeResizeState.startScale * (d / badgeResizeState.startDist), 0.5, 2.5);
      badge.style.transform = `scale(${settings.badgeScale})`; badge._wasDragged = true; return;
    }
    if (!dragState) return;
    const dx = e.clientX - dragState.mx, dy = e.clientY - dragState.my;
    if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    dragState.moved = true;
    host.style.left = clamp(dragState.x + dx, 0, window.innerWidth - 60) + "px";
    host.style.top = clamp(dragState.y + dy, 0, window.innerHeight - 30) + "px";
    host.style.right = "auto"; host.style.bottom = "auto";
  });
  badge.addEventListener("pointerup", () => {
    if (badgeResizeState) { badgeResizeState = null; saveSettings(); return; }
    if (!dragState) return;
    badge.classList.remove("dragging");
    if (dragState.moved) { badge._wasDragged = true; const r = host.getBoundingClientRect(); settings.badgeX = r.left; settings.badgeY = r.top; saveSettings(); }
    dragState = null;
  });
  badge.addEventListener("mousemove", (e) => {
    if (dragState || badgeResizeState) return;
    const r = badge.getBoundingClientRect(), t = 8;
    badge.classList.toggle("resize-cursor", e.clientX - r.left < t || r.right - e.clientX < t || e.clientY - r.top < t || r.bottom - e.clientY < t);
  });
  badge.addEventListener("mouseleave", () => badge.classList.remove("resize-cursor"));

  // ── draggable panel ─────────────────────────────────────────────
  let pds = null;
  pHeader.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".close-btn,.font-control,button,input")) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    pds = { mx: e.clientX, my: e.clientY, l: r.left, t: r.top };
    pHeader.classList.add("dragging"); pHeader.setPointerCapture(e.pointerId);
  });
  pHeader.addEventListener("pointermove", (e) => {
    if (!pds) return;
    panelWasDragged = true;
    panel.style.left = clamp(pds.l + e.clientX - pds.mx, 0, window.innerWidth - panel.offsetWidth) + "px";
    panel.style.top = clamp(pds.t + e.clientY - pds.my, 0, window.innerHeight - panel.offsetHeight) + "px";
  });
  pHeader.addEventListener("pointerup", () => { if (pds) { pds = null; pHeader.classList.remove("dragging"); } });

  // ── resizable panel ─────────────────────────────────────────────
  let rs = null;
  function startResize(e, dir) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r = panel.getBoundingClientRect();
    rs = { dir, x: e.clientX, y: e.clientY, w: r.width, h: r.height, l: r.left, t: r.top };
    document.addEventListener("pointermove", onResizeMove, true);
    document.addEventListener("pointerup", onResizeEnd, true);
  }
  function onResizeMove(e) {
    if (!rs) return;
    const dx = e.clientX - rs.x, dy = e.clientY - rs.y, maxW = window.innerWidth - 16, maxH = window.innerHeight - 16;
    if (rs.dir.includes("n")) { const h = clamp(rs.h - dy, 260, maxH); panel.style.height = h + "px"; panel.style.top = Math.max(0, rs.t + rs.h - h) + "px"; settings.panelH = h; }
    if (rs.dir.includes("s")) { const h = clamp(rs.h + dy, 260, maxH); panel.style.height = h + "px"; settings.panelH = h; }
    if (rs.dir.includes("w")) { const w = clamp(rs.w - dx, 300, maxW); panel.style.width = w + "px"; panel.style.left = Math.max(0, rs.l + rs.w - w) + "px"; settings.panelW = w; }
    if (rs.dir.includes("e")) { const w = clamp(rs.w + dx, 300, maxW); panel.style.width = w + "px"; settings.panelW = w; }
    updateLayout();
  }
  function onResizeEnd() {
    if (!rs) return;
    rs = null;
    document.removeEventListener("pointermove", onResizeMove, true);
    document.removeEventListener("pointerup", onResizeEnd, true);
    saveSettings();
  }
  for (const dir of ["n", "s", "w", "e", "nw", "ne", "sw", "se"]) panel.querySelector(`.resize-${dir}`).addEventListener("pointerdown", (e) => startResize(e, dir));

  // ── column divider ──────────────────────────────────────────────
  let dvs = null;
  colDivider.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    dvs = { x: e.clientX, w: colRight.offsetWidth };
    colDivider.classList.add("active"); colDivider.setPointerCapture(e.pointerId);
  });
  colDivider.addEventListener("pointermove", (e) => {
    if (!dvs) return;
    const w = clamp(dvs.w - (e.clientX - dvs.x), 150, panel.offsetWidth - 220);
    colRight.style.width = w + "px"; settings.colRightW = w;
  });
  colDivider.addEventListener("pointerup", () => { if (dvs) { dvs = null; colDivider.classList.remove("active"); saveSettings(); } });

  function updateLayout() {
    const w = parseInt(panel.style.width) || settings.panelW;
    pBody.classList.toggle("stacked", w < 480);
  }

  // ── controls ────────────────────────────────────────────────────
  fontSlider.addEventListener("input", (e) => { const s = parseInt(e.target.value); settings.fontSize = s; host.style.fontSize = s + "px"; fontLabel.textContent = s + "px"; });
  fontSlider.addEventListener("change", saveSettings);
  resetBtn.addEventListener("click", (e) => { e.stopPropagation(); resetSettings(); });
  langBtn.addEventListener("click", (e) => { e.stopPropagation(); settings.locale = getLocale() === "en" ? "zh_TW" : "en"; saveSettings(); refreshUI(); });
  refreshBtn.addEventListener("click", (e) => { e.stopPropagation(); refreshBtn.classList.remove("spinning"); void refreshBtn.offsetWidth; refreshBtn.classList.add("spinning"); requestStatus(true); });
  navPrev.addEventListener("click", (e) => { e.stopPropagation(); rangeEnd -= rangeDays * DAY; requestStatus(true); });
  navNext.addEventListener("click", (e) => { e.stopPropagation(); rangeEnd = Math.min(endOfToday(), rangeEnd + rangeDays * DAY); requestStatus(true); });

  function refreshUI() {
    panel.querySelector(".p-title").textContent = msg("panelTitle");
    panel.querySelector(".close-btn").title = msg("close");
    panel.querySelector(".font-control label").textContent = msg("fontLabel");
    refreshBtn.title = msg("refreshNow"); resetBtn.title = msg("resetTitle"); resetBtn.textContent = msg("resetLabel");
    navPrev.title = msg("prevWindow"); navNext.title = msg("nextWindow");
    langBtn.textContent = getLocale() === "en" ? "中文" : "EN";
    panel.querySelector(".footer-link").textContent = msg("footerLink");
    updateFooterTime();
    if (lastData) render(lastData);
  }

  // ── bar tooltip ─────────────────────────────────────────────────
  function showTooltip(barEl) {
    const ms = +barEl.dataset.ms, st = barEl.dataset.status;
    tooltip.innerHTML = `<span class="tooltip-date">${esc(fmtDay(ms))}</span><br><span class="tooltip-status" style="color:${BAR_COLOR[st] || C.barEmpty}">${esc(msg(BAR_LABEL[st] || "barNoIncidents"))}</span>`;
    const r = barEl.getBoundingClientRect();
    tooltip.style.left = (r.left + r.width / 2) + "px"; tooltip.style.top = (r.top - 6) + "px";
    tooltip.classList.add("show");
  }
  function hideTooltip() { tooltip.classList.remove("show"); }
  colLeft.addEventListener("mouseover", (e) => { const b = e.target.closest(".bar"); if (b) showTooltip(b); });
  colLeft.addEventListener("mouseout", (e) => { if (e.target.closest(".bar")) hideTooltip(); });
  colLeft.addEventListener("scroll", hideTooltip);

  // ── group expand / collapse (animated) ──────────────────────────
  colLeft.addEventListener("click", (e) => {
    const head = e.target.closest(".grp-head");
    if (!head) return;
    const g = head.closest(".group"), gid = g.dataset.gid, kids = g.querySelector(".grp-children");
    if (expandedGroups.has(gid)) {
      expandedGroups.delete(gid);
      kids.style.maxHeight = kids.scrollHeight + "px";
      requestAnimationFrame(() => { kids.style.maxHeight = "0px"; g.classList.remove("open"); });
    } else {
      expandedGroups.add(gid);
      g.classList.add("open");
      kids.style.maxHeight = kids.scrollHeight + "px";
      const done = () => { if (expandedGroups.has(gid)) kids.style.maxHeight = "none"; kids.removeEventListener("transitionend", done); };
      kids.addEventListener("transitionend", done);
    }
  });

  // ── right column: incidents + history ───────────────────────────
  colRight.addEventListener("click", (e) => {
    const histRow = e.target.closest(".hist-row");
    if (histRow && histRow.dataset.permalink) { window.open(histRow.dataset.permalink, "_blank", "noopener"); return; }
    const tgl = e.target.closest(".inc-top,.inc-toggle");
    if (!tgl) return;
    const card = tgl.closest(".incident"), tl = card.querySelector(".inc-timeline"), id = card.dataset.id;
    if (!tl) return;
    if (card.classList.contains("expanded")) { card.classList.remove("expanded"); tl.style.maxHeight = "0"; expandedIncidents.delete(id); }
    else { card.classList.add("expanded"); tl.style.maxHeight = tl.scrollHeight + "px"; expandedIncidents.add(id); }
  });

  // ── render helpers ──────────────────────────────────────────────
  function barsHTML(history, startMs) {
    let h = '<div class="bars">';
    for (let i = 0; i < history.length; i++) {
      const st = history[i] || "operational";
      h += `<div class="bar" style="background:${BAR_COLOR[st] || C.barEmpty}" data-status="${st}" data-ms="${startMs + i * DAY}"></div>`;
    }
    return h + "</div>";
  }
  function incidentCard(inc) {
    const ic = INDICATOR_COLOR[inc.bucket] || C.gray;
    const latest = inc.latest, prev = (inc.updates || []).slice(1), exp = expandedIncidents.has(inc.id);
    let html = `<div class="incident${exp ? " expanded" : ""}" data-id="${esc(inc.id)}"><div class="inc-top">
      <div class="inc-header"><span class="inc-dot" style="background:${ic}"></span><span class="inc-name">${esc(inc.name)}</span></div>`;
    if (latest) {
      const sc = UPDATE_COLOR[latest.status] || C.textSec;
      html += `<div class="inc-status-line"><span class="inc-badge" style="color:${sc}">${esc(incLabel(latest.status))}</span>
        <span class="inc-time">${esc(timeAgo(latest.at))}</span></div><div class="inc-body">${esc(latest.text)}</div>`;
    }
    html += `</div>`;
    if (prev.length) {
      const t = prev.length === 1 ? msg("previousUpdate").replace("$1", 1) : msg("previousUpdates").replace("$1", prev.length);
      html += `<div class="inc-toggle"><span class="arrow">▾</span><span class="when-col">${esc(t)}</span><span class="when-exp">${msg("collapse")}</span></div>
        <div class="inc-timeline"${exp ? ' style="max-height:none"' : ""}><div class="inc-tl-inner">`;
      for (const u of prev) {
        const uc = UPDATE_COLOR[u.status] || C.textSec;
        html += `<div class="inc-upd"><span class="tl-dot" style="background:${uc}"></span>
          <div class="inc-status-line"><span class="inc-badge" style="color:${uc}">${esc(incLabel(u.status))}</span><span class="inc-time">${esc(timeAgo(u.at))}</span></div>
          <div class="inc-body">${esc(u.text)}</div></div>`;
      }
      html += `</div></div>`;
    }
    return html + `</div>`;
  }

  // ── render ──────────────────────────────────────────────────────
  function render(data) {
    lastData = data;
    hideTooltip();
    const ind = data.status?.indicator || "unknown";
    const iColor = INDICATOR_COLOR[ind] || C.gray;
    const desc = INDICATOR_DESC[ind] ? msg(INDICATOR_DESC[ind]) : (data.status?.description || msg("unavailable"));
    badgeDot.style.background = iColor; badgeText.textContent = desc; badgeDot.classList.toggle("pulse", ind !== "none");
    headerDot.style.background = iColor; headerDot.classList.toggle("pulse", ind !== "none"); headerDesc.textContent = desc;

    const startMs = data.range.startMs, endMs = data.range.endMs;
    rangeLabel.textContent = `${fmtDay(startMs)} - ${fmtDay(endMs)}`;
    navNext.disabled = endMs >= endOfToday() - DAY;
    navPrev.disabled = !!data.dataAvailableSince && startMs <= new Date(data.dataAvailableSince).getTime();

    // LEFT: grouped uptime bars
    let left = "";
    for (const g of data.groups || []) {
      const open = expandedGroups.has(g.id);
      const cur = g.current || "operational";
      const gc = DOT_COLOR[cur] || C.green;
      left += `<div class="group${open ? " open" : ""}" data-gid="${esc(g.id)}">
        <div class="grp-head">
          <span class="gdot" style="background:${gc}">${cur === "operational" ? "✓" : "!"}</span>
          <span class="grp-name">${esc(g.name)}</span>
          <span class="grp-meta">${esc(compCount(g.components.length))} <span class="caret">▾</span></span>
          <span class="grp-spacer"></span>
          <span class="grp-uptime">${g.uptime}% ${msg("uptime")}</span>
        </div>
        <div class="grp-agg">${barsHTML(g.history, startMs)}</div>
        <div class="grp-children"${open ? ' style="max-height:none"' : ""}>`;
      for (const c of g.components) {
        left += `<div class="comp"><div class="comp-head"><span class="comp-name">${esc(c.name)}</span>
          <span class="comp-spacer"></span><span class="comp-uptime">${c.uptime}% ${msg("uptime")}</span></div>${barsHTML(c.history, startMs)}</div>`;
      }
      left += `</div></div>`;
    }
    colLeft.innerHTML = left;

    // RIGHT: current incidents + past incidents (history)
    let right = "";
    if (data.activeIncidents?.length) {
      right += `<div class="sec-title">${msg("sectionActive")}</div>`;
      for (const inc of data.activeIncidents) right += incidentCard(inc);
    } else {
      right += `<div class="no-incidents"><div class="no-inc-icon">✓</div>
        <div class="no-inc-title">${msg("noActiveTitle")}</div><div class="no-inc-sub">${msg("noActiveSub")}</div></div>`;
    }
    right += `<div class="sec-title spaced">${msg("sectionHistory")}</div>`;
    if (data.history?.length) {
      for (const h of data.history.slice(0, 50)) {
        const col = h.status === "resolved" ? C.green : (UPDATE_COLOR[h.status] || C.textSec);
        right += `<div class="hist-row" data-permalink="${esc(h.permalink || "")}">
          <span class="hist-date">${esc(fmtDay(new Date(h.at).getTime()))}</span>
          <span class="hist-name">${esc(h.name)}</span>
          <span class="hist-badge" style="color:${col}">${esc(incLabel(h.status))}</span></div>`;
      }
    } else {
      right += `<div class="hist-empty">${msg("noHistory")}</div>`;
    }
    colRight.innerHTML = right;

    lastUpdatedAt = data.updated_at; updateFooterTime();
  }

  function renderError(t) {
    colLeft.innerHTML = `<div class="error">${esc(t)}<br><button class="retry-btn">${msg("retry")}</button></div>`;
    colRight.innerHTML = "";
    colLeft.querySelector(".retry-btn")?.addEventListener("click", () => requestStatus(true));
    badgeDot.style.background = C.gray; badgeText.textContent = msg("unavailable");
    headerDot.style.background = C.gray; headerDesc.textContent = msg("errorLoad");
  }

  function updateFooterTime() { if (lastUpdatedAt) updatedAtEl.textContent = msg("updatedPrefix") + timeAgo(lastUpdatedAt); }
  tickTimer = setInterval(updateFooterTime, TICK_MS);

  // ── data ────────────────────────────────────────────────────────
  function contextValid() { return !!(chrome.runtime && chrome.runtime.id); }
  function stopTimers() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
  function requestStatus(force = false) {
    if (!contextValid()) { stopTimers(); return; }
    try {
      chrome.runtime.sendMessage({ type: "GET_STATUS", startMs: rangeStart(), endMs: rangeEnd, force }, (res) => {
        if (chrome.runtime.lastError) { renderError(msg("errorBackground")); return; }
        if (res?.ok) render(res.data); else renderError(res?.error || msg("errorLoad"));
      });
    } catch (e) { stopTimers(); }
  }
  chrome.runtime.onMessage.addListener((m) => { if (m.type === "STATUS_UPDATE") render(m.data); });

  loadSettings().then(() => { applySettings(); refreshUI(); requestStatus(); });
  pollTimer = setInterval(requestStatus, POLL_MS);
})();
