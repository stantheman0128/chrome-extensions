const API_BASE = "https://status.claude.com/api/v2";
const CACHE_TTL = 25_000; // 25s – content script polls every 30s
const HISTORY_DAYS = 30;

let cache = null;
let lastFetch = 0;

async function fetchStatusData() {
  const now = Date.now();
  if (cache && now - lastFetch < CACHE_TTL) return cache;

  const [summaryRes, unresolvedRes, incidentsRes] = await Promise.all([
    fetch(`${API_BASE}/summary.json`),
    fetch(`${API_BASE}/incidents/unresolved.json`),
    fetch(`${API_BASE}/incidents.json`),
  ]);

  if (!summaryRes.ok || !unresolvedRes.ok || !incidentsRes.ok) {
    throw new Error("Failed to fetch status data");
  }

  const summary = await summaryRes.json();
  const unresolved = await unresolvedRes.json();
  const allIncidents = await incidentsRes.json();

  // Build per-component daily history for uptime bars
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const history = {};
  for (const comp of summary.components) {
    history[comp.id] = new Array(HISTORY_DAYS).fill("operational");
  }

  const SEVERITY = { operational: 0, none: 1, minor: 2, major: 3, critical: 4 };

  for (const inc of allIncidents.incidents) {
    const start = new Date(inc.created_at);
    const end = inc.resolved_at ? new Date(inc.resolved_at) : new Date();

    for (const comp of inc.components || []) {
      if (!history[comp.id]) continue;

      for (let d = 0; d < HISTORY_DAYS; d++) {
        const dayStart = new Date(today);
        dayStart.setDate(today.getDate() - (HISTORY_DAYS - 1 - d));
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        if (start < dayEnd && end >= dayStart) {
          const cur = history[comp.id][d];
          const impact = inc.impact || "none";
          if ((SEVERITY[impact] || 0) > (SEVERITY[cur] || 0)) {
            history[comp.id][d] = impact;
          }
        }
      }
    }
  }

  cache = {
    status: summary.status,
    components: summary.components,
    incidents: unresolved.incidents,
    history,
    historyDays: HISTORY_DAYS,
    updated_at: summary.page.updated_at,
  };
  lastFetch = Date.now();
  return cache;
}

// Content script messaging
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_STATUS") {
    fetchStatusData()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// Periodic push via alarm (backup – content script also polls)
chrome.alarms.create("poll-status", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "poll-status") return;
  try {
    const data = await fetchStatusData();
    const tabs = await chrome.tabs.query({ url: "*://claude.ai/*" });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "STATUS_UPDATE", data }).catch(() => {});
    }
  } catch {
    // content script will retry on its own
  }
});
