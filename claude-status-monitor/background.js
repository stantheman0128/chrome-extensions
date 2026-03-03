const API_BASE = "https://status.claude.com/api/v2";
const POLL_INTERVAL_MINUTES = 1;

// Fetch status data from Statuspage API
async function fetchStatus() {
  const [summaryRes, unresolvedRes] = await Promise.all([
    fetch(`${API_BASE}/summary.json`),
    fetch(`${API_BASE}/incidents/unresolved.json`),
  ]);

  if (!summaryRes.ok || !unresolvedRes.ok) {
    throw new Error("Failed to fetch status data");
  }

  const summary = await summaryRes.json();
  const unresolved = await unresolvedRes.json();

  return {
    status: summary.status,
    components: summary.components,
    incidents: unresolved.incidents,
    updated_at: summary.page.updated_at,
  };
}

// Respond to content script requests
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_STATUS") {
    fetchStatus()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

// Set up periodic alarm to push updates to all matching tabs
chrome.alarms.create("poll-status", { periodInMinutes: POLL_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "poll-status") return;

  try {
    const data = await fetchStatus();
    const tabs = await chrome.tabs.query({ url: "*://claude.ai/*" });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "STATUS_UPDATE", data }).catch(() => {});
    }
  } catch {
    // silently ignore – content script will retry on its own
  }
});
