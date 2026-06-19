# Colonist WS Inspector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passively intercept colonist's WebSocket, decode its MessagePack frames, and surface them on `window.__cstWS` so we can reverse-engineer the game-event protocol — without touching any existing behaviour.

**Architecture:** A standalone, tested MessagePack decoder (`msgpack.js`) plus a main-world tap (`ws-inspector.js`) injected at `document_start` that wraps `window.WebSocket`, decodes each frame, and buffers it for on-demand console inspection. Spec: `docs/superpowers/specs/2026-06-19-colonist-ws-inspector-design.md`.

**Tech Stack:** Vanilla JS (no build step), MV3 `world:"MAIN"` content script, Node's built-in `node --test` (jsdom not needed — pure bytes).

---

## File structure

- **Create `colonist-stats-tracker/msgpack.js`** — pure `decode(bytes) → value`. Dual-mode: `module.exports` under Node, `window.__cstMsgpack` in the browser. One responsibility: MessagePack → JS value.
- **Create `colonist-stats-tracker/ws-inspector.js`** — main-world glue. Wraps `WebSocket`, records decoded frames into a ring buffer, exposes `window.__cstWS`. Depends on `window.__cstMsgpack`.
- **Create `tests/msgpack.test.js`** — TDD for the decoder (incl. the real captured frame).
- **Modify `colonist-stats-tracker/manifest.json`** — add a second `content_scripts` entry (`world:"MAIN"`, `run_at:"document_start"`); bump `version` 1.44.0 → 1.45.0.
- **Modify `CHANGELOG.md`** — add the 1.45.0 entry.

`ws-inspector.js` is browser-only glue verified live; its risky core (decoding) lives in the unit-tested `msgpack.js`.

---

## Task 1: MessagePack decoder (`msgpack.js`)

**Files:**
- Create: `colonist-stats-tracker/msgpack.js`
- Test: `tests/msgpack.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/msgpack.test.js`:

```js
'use strict';

// Minimal MessagePack reader. colonist's WebSocket game frames are MessagePack;
// these cases pin the wire formats they use (proven by the real captured frame
// below) plus the rest of the core spec so the decoder is trustworthy.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decode } = require('../colonist-stats-tracker/msgpack.js');

const bytes = (...hex) => new Uint8Array(hex);

test('decodes the real captured colonist frame', () => {
  // {id:"136", data:{timestamp:123}}  (timestamp value swapped to a uint8 here)
  const u8 = bytes(
    0x82,
    0xa2, 0x69, 0x64,                                           // "id"
    0xa3, 0x31, 0x33, 0x36,                                     // "136"
    0xa4, 0x64, 0x61, 0x74, 0x61,                               // "data"
    0x81,
    0xa9, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, // "timestamp"
    0xcc, 0x7b,                                                 // uint8 123
  );
  assert.deepEqual(decode(u8), { id: '136', data: { timestamp: 123 } });
});

test('positive and negative fixint', () => {
  assert.equal(decode(bytes(0x00)), 0);
  assert.equal(decode(bytes(0x7f)), 127);
  assert.equal(decode(bytes(0xff)), -1);
  assert.equal(decode(bytes(0xe0)), -32);
});

test('nil and booleans', () => {
  assert.equal(decode(bytes(0xc0)), null);
  assert.equal(decode(bytes(0xc2)), false);
  assert.equal(decode(bytes(0xc3)), true);
});

test('uint widths (big-endian)', () => {
  assert.equal(decode(bytes(0xcc, 0xff)), 255);
  assert.equal(decode(bytes(0xcd, 0x01, 0x00)), 256);
  assert.equal(decode(bytes(0xce, 0x00, 0x01, 0x00, 0x00)), 65536);
});

test('signed int widths', () => {
  assert.equal(decode(bytes(0xd0, 0x80)), -128);
  assert.equal(decode(bytes(0xd1, 0xff, 0x00)), -256);
});

test('float64', () => {
  assert.equal(decode(bytes(0xcb, 0x3f, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)), 1.5);
});

test('arrays and nested values', () => {
  assert.deepEqual(decode(bytes(0x92, 0x01, 0xa2, 0x68, 0x69)), [1, 'hi']); // [1, "hi"]
});

test('bin8 decodes to a Uint8Array', () => {
  const r = decode(bytes(0xc4, 0x03, 0x0a, 0x0b, 0x0c));
  assert.ok(r instanceof Uint8Array);
  assert.deepEqual([...r], [0x0a, 0x0b, 0x0c]);
});

test('uint64 beyond MAX_SAFE_INTEGER stays a BigInt (no silent rounding)', () => {
  const r = decode(bytes(0xcf, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff));
  assert.equal(typeof r, 'bigint');
});

test('an unknown ext is surfaced, not thrown', () => {
  // fixext1 (0xd4), type 5, one data byte 0x09
  const r = decode(bytes(0xd4, 0x05, 0x09));
  assert.equal(r.__ext, 5);
  assert.deepEqual([...r.data], [0x09]);
});

test('a truncated buffer throws a clear error', () => {
  assert.throws(() => decode(bytes(0xcc))); // uint8 marker, no following byte
});

test('accepts an ArrayBuffer as well as a Uint8Array', () => {
  assert.equal(decode(bytes(0x2a).buffer), 42);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/Users/stans/Projects/chrome-extensions && node --test tests/msgpack.test.js`
