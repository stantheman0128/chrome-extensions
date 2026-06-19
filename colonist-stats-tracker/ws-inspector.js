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
  let meta = null;
  function harvestLog(obj) {
    const d = obj && obj.data;
    if (!d) return;
    if (d.type === 4 && d.payload) {
      const gs = d.payload.gameState || {};
      meta = {
        playerColor: gs.playerColor,
        players: (d.payload.playerUserStates || []).map((u) => ({ color: u.selectedColor, name: u.username, bot: u.isBot })),
      };
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
    ws.addEventListener('message', (ev) => {
      const d = ev.data;
      if (typeof Blob !== 'undefined' && d instanceof Blob) {
        d.arrayBuffer().then((ab) => record('in', ab)).catch(() => {});
      } else {
        record('in', d);
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
  };
  console.log('%c[CST] WS inspector active — play, then run __cstWS.dump()', 'color:#2f6f9f;font-weight:600');
})();
