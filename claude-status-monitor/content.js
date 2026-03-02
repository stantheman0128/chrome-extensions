(() => {
  "use strict";

  // ── Helpers ────────────────────────────────────────────────────────
  const INDICATOR_COLORS = {
    none: "#22c55e",       // green
    minor: "#eab308",      // yellow
    major: "#f97316",      // orange
    critical: "#ef4444",   // red
    unknown: "#6b7280",    // gray
  };

  const COMPONENT_STATUS_LABEL = {
    operational: "正常運作",
    degraded_performance: "效能下降",
    partial_outage: "部分中斷",
    major_outage: "重大中斷",
    under_maintenance: "維護中",
  };

  const COMPONENT_STATUS_COLOR = {
    operational: "#22c55e",
    degraded_performance: "#eab308",
    partial_outage: "#f97316",
    major_outage: "#ef4444",
    under_maintenance: "#3b82f6",
  };

  const INCIDENT_IMPACT_COLOR = {
    none: "#22c55e",
    minor: "#eab308",
    major: "#f97316",
    critical: "#ef4444",
  };

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "剛剛";
    if (mins < 60) return `${mins} 分鐘前`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} 小時前`;
    return `${Math.floor(hrs / 24)} 天前`;
  }

  // ── Build widget inside Shadow DOM ─────────────────────────────────
  const host = document.createElement("div");
  host.id = "claude-status-monitor-host";
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = /* css */ `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :host {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #e2e8f0;
    }

    /* ── Badge (collapsed) ── */
    .badge {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 14px;
      border-radius: 20px;
      background: #1e293b;
      border: 1px solid #334155;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 4px 12px rgba(0,0,0,.35);
      transition: transform .15s, box-shadow .15s;
    }
    .badge:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,.45); }

    .dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: .5; }
    }

    .badge-label { white-space: nowrap; font-size: 12px; font-weight: 500; }

    /* ── Panel (expanded) ── */
    .panel {
      display: none;
      flex-direction: column;
      width: 340px;
      max-height: 480px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,.5);
      overflow: hidden;
    }
    .panel.open { display: flex; }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #1e293b;
    }
    .panel-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-title { font-weight: 600; font-size: 14px; }

    .close-btn {
      background: none; border: none; color: #94a3b8;
      cursor: pointer; font-size: 18px; line-height: 1;
      padding: 2px 4px; border-radius: 4px;
    }
    .close-btn:hover { color: #e2e8f0; background: #1e293b; }

    .panel-body {
      overflow-y: auto;
      padding: 12px 16px;
    }
    .panel-body::-webkit-scrollbar { width: 4px; }
    .panel-body::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: #64748b;
      margin-bottom: 8px;
    }
    .section-title:not(:first-child) { margin-top: 14px; }

    /* Components list */
    .comp-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 0;
    }
    .comp-name { font-size: 13px; }
    .comp-status {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
    }

    /* Incidents */
    .incident {
      padding: 8px 10px;
      border-radius: 8px;
      background: #1e293b;
      margin-bottom: 8px;
    }
    .incident-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .incident-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .incident-name { font-size: 13px; font-weight: 600; }
    .incident-update {
      font-size: 12px;
      color: #94a3b8;
      margin-left: 14px;
      margin-top: 2px;
    }
    .incident-time {
      font-size: 11px;
      color: #64748b;
      margin-left: 14px;
    }

    .no-incidents { font-size: 12px; color: #64748b; }

    /* Footer */
    .panel-footer {
      padding: 8px 16px;
      border-top: 1px solid #1e293b;
      font-size: 11px;
      color: #475569;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .panel-footer a {
      color: #60a5fa;
      text-decoration: none;
    }
    .panel-footer a:hover { text-decoration: underline; }

    /* Loading & error */
    .loading, .error {
      text-align: center;
      padding: 24px 16px;
      font-size: 13px;
    }
    .error { color: #f87171; }
    .retry-btn {
      margin-top: 8px;
      padding: 4px 12px;
      border-radius: 6px;
      border: 1px solid #334155;
      background: #1e293b;
      color: #e2e8f0;
      cursor: pointer;
      font-size: 12px;
    }
    .retry-btn:hover { background: #334155; }
  `;
  shadow.appendChild(style);

  // ── DOM structure ──────────────────────────────────────────────────
  const wrapper = document.createElement("div");

  // Badge
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.innerHTML = `<span class="dot"></span><span class="badge-label">載入中…</span>`;

  // Panel
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-header-left">
        <span class="dot" style="width:8px;height:8px;"></span>
        <span class="panel-title">Claude 服務狀態</span>
      </div>
      <button class="close-btn" title="關閉">✕</button>
    </div>
    <div class="panel-body"><div class="loading">載入中…</div></div>
    <div class="panel-footer">
      <span class="updated-at"></span>
      <a href="https://status.claude.com" target="_blank" rel="noopener">status.claude.com</a>
    </div>
  `;

  wrapper.appendChild(badge);
  wrapper.appendChild(panel);
  shadow.appendChild(wrapper);
  document.body.appendChild(host);

  // ── Interaction ────────────────────────────────────────────────────
  let panelOpen = false;

  badge.addEventListener("click", () => {
    panelOpen = !panelOpen;
    panel.classList.toggle("open", panelOpen);
    badge.style.display = panelOpen ? "none" : "flex";
  });

  panel.querySelector(".close-btn").addEventListener("click", () => {
    panelOpen = false;
    panel.classList.remove("open");
    badge.style.display = "flex";
  });

  // ── Rendering ──────────────────────────────────────────────────────
  function render(data) {
    const indicator = data.status?.indicator || "unknown";
    const color = INDICATOR_COLORS[indicator] || INDICATOR_COLORS.unknown;
    const description = data.status?.description || "Unknown";

    // Badge
    badge.querySelector(".dot").style.background = color;
    badge.querySelector(".badge-label").textContent = description;

    // Panel header dot
    panel.querySelector(".panel-header .dot").style.background = color;

    // Panel body
    const body = panel.querySelector(".panel-body");
    let html = "";

    // Components
    const components = (data.components || []).filter((c) => !c.group_id || c.group);
    if (components.length) {
      html += `<div class="section-title">服務元件</div>`;
      for (const c of components) {
        if (c.name === "Visit https://www.anthropicstatus.com for more information") continue;
        const sColor = COMPONENT_STATUS_COLOR[c.status] || "#6b7280";
        const sLabel = COMPONENT_STATUS_LABEL[c.status] || c.status;
        html += `
          <div class="comp-row">
            <span class="comp-name">${esc(c.name)}</span>
            <span class="comp-status" style="color:${sColor};background:${sColor}18">${sLabel}</span>
          </div>`;
      }
    }

    // Incidents
    html += `<div class="section-title">進行中的事件</div>`;
    if (data.incidents && data.incidents.length) {
      for (const inc of data.incidents) {
        const iColor = INCIDENT_IMPACT_COLOR[inc.impact] || "#6b7280";
        const latestUpdate = inc.incident_updates?.[0];
        html += `
          <div class="incident">
            <div class="incident-header">
              <span class="incident-dot" style="background:${iColor}"></span>
              <span class="incident-name">${esc(inc.name)}</span>
            </div>`;
        if (latestUpdate) {
          html += `
            <div class="incident-update">${esc(latestUpdate.body)}</div>
            <div class="incident-time">${timeAgo(latestUpdate.updated_at)}</div>`;
        }
        html += `</div>`;
      }
    } else {
      html += `<div class="no-incidents">目前沒有進行中的事件 🎉</div>`;
    }

    body.innerHTML = html;

    // Footer updated time
    if (data.updated_at) {
      panel.querySelector(".updated-at").textContent = `更新：${timeAgo(data.updated_at)}`;
    }
  }

  function renderError(msg) {
    const body = panel.querySelector(".panel-body");
    body.innerHTML = `
      <div class="error">
        ${esc(msg)}<br>
        <button class="retry-btn">重試</button>
      </div>`;
    body.querySelector(".retry-btn").addEventListener("click", requestStatus);

    badge.querySelector(".dot").style.background = INDICATOR_COLORS.unknown;
    badge.querySelector(".badge-label").textContent = "無法取得狀態";
  }

  function esc(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }

  // ── Data fetching via background service worker ────────────────────
  function requestStatus() {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
      if (chrome.runtime.lastError) {
        renderError("無法連線至擴充功能背景程式");
        return;
      }
      if (res?.ok) {
        render(res.data);
      } else {
        renderError(res?.error || "取得狀態失敗");
      }
    });
  }

  // Listen for pushed updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATUS_UPDATE") {
      render(msg.data);
    }
  });

  // Initial fetch
  requestStatus();
})();
