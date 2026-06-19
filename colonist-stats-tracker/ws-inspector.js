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
  };
  console.log('%c[CST] WS inspector active — play, then run __cstWS.dump()', 'color:#2f6f9f;font-weight:600');
})();
