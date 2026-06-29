// Pure status-model builder shared by background.js (importScripts) and the test
// harness. No chrome.* / DOM dependencies. Turns incident.io proxy JSON into the
// grouped, per-component, per-day model the UI renders.
(function (root) {
  "use strict";

  const DAY = 86400000;

  // incident.io component statuses -> severity + our colour bucket
  const STATUS = {
    operational:          { sev: 0, bucket: "operational" },
    degraded_performance: { sev: 1, bucket: "minor" },
    under_maintenance:    { sev: 1, bucket: "maintenance" },
    partial_outage:       { sev: 2, bucket: "major" },
    major_outage:         { sev: 3, bucket: "critical" },
    full_outage:          { sev: 3, bucket: "critical" },
  };
  const BUCKET_SEV = { operational: 0, maintenance: 1, minor: 1, major: 2, critical: 3 };
  const INDICATORS = ["none", "minor", "major", "critical"];
  const DESC = {
    none: "All Systems Operational",
    minor: "Degraded Performance",
    major: "Partial Outage",
    critical: "Major Outage",
  };

  function extractText(node) {
    if (!node) return "";
    if (typeof node.text === "string") return node.text;
    if (Array.isArray(node.content)) return node.content.map(extractText).join("");
    return "";
  }

  function monthLabel(ms) {
    return new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  function buildStatusModel(summary, impacts, startMs, endMs) {
    const days = Math.max(1, Math.round((endMs - startMs) / DAY));

    const byComp = {};
    for (const im of (impacts.component_impacts || [])) {
      (byComp[im.component_id] = byComp[im.component_id] || []).push(im);
    }

    // currently-affected components -> their live bucket (empty when all operational)
    const liveStatus = {};
    for (const ac of summary.affected_components || []) {
      const cid = ac.component_id || ac.id;
      const st = STATUS[ac.status || ac.current_status];
      if (cid && st) liveStatus[cid] = st.bucket;
    }
    function curOf(compId) { return liveStatus[compId] || "operational"; }

    function histFor(compId) {
      const h = new Array(days).fill("operational");
      for (const im of (byComp[compId] || [])) {
        const s = STATUS[im.status];
        if (!s) continue;
        const a = new Date(im.start_at).getTime();
        const b = new Date(im.end_at || Date.now()).getTime();
        let d0 = Math.floor((a - startMs) / DAY);
        let d1 = Math.floor((b - startMs) / DAY);
        if (d1 < 0 || d0 > days - 1) continue;
        d0 = Math.max(0, d0);
        d1 = Math.min(days - 1, d1);
        for (let d = d0; d <= d1; d++) {
          if (s.sev > BUCKET_SEV[h[d]]) h[d] = s.bucket;
        }
      }
      return h;
    }

    // Uptime % — Stan's rule: any incident on a day counts the whole day as down.
    function uptimePct(hist) {
      const down = hist.filter((b) => b !== "operational").length;
      return (((days - down) / days) * 100).toFixed(2);
    }

    const groups = [];
    for (const it of (summary.structure && summary.structure.items) || []) {
      const g = it.group;
      if (!g || g.hidden) continue;
      const comps = [];
      const agg = new Array(days).fill("operational");
      let gcur = "operational";
      for (const c of g.components || []) {
        if (c.hidden) continue;
        const hist = histFor(c.component_id);
        const cur = curOf(c.component_id);
        comps.push({ id: c.component_id, name: c.name, uptime: uptimePct(hist), history: hist, current: cur });
        if (BUCKET_SEV[cur] > BUCKET_SEV[gcur]) gcur = cur;
        for (let d = 0; d < days; d++) {
          if (BUCKET_SEV[hist[d]] > BUCKET_SEV[agg[d]]) agg[d] = hist[d];
        }
      }
      if (!comps.length) continue;
      groups.push({
        id: g.id, name: g.name, description: g.description || "",
        uptime: uptimePct(agg), history: agg, components: comps, current: gcur,
      });
    }

    // Overall indicator from currently-affected components
    let worst = 0;
    for (const ac of summary.affected_components || []) {
      const st = STATUS[ac.status || ac.current_status];
      if (st && st.sev > worst) worst = st.sev;
    }
    const indicator = INDICATORS[worst];

    const activeIncidents = (summary.ongoing_incidents || []).map((inc) => {
      const updates = (inc.updates || []).map((u) => ({
        status: u.status || inc.status,
        text: extractText(u.message && u.message.text_node),
        at: u.published_at,
      })).sort((a, b) => new Date(b.at) - new Date(a.at));
      let sev = 0;
      for (const ci of inc.component_impacts || []) {
        const s = STATUS[ci.status];
        if (s && s.sev > sev) sev = s.sev;
      }
      return {
        id: inc.id, name: inc.name, status: inc.status,
        bucket: INDICATORS[sev], latest: updates[0] || null, updates,
        published_at: inc.published_at,
      };
    });

    const history = (impacts.incident_links || []).map((l) => ({
      id: l.id, name: l.name, status: l.status, at: l.published_at, permalink: l.permalink,
    })).sort((a, b) => new Date(b.at) - new Date(a.at));

    return {
      status: { indicator, description: DESC[indicator] },
      range: { startMs, endMs, days, label: monthLabel(startMs) + " – " + monthLabel(endMs) },
      groups, activeIncidents, history,
      updated_at: new Date().toISOString(),
      dataAvailableSince: summary.data_available_since || null,
    };
  }

  root.buildStatusModel = buildStatusModel;
})(typeof self !== "undefined" ? self : this);