Expected: FAIL — `Cannot find module '../colonist-stats-tracker/msgpack.js'` (file not created yet).

- [ ] **Step 3: Write the decoder**

Create `colonist-stats-tracker/msgpack.js`:

```js
'use strict';

// Minimal MessagePack decoder (read-only). Covers the whole core spec so it can
// be trusted on colonist's frames; returns plain JS values. Big integers beyond
// Number.MAX_SAFE_INTEGER come back as BigInt; bin → Uint8Array; an unknown ext
// → { __ext, data } (surfaced, never thrown) so e.g. a timestamp ext is visible.
(function () {
  function decode(input) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const td = new TextDecoder('utf-8');
    let pos = 0;

    function str(len) { const s = td.decode(u8.subarray(pos, pos + len)); pos += len; return s; }
    function bin(len) { const b = new Uint8Array(u8.subarray(pos, pos + len)); pos += len; return b; }
    function arr(len) { const a = new Array(len); for (let i = 0; i < len; i++) a[i] = read(); return a; }
    function map(len) { const o = {}; for (let i = 0; i < len; i++) { const k = read(); o[k] = read(); } return o; }
    function ext(len) { const type = dv.getInt8(pos); pos += 1; return { __ext: type, data: bin(len) }; }
    function u64() { const v = dv.getBigUint64(pos); pos += 8; return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; }
    function i64() {
      const v = dv.getBigInt64(pos); pos += 8;
      return (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : v;
    }

    function read() {
      if (pos >= u8.length) throw new RangeError('msgpack: unexpected end of buffer at ' + pos);
      const b = u8[pos++];
      if (b <= 0x7f) return b;                          // positive fixint
      if (b >= 0xe0) return b - 0x100;                  // negative fixint
      if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f); // fixmap
      if (b >= 0x90 && b <= 0x9f) return arr(b & 0x0f); // fixarray
      if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f); // fixstr
      switch (b) {
        case 0xc0: return null;
        case 0xc2: return false;
        case 0xc3: return true;
        case 0xc4: { const n = dv.getUint8(pos); pos += 1; return bin(n); }
        case 0xc5: { const n = dv.getUint16(pos); pos += 2; return bin(n); }
        case 0xc6: { const n = dv.getUint32(pos); pos += 4; return bin(n); }
        case 0xc7: { const n = dv.getUint8(pos); pos += 1; return ext(n); }
        case 0xc8: { const n = dv.getUint16(pos); pos += 2; return ext(n); }
        case 0xc9: { const n = dv.getUint32(pos); pos += 4; return ext(n); }
        case 0xca: { const v = dv.getFloat32(pos); pos += 4; return v; }
        case 0xcb: { const v = dv.getFloat64(pos); pos += 8; return v; }
        case 0xcc: { const v = dv.getUint8(pos); pos += 1; return v; }
        case 0xcd: { const v = dv.getUint16(pos); pos += 2; return v; }
        case 0xce: { const v = dv.getUint32(pos); pos += 4; return v; }
        case 0xcf: return u64();
        case 0xd0: { const v = dv.getInt8(pos); pos += 1; return v; }
        case 0xd1: { const v = dv.getInt16(pos); pos += 2; return v; }
        case 0xd2: { const v = dv.getInt32(pos); pos += 4; return v; }
        case 0xd3: return i64();
        case 0xd4: return ext(1);
        case 0xd5: return ext(2);
        case 0xd6: return ext(4);
        case 0xd7: return ext(8);
        case 0xd8: return ext(16);
        case 0xd9: { const n = dv.getUint8(pos); pos += 1; return str(n); }
        case 0xda: { const n = dv.getUint16(pos); pos += 2; return str(n); }
        case 0xdb: { const n = dv.getUint32(pos); pos += 4; return str(n); }
        case 0xdc: { const n = dv.getUint16(pos); pos += 2; return arr(n); }
        case 0xdd: { const n = dv.getUint32(pos); pos += 4; return arr(n); }
        case 0xde: { const n = dv.getUint16(pos); pos += 2; return map(n); }
        case 0xdf: { const n = dv.getUint32(pos); pos += 4; return map(n); }
        default: throw new Error('msgpack: unknown prefix 0x' + b.toString(16));
      }
    }
    return read();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { decode };
  } else {
    (typeof window !== 'undefined' ? window : globalThis).__cstMsgpack = { decode };
  }
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Users/stans/Projects/chrome-extensions && node --test tests/msgpack.test.js`
Expected: PASS — all 12 tests.

