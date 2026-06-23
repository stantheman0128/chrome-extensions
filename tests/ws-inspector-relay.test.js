'use strict';

// The frame pipeline INSIDE ws-inspector.js (the main-world socket tap), which
// every other ws-*.test.js skips by starting at the postMessage boundary. Here we
// drive the real path: a Blob arrives on the wrapped socket → tap()'s message
// handler awaits Blob.arrayBuffer() → record() decodes the MessagePack → relays an
// id=130 frame via window.postMessage({__cstWS:'state', msg}). That async Blob hop
// (ws-inspector.js ~line 84) is the ordering risk Codex flagged; nothing covered it.
//
// Real bytes, not invented protocol: the encoder below is the exact inverse of the
// production decoder, and `roundTrip()` proves every frame survives encode→decode
// through colonist-stats-tracker/msgpack.js before we feed it as a Blob. The full
// state we encode is the genuine 2-player capture in tests/fixtures.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const window = dom.window;
global.window = window;
global.document = window.document;

const msgpack = require('../colonist-stats-tracker/msgpack.js');
// ws-inspector reads window.__cstMsgpack (the main-world global msgpack.js sets);
// under Node msgpack.js exports via module.exports instead, so wire it ourselves
// exactly as the browser load order (msgpack.js then ws-inspector.js) would.
window.__cstMsgpack = msgpack;

const inspector = require('../colonist-stats-tracker/ws-inspector.js');

// Minimal MessagePack encoder — the inverse of msgpack.js's decoder, only the
// types colonist frames use (str/int/float/bool/nil/array/map). Numeric keys in
// colonist's index maps are strings on the wire, matching JSON object keys.
function encode(value) {
  const out = [];
  const u32 = (n) => out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  function writeStr(s) {
    const bytes = Buffer.from(s, 'utf-8');
    const n = bytes.length;
    if (n <= 0x1f) out.push(0xa0 | n);
    else if (n <= 0xff) out.push(0xd9, n);
    else if (n <= 0xffff) out.push(0xda, (n >> 8) & 0xff, n & 0xff);
    else { out.push(0xdb); u32(n); }
    for (const b of bytes) out.push(b);
  }
  function write64(prefix, big) {
    out.push(prefix);
    const buf = Buffer.alloc(8);
    prefix === 0xcf ? buf.writeBigUInt64BE(big, 0) : buf.writeBigInt64BE(big, 0);
    for (const b of buf) out.push(b);
  }
  function writeInt(n) {
    if (n >= 0 && n <= 0x7f) { out.push(n); return; }
    if (n < 0 && n >= -32) { out.push(n & 0xff); return; }
    if (n >= 0 && n <= 0xff) { out.push(0xcc, n); return; }
    if (n >= 0 && n <= 0xffff) { out.push(0xcd, (n >> 8) & 0xff, n & 0xff); return; }
    if (n >= 0 && n <= 0xffffffff) { out.push(0xce); u32(n >>> 0); return; }
    if (n >= 0) { write64(0xcf, BigInt(n)); return; }       // uint64 (e.g. startTime)
    if (n >= -128) { out.push(0xd0, n & 0xff); return; }
    if (n >= -32768) { out.push(0xd1, (n >> 8) & 0xff, n & 0xff); return; }
    if (n >= -2147483648) { out.push(0xd2); u32(n >>> 0); return; }
    write64(0xd3, BigInt(n));                                // int64
  }
  function writeFloat(n) {
    out.push(0xcb);
    const buf = Buffer.alloc(8); buf.writeDoubleBE(n, 0);
    for (const b of buf) out.push(b);
  }
  function write(v) {
    if (v === null || v === undefined) { out.push(0xc0); return; }
    if (typeof v === 'boolean') { out.push(v ? 0xc3 : 0xc2); return; }
    if (typeof v === 'number') { Number.isInteger(v) ? writeInt(v) : writeFloat(v); return; }
    if (typeof v === 'string') { writeStr(v); return; }
    if (Array.isArray(v)) {
      const n = v.length;
      if (n <= 0x0f) out.push(0x90 | n);
      else if (n <= 0xffff) out.push(0xdc, (n >> 8) & 0xff, n & 0xff);
      else { out.push(0xdd); u32(n); }
      for (const item of v) write(item);
      return;
    }
    const keys = Object.keys(v);
    const n = keys.length;
    if (n <= 0x0f) out.push(0x80 | n);
    else if (n <= 0xffff) out.push(0xde, (n >> 8) & 0xff, n & 0xff);
    else { out.push(0xdf); u32(n); }
    for (const k of keys) { writeStr(k); write(v[k]); }
  }
  write(value);
  return new Uint8Array(out);
}

// Prove the encoder is honest: every frame must survive a round trip through the
// PRODUCTION decoder before we trust it as a stand-in for real captured bytes.
function roundTrip(value) {
  const bytes = encode(value);
  assert.deepEqual(msgpack.decode(bytes), value, 'encoder must invert the production decoder');
  return bytes;
}

// jsdom's Blob has no .arrayBuffer(); Node's global (undici) Blob does, and the
// inspector resolves the bare `Blob` global to it. Carries the encoded frame.
function blobOf(bytes) {
  return new globalThis.Blob([bytes]);
}

// A fake socket that records the message handler tap() attaches, so we can fire
// frames at it exactly like the browser WebSocket would.
function fakeSocket() {
  let handler = null;
  return {
    addEventListener(type, fn) { if (type === 'message') handler = fn; },
    send() {},
    deliver(data) { handler({ data }); },
  };
}

