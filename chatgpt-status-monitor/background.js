// Fetches OpenAI's real status data from incident.io's proxy endpoints (the same
// source status.openai.com itself uses) and builds the grouped, per-component,
// date-ranged model via the shared model.js.
importScripts("model.js");

const PROXY = "https://status.openai.com/proxy/status.openai.com";
const CACHE_TTL = 25_000;

let mainCache = null;
let mainAt = 0;
const impactsCache = new Map(); // "startMs_endMs" -> { data, at }

async function getMain(force) {
  if (!force && mainCache && Date.now() - mainAt < CACHE_TTL) return mainCache;
  const res = await fetch(PROXY);
  if (!res.ok) throw new Error("Failed to fetch status");
  const json = await res.json();
  mainCache = json.summary;
  mainAt = Date.now();
  return mainCache;
}

async function getImpacts(startMs, endMs, force) {
  const key = startMs + "_" + endMs;
  const hit = impactsCache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  const url = `${PROXY}/component_impacts?start_at=${new Date(startMs).toISOString()}&end_at=${new Date(endMs).toISOString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch history");
  const data = await res.json();
  impactsCache.set(key, { data, at: Date.now() });
  if (impactsCache.size > 12) impactsCache.delete(impactsCache.keys().next().value);
  return data;
}

async function build(startMs, endMs, force) {
  const [summary, impacts] = await Promise.all([getMain(force), getImpacts(startMs, endMs, force)]);
  return buildStatusModel(summary, impacts, startMs, endMs);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_STATUS") {
    build(msg.startMs, msg.endMs, msg.force)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// Keep the main summary warm so the badge updates promptly. The content script
// drives its own range, so we only refresh the shared current-state cache here.
chrome.alarms.create("poll-status", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "poll-status") return;
  try {
    await getMain(true);
  } catch {
    // content script retries on its own poll
  }
});
