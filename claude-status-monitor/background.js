const API_BASE = "https://status.claude.com/api/v2";
const CACHE_TTL = 25_000; // 25s – content script polls every 30s
const HISTORY_DAYS = 30;

let cache = null;
let lastFetch = 0;

// How far an incident's impact reaches on the uptime bars.
// A "monitoring" incident means a fix is deployed and service is effectively
// restored, so its impact should stop at monitoring_at — otherwise an incident
// parked in monitoring (e.g. a standing announcement) paints every day red up
// to "now". Still-investigating incidents bleed to the present, as they should.
function impactEnd(inc) {
  if (inc.resolved_at) return new Date(inc.resolved_at);
  if (inc.status === "monitoring" && inc.monitoring_at) return new Date(inc.monitoring_at);
  return new Date();
}

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
  const dayIncidents = {}; // comp.id -> [day0..dayN], each an array of incident ids
  for (const comp of summary.components) {
    history[comp.id] = new Array(HISTORY_DAYS).fill("operational");
    dayIncidents[comp.id] = Array.from({ length: HISTORY_DAYS }, () => []);
  }

  const SEVERITY = { operational: 0, none: 1, minor: 2, major: 3, critical: 4 };
  const referenced = new Set();

  for (const inc of allIncidents.incidents) {
    const start = new Date(inc.created_at);
    const end = impactEnd(inc);

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
          // Same span as the bar colour, so the popover and the bar agree on
          // which days an incident "happened" on (e.g. a parked monitoring
          // announcement is only listed on its publish day).
          dayIncidents[comp.id][d].push(inc.id);
          referenced.add(inc.id);
        }
      }
    }
  }

  // Trimmed incident detail for the per-day popover — only incidents that
  // actually touch a tracked component inside the window.
  const incidentsById = {};
  for (const inc of allIncidents.incidents) {
    if (!referenced.has(inc.id)) continue;
    incidentsById[inc.id] = {
      id: inc.id,
      name: inc.name,
      impact: inc.impact,
      status: inc.status,
      created_at: inc.created_at,
      resolved_at: inc.resolved_at,
      updates: (inc.incident_updates || []).map((u) => ({
        status: u.status,
        body: u.body,
        updated_at: u.updated_at,
      })),
    };
  }

  // Recent resolved incidents (for display when no active incidents)
  const recentIncidents = allIncidents.incidents
    .filter((inc) => inc.resolved_at)
    .slice(0, 5);

  cache = {
    status: summary.status,
    components: summary.components,
    incidents: unresolved.incidents,
    recentIncidents,
    history,
    dayIncidents,
    incidentsById,
    historyDays: HISTORY_DAYS,
    updated_at: summary.page.updated_at,
  };
  lastFetch = Date.now();
  return cache;
}

// Content script messaging
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_STATUS") {
    if (msg.force) lastFetch = 0; // bust cache on manual refresh
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