- [ ] **Step 5: Run the FULL suite (no regressions)**

Run: `cd /c/Users/stans/Projects/chrome-extensions && node --test tests/*.test.js`
Expected: PASS — 197 prior + 12 new = 209 tests, 0 fail.

---

## Task 2: Main-world WebSocket tap (`ws-inspector.js`)

**Files:**
- Create: `colonist-stats-tracker/ws-inspector.js`

No unit test: this is browser-only glue (it wraps the page's real `WebSocket`), verified live in Task 5. Its decoding dependency is already covered by Task 1.

- [ ] **Step 1: Write the tap**

Create `colonist-stats-tracker/ws-inspector.js`:

```js
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
```

- [ ] **Step 2: Sanity-check it parses (no syntax errors)**

Run: `cd /c/Users/stans/Projects/chrome-extensions && node --check colonist-stats-tracker/ws-inspector.js && node --check colonist-stats-tracker/msgpack.js`
Expected: no output (both files are syntactically valid). It will NOT run the browser logic — that's Task 5.

---

## Task 3: Manifest — inject the tap + bump version

**Files:**
- Modify: `colonist-stats-tracker/manifest.json`

- [ ] **Step 1: Add the main-world content script and bump the version**

In `colonist-stats-tracker/manifest.json`: change `"version": "1.44.0"` to `"version": "1.45.0"`, and replace the `content_scripts` array so it has BOTH entries (the new main-world tap must inject at `document_start`, before colonist creates its socket):

```json
  "content_scripts": [
    {
      "matches": ["*://colonist.io/*", "*://*.colonist.io/*"],
      "js": ["msgpack.js", "ws-inspector.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["*://colonist.io/*", "*://*.colonist.io/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
```

- [ ] **Step 2: Validate the manifest is well-formed JSON**

Run: `cd /c/Users/stans/Projects/chrome-extensions && node -e "JSON.parse(require('fs').readFileSync('colonist-stats-tracker/manifest.json','utf8')); console.log('manifest OK', JSON.parse(require('fs').readFileSync('colonist-stats-tracker/manifest.json','utf8')).version)"`
Expected: `manifest OK 1.45.0`.

---

## Task 4: CHANGELOG entry (1.45.0)

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the 1.45.0 entry**

In `CHANGELOG.md`, directly under the `## [Unreleased]` line, add a new block above the existing `### Added` for colonist:

```markdown
### Added
- colonist-stats-tracker (1.45.0): **WebSocket inspector (groundwork for live, exact tracking).** colonist's board state can't be read from the (canvas) DOM, but its WebSocket carries every game event as MessagePack. A passive main-world tap (`ws-inspector.js`, injected at `document_start`) wraps `WebSocket`, decodes each frame with a new standalone MessagePack reader (`msgpack.js`, 12 tests incl. a real captured frame), and buffers them on `window.__cstWS` for on-demand inspection (`dump()`, `byId()`, `find()`). Purely observational — no existing behaviour changes. Sets up reverse-engineering the message catalog for a future live board model (exact in-game ⛔, robber position). +12 tests (209 suite).
```

- [ ] **Step 2: Confirm the file still reads cleanly**

Run: `cd /c/Users/stans/Projects/chrome-extensions && head -12 CHANGELOG.md`
Expected: the new 1.45.0 entry appears under `## [Unreleased]`.

---

## Task 5: Live verification + commit

**Files:** none (verification), then a single feature commit.

- [ ] **Step 1: Reload the unpacked extension and a colonist game**

Stan: `chrome://extensions` → 🔄 reload → open/refresh a colonist game tab (F5). The tap injects at `document_start`, so the console should print `[CST] WS inspector active …` near page load.

- [ ] **Step 2: Confirm capture works**

In the colonist tab's console, after a few seconds of play, run: `__cstWS.byId()` then `__cstWS.dump(10)`.
Expected: a histogram of message `id`s and a printed list of decoded `{id, data}` frames (NOT "Binary Message" / raw bytes). If frames show `error` + `bytesHex`, capture them — the decoder needs a tweak for a format colonist uses.

- [ ] **Step 3: Capture a labelled action (for the next sub-project)**

Stan: `__cstWS.clear()`, build one settlement, then `__cstWS.dump(10)` and paste the output. This begins the message catalog (id → meaning) that sub-project 2 will consume. (Repeat later for city / road / robber / dice.)

- [ ] **Step 4: Commit 1.45.0 (only on Stan's go — per his "commit when asked" rule)**

```bash
cd /c/Users/stans/Projects/chrome-extensions
git add colonist-stats-tracker/msgpack.js colonist-stats-tracker/ws-inspector.js \
        colonist-stats-tracker/manifest.json tests/msgpack.test.js CHANGELOG.md \
        docs/superpowers/specs/2026-06-19-colonist-ws-inspector-design.md \
        docs/superpowers/plans/2026-06-19-colonist-ws-inspector.md
git commit -m "feat(colonist-stats-tracker): 1.45.0 — WebSocket inspector (MessagePack decode groundwork)"
```
Note: stage ONLY these files — leave the unrelated `youtube-video-upload-time/` changes and the 1.36–1.44 colonist batch out of this commit (they are their own commits per the per-feature policy).

---

## Notes for execution
- **Commit policy:** Stan commits only when he says so, and wants one commit per feature. Tasks 1–4 build the whole 1.45.0 feature; the single commit is Task 5 Step 4, gated on his go. Keep the working tree's other changes unstaged.
- **MV3 `world:"MAIN"`** needs Chrome 111+ (Stan's Chrome is current).
- If `__cstWS` is undefined after reload, the tap didn't load in the main world — check the manifest `world`/`run_at` and that `msgpack.js` is listed BEFORE `ws-inspector.js`.
