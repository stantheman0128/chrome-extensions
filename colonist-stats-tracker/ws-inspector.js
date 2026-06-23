'use strict';

// Runs in the PAGE MAIN WORLD at document_start (see manifest). Wraps WebSocket
// so we can read colonist's frames — the content script's isolated world can't
// see the page's socket. Purely observational: it decodes each frame and buffers
// it for on-demand inspection via window.__cstWS; it never alters traffic.
(function () {
  const Native = window.WebSocket;
  if (!Native) return;
  const mp = window.__cstMsgpack;

  const CAP = 500;
  const buf = [];
  const now = () => (window.performance && performance.now ? Math.round(performance.now()) : 0);
  const push = (e) => { buf.push(e); if (buf.length > CAP) buf.shift(); };

  // Uncapped, deduped harvest of colonist's structured game log — protocol
  // reverse-engineering groundwork for migrating the Stats tally onto the WS.
  // gameLogState is append-only with a unique increasing index per entry, so a
  // index->entry map captures a WHOLE game's events without the 500-frame buffer
  // shifting early steals/trades out. `meta` keeps the opening colour↔name map so
  // each event's playerColor can be attributed.
  const logEntries = {};
  const robberProbe = { diffKeys: {}, samples: [] };  // ⛔ blocked-loss investigation
  let meta = null;
  let lastFull = null;   // the most recent type-4 frame, kept so a late save() is still replayable
  function harvestLog(obj) {
    const d = obj && obj.data;
    if (!d) return;
    if (d.type === 4 && d.payload) {
      lastFull = obj;     // pin it: the 500-frame buffer drops it on a long game
      const gs = d.payload.gameState || {};
      meta = {
        playerColor: gs.playerColor,
        players: (d.payload.playerUserStates || []).map((u) => ({ color: u.selectedColor, name: u.username, bot: u.isBot })),
      };
    }
    if (d.type === 91 && d.payload && d.payload.diff) {
      const diff = d.payload.diff;
      for (const key of Object.keys(diff)) robberProbe.diffKeys[key] = (robberProbe.diffKeys[key] || 0) + 1;
      if (robberProbe.samples.length < 6) {
        try { if (JSON.stringify(diff).toLowerCase().indexOf('robber') >= 0) robberProbe.samples.push(diff); } catch (e) {}
      }
    }
    const gl = (d.payload && d.payload.gameState && d.payload.gameState.gameLogState)
            || (d.payload && d.payload.diff && d.payload.diff.gameLogState);
    if (!gl) return;
    for (const k of Object.keys(gl)) {
      if (gl[k] && !(k in logEntries)) logEntries[k] = gl[k];
    }
  }

  function hex(ab) {
    try {
      const u8 = ab instanceof ArrayBuffer ? new Uint8Array(ab) : new Uint8Array(ab.buffer || ab);
      const out = [];
      for (let i = 0; i < Math.min(u8.length, 64); i++) out.push(('0' + u8[i].toString(16)).slice(-2));
      return out.join(' ');
    } catch (e) { return '?'; }
  }

  function record(dir, data) {
    if (typeof data === 'string') {            // the JSON handshake frames
      let parsed; try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
      push({ t: now(), dir, kind: 'text', id: (parsed && parsed.type) || null, data: parsed });
      return;
    }
    try {                                      // binary (MessagePack) frames
      const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data);
      const obj = mp ? mp.decode(u8) : null;
      push({ t: now(), dir, kind: 'bin', id: (obj && obj.id != null) ? obj.id : null, data: obj });
      // Relay game-state frames to the content script (board model); skip the
      // 1/sec heartbeat (id 136) and outgoing pings.
      if (dir === 'in' && obj && obj.id === '130') {
        try { window.postMessage({ __cstWS: 'state', msg: obj }, '*'); } catch (e2) {}
        try { harvestLog(obj); } catch (e3) {}
      }
    } catch (e) {
      push({ t: now(), dir, kind: 'bin', error: String(e), bytesHex: hex(data) });
    }
  }

  function tap(ws) {
    // Serialize this socket's incoming frames. Each binary frame is decoded after an
    // async Blob.arrayBuffer(), and two frames fired back-to-back have NO ordering
    // guarantee on their own — a later frame whose buffer resolves first would relay
    // first, e.g. a roll's type-47 ahead of its type-10. Chaining every frame through
    // one promise makes relay order == arrival order: frame N's arrayBuffer() isn't
    // even started until frame N-1 has been recorded.
    // Serialize this socket's incoming frames. Each binary frame is decoded after an
    // async Blob.arrayBuffer(), and two frames fired back-to-back have NO ordering
    // guarantee on their own — a later frame whose buffer resolves first would relay
    // first, e.g. a roll's type-47 ahead of its type-10. Chaining every frame through
    // one promise makes relay order == arrival order: frame N's arrayBuffer() isn't
    // even started until frame N-1 has been recorded.
    let chain = Promise.resolve();
    ws.addEventListener('message', (ev) => {
      const d = ev.data;
      if (typeof Blob !== 'undefined' && d instanceof Blob) {
        chain = chain.then(() => d.arrayBuffer()).then((ab) => record('in', ab), () => {});
      } else {
        chain = chain.then(() => record('in', d));
      }
    });
    const send = ws.send;
    ws.send = function (payload) {
      try { record('out', payload); } catch (e) {}
      return send.apply(ws, arguments);
    };
  }

  class Wrapped extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      try { tap(this); } catch (e) {}
    }
  }
  try { window.WebSocket = Wrapped; } catch (e) { return; }

  const bigintReplacer = (k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v);
  window.__cstWS = {
    log: buf,
    dump(n) {
      const slice = buf.slice(-(n || 20));
      slice.forEach((e) => {
        const body = e.error ? ('ERROR ' + e.error + ' | ' + e.bytesHex) : JSON.stringify(e.data, bigintReplacer);
        console.log('[' + e.dir + '] id=' + e.id + ' ' + body);
      });
      return slice.length + ' shown';
    },
    byId() {
      const h = {};
      buf.forEach((e) => { const k = String(e.id); h[k] = (h[k] || 0) + 1; });
      (console.table || console.log)(h);
      return h;
    },
    find(sub) {
      return buf.filter((e) => {
        try { return JSON.stringify(e.data, bigintReplacer).indexOf(sub) >= 0; } catch (x) { return false; }
      });
    },
    clear() { buf.length = 0; return 'cleared'; },
    // Ask the content script to print its self-audit report (WS vs our panel vs
    // colonist) to this console — paste the result to cross-check a finished game.
    audit() { window.postMessage({ __cstAuditReq: true }, '*'); return 'audit requested — report prints below'; },
    // Whole-game structured log grouped by text.type, a few samples each — paste
    // this to map the Stats events (steal/trade/discard/achievement) onto the WS.
    logTypes() {
      const byType = {};
      for (const k of Object.keys(logEntries)) {
        const e = logEntries[k];
        const ty = e && e.text && e.text.type;
        if (ty == null) continue;
        (byType[ty] = byType[ty] || []).push({ i: parseInt(k, 10), ...e });
      }
      const types = {};
      for (const ty of Object.keys(byType).sort((a, b) => a - b)) {
        const arr = byType[ty].sort((a, b) => a.i - b.i);
        types[ty] = { count: arr.length, samples: arr.slice(0, 3) };
      }
      const dump = { meta, types };
      console.log(JSON.stringify(dump, bigintReplacer, 2));
      return dump;
    },
    allLog() { return logEntries; },
    // Robber-tracking probe for the ⛔ fix: which diff top-level keys appear (is
    // mechanicRobberState even present?) + the first few diffs mentioning a robber.
    // Move the robber a few times, then paste this.
    robber() {
      const out = { diffKeys: robberProbe.diffKeys, robberSamples: robberProbe.samples };
      console.log(JSON.stringify(out, bigintReplacer, 2));
      return out;
    },
    // Corner-geometry probe — the heart of the "pips missing until F5" mystery.
    // Answers two protocol questions we've only ever ASSUMED: (1) does the full
    // state (type 4) carry every corner's x/y/z, or only built corners? (2) do
    // placement diffs (type 91) carry the placed corner's x/y/z, or just its
    // owner/buildingType (→ a coordinate-less "phantom" → 0 pips)? Run it a few
    // moves into the game, before any F5.
    geom() {
      let full = null;
      const cornerDiffs = [];
      for (const e of buf) {
        if (e.kind !== 'bin' || !e.data || e.data.id !== '130') continue;
        const d = e.data.data;
        if (!d) continue;
        if (d.type === 4 && d.payload) full = d;
        const tcs = d.type === 91 && d.payload && d.payload.diff
          && d.payload.diff.mapState && d.payload.diff.mapState.tileCornerStates;
        if (tcs) cornerDiffs.push(tcs);
      }
      const summarize = (tcs) => {
        let count = 0, withPos = 0, built = 0, builtNoPos = 0;
        for (const i of Object.keys(tcs || {})) {
          const c = tcs[i]; count += 1;
          const hasPos = c && c.x != null && c.y != null && c.z != null;
          if (hasPos) withPos += 1;
          if (c && c.buildingType) { built += 1; if (!hasPos) builtNoPos += 1; }
        }
        return { count, withPos, built, builtNoPos };
      };
      const fmap = full && full.payload.gameState && full.payload.gameState.mapState;
      const out = {
        fullState: full ? {
          tiles: Object.keys((fmap && fmap.tileHexStates) || {}).length,
          corners: summarize(fmap && fmap.tileCornerStates),
          sampleCorners: Object.entries((fmap && fmap.tileCornerStates) || {}).slice(0, 4),
        } : 'NO full state (type 4) in buffer yet — refresh once to force one',
        cornerDiffCount: cornerDiffs.length,
        cornerDiffSamples: cornerDiffs.slice(0, 6),  // raw: shows whether placements carry x/y/z
      };
      console.log(JSON.stringify(out, bigintReplacer, 2));
      return out;
    },
    // Download the raw frame buffer as JSON — the seed for real-packet "golden
    // replay" test fixtures (so tests finally exercise colonist's actual frame
    // ordering, not hand-authored ideal input).
    save() {
      try {
        // Save the recent frame buffer AND the uncapped game log AND the last full
        // state, so a capture taken late in a long game is still fully replayable
        // (the recon rebuilds deterministically from `log`; `fullState` carries the
        // geometry / colour↔name map / hand baseline the 500-frame buffer drops).
        const dump = { frames: buf, log: logEntries, fullState: lastFull, savedAtFrame: buf.length };
        const blob = new Blob([JSON.stringify(dump, bigintReplacer)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'cst-ws-frames.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return 'saved ' + buf.length + ' frames + ' + Object.keys(logEntries).length + ' log entries' +
          (lastFull ? ' + full state' : ' (no full state seen yet)') + ' to cst-ws-frames.json';
      } catch (e) { return 'save failed: ' + e; }
    },
  };
  // Global alias so a finished game can be cross-checked with a bare __cstAudit().
  window.__cstAudit = function () { window.postMessage({ __cstAuditReq: true }, '*'); return 'audit requested — report prints below'; };
  console.log('%c[CST] WS inspector active — play, then run __cstAudit() or __cstWS.dump()', 'color:#2f6f9f;font-weight:600');

  // Under Node (the test harness) expose the real frame pipeline so a test can
  // drive a Blob through tap()'s message handler → arrayBuffer → decode → relay.
  // In the MAIN world `module` is undefined, so this is inert there.
  if (typeof module !== 'undefined' && module.exports) module.exports = { tap, record, Wrapped };
})();