// jsdom delivers postMessage on a later macrotask, and the relay sits behind the
// Blob.arrayBuffer() microtask too. Poll until the expected number of relays has
// landed (or a generous deadline), so a slow frame can't bleed into the next test.
function waitFor(got, count, maxTicks = 50) {
  return new Promise((resolve) => {
    let ticks = 0;
    const step = () => {
      if (got.length >= count || ticks >= maxTicks) return resolve();
      ticks += 1;
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}

// Settle the macrotask queue so no straggler relay from this test leaks forward.
function drain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function collectRelays() {
  const got = [];
  const listener = (e) => { if (e.data && e.data.__cstWS === 'state') got.push(e.data.msg); };
  window.addEventListener('message', listener);
  return { got, stop: () => window.removeEventListener('message', listener) };
}

function fullStateFrame(payload) {
  return { id: '130', data: { type: 4, payload } };
}

test('the inspector exports its real pipeline under CommonJS, inert in the browser', () => {
  assert.equal(typeof inspector.tap, 'function');
  assert.equal(typeof inspector.record, 'function');
  assert.equal(typeof inspector.Wrapped, 'function');
});

test('a Blob carrying a real id=130 full state is decoded and relayed intact', async () => {
  const payload = require('./fixtures/ws-fullstate-2p.json');
  const frame = fullStateFrame(payload);
  const bytes = roundTrip(frame);

  const sink = collectRelays();
  const ws = fakeSocket();
  inspector.tap(ws);
  ws.deliver(blobOf(bytes));   // Blob → arrayBuffer → decode → relay
  await waitFor(sink.got, 1);
  sink.stop();

  assert.equal(sink.got.length, 1, 'exactly one id=130 frame relayed');
  const relayed = sink.got[0];
  assert.equal(relayed.id, '130');
  assert.equal(relayed.data.type, 4);
  // The relayed payload is the genuine captured full state, byte-for-byte through
  // the real decoder (54 corners, 19 tiles), not a re-serialised copy.
  assert.equal(Object.keys(relayed.data.payload.gameState.mapState.tileCornerStates).length, 54);
  assert.equal(Object.keys(relayed.data.payload.gameState.mapState.tileHexStates).length, 19);
  assert.deepEqual(relayed.data.payload, payload, 'decoded payload matches the capture exactly');
});

test('feeding the relayed full state through board.js yields the validated geometry', async () => {
  const B = require('../colonist-stats-tracker/board.js');
  const payload = require('./fixtures/ws-fullstate-2p.json');
  const bytes = roundTrip(fullStateFrame(payload));

  const sink = collectRelays();
  const ws = fakeSocket();
  inspector.tap(ws);
  ws.deliver(blobOf(bytes));
  await waitFor(sink.got, 1);
  sink.stop();

  // Drive board.js with the frame that actually came off the Blob→decode path, the
  // same hop content.js performs on a __cstWS:'state' message.
  const board = B.createBoard();
  B.applyFullState(board, sink.got[0].data.payload);
  assert.deepEqual(B.cornerDiag(board), { total: 54, geom: 54, built: 6, phantom: 0 });
  // pin against the values ws-geometry-real.test.js validates from colonist's own
  // production broadcasts — so the Blob path lands the exact, real geometry.
  const pips = B.pipsOf(board);
  assert.equal(pips[1].total, 24);
  assert.equal(pips[2].total, 19);
});

test('two Blobs in quick succession relay IN ORDER despite the async arrayBuffer hop', async () => {
  // The ordering risk: tap() awaits Blob.arrayBuffer() per frame, so two frames
  // fired back-to-back could relay out of order if the promises settled unevenly.
  // Build two distinguishable real id=130 diff frames (type 91) and assert order.
  const frameA = { id: '130', data: { type: 91, payload: { diff: { tag: 'A' } } } };
  const frameB = { id: '130', data: { type: 91, payload: { diff: { tag: 'B' } } } };
  const bytesA = roundTrip(frameA);
  const bytesB = roundTrip(frameB);

  const sink = collectRelays();
  const ws = fakeSocket();
  inspector.tap(ws);
  ws.deliver(blobOf(bytesA));
  ws.deliver(blobOf(bytesB));
  await waitFor(sink.got, 2);
  sink.stop();

  assert.equal(sink.got.length, 2, 'both frames relayed');
  assert.deepEqual(sink.got.map((m) => m.data.payload.diff.tag), ['A', 'B'], 'relayed in arrival order');
});

test('non-130 frames (e.g. the id=136 heartbeat) decode but are NOT relayed', async () => {
  // The real captured heartbeat from msgpack.test.js — proves the relay gate is on
  // id, so the 1/sec heartbeat never reaches the board model.
  const heartbeat = { id: '136', data: { timestamp: 123 } };
  const bytes = roundTrip(heartbeat);

  const sink = collectRelays();
  const ws = fakeSocket();
  inspector.tap(ws);
  ws.deliver(blobOf(bytes));
  await drain(); await drain(); await drain();   // settle: a relay, if any, would have landed
  sink.stop();

  assert.equal(sink.got.length, 0, 'heartbeat decoded but not relayed');
});

test('a malformed binary frame is swallowed (the catch in tap), nothing relayed', async () => {
  // arrayBuffer resolves but the bytes are not valid msgpack → record() throws,
  // record() catches it into the buffer, and nothing is relayed. The socket tap
  // must never let a bad frame escape as an unhandled rejection.
  const sink = collectRelays();
  const ws = fakeSocket();
  inspector.tap(ws);
  ws.deliver(blobOf(new Uint8Array([0xcc])));  // uint8 marker with no following byte
  await drain(); await drain(); await drain();
  sink.stop();

  assert.equal(sink.got.length, 0, 'a corrupt frame relays nothing and does not throw');
});
