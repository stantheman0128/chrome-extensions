# Colonist WS Inspector — Design

**Date:** 2026-06-19
**Status:** Approved (design), pending spec review → implementation plan
**Sub-project 1 of:** "live board model from the WebSocket" (the larger goal — exact
in-game ⛔, robber position, live per-tile production — is a later sub-project).

## Context & Goal

⛔ Cards blocked can't be exact *during* a game from the chat log alone: a tile's
build count at robber-time lives only on the (canvas/WebGL) board, never in the
log. We confirmed the board's true source is colonist's **WebSocket**: the
handshake is JSON (`{"type":"Connected",…}`) and every game event is a binary
frame that is **MessagePack** (proven by decoding a captured frame:
`82 A2 69 64 A3 31 33 36 A4 64 61 74 61 81 A9 74696D657374616D70` →
`{ id: "136", data: { timestamp: … } }`).

Before committing to a board model we must **see what the WebSocket actually
carries**. This sub-project builds a passive inspector that intercepts the
WebSocket, decodes the MessagePack frames, and surfaces them so we can
reverse-engineer the message catalog (which `id` = build / city / robber / dice,
and the data schema for each).

## Scope

**In:**
- A minimal MessagePack **decoder** (pure, tested).
- A main-world **WebSocket tap** that decodes incoming/outgoing frames into a
  ring buffer exposed on `window.__cstWS`, quiet by default.
- A manifest entry to inject the tap in the page's main world at `document_start`.
- A console workflow to dump/inspect captured frames.

**Out (explicitly deferred to sub-project 2):**
- Any board model, tile/coordinate tracking, or robber/placement logic.
- Changing how ⛔ (or anything else) is computed. The existing log-based system
  is untouched — this is purely additive observation.
- Deciding "supplement vs replace" the log system (decide after we see the data).

## Architecture

Three isolated units, each independently understandable/testable:

1. **`msgpack.js`** — `decode(bytes) → value`. A standalone MessagePack reader.
   No DOM, no deps; usable under Node (tests) and in the browser.
2. **`ws-inspector.js`** — runs in the **page main world** at `document_start`.
   Wraps `window.WebSocket`, taps each socket's frames, decodes binary frames
   via `msgpack.decode`, and records them. Exposes `window.__cstWS`.
3. **manifest** — a second `content_scripts` entry: `world: "MAIN"`,
   `run_at: "document_start"`, `matches` colonist, `js: ["msgpack.js",
   "ws-inspector.js"]`.

### Data flow
```
colonist server ──WS binary frame──▶ wrapped WebSocket (main world)
                                        │ decode (msgpack.js)
                                        ▼
                            ring buffer on window.__cstWS  ──(console: dump/byId/find)──▶ Stan → Claude
```
The content script's isolated world cannot see the page's `WebSocket`, so the tap
MUST run in the main world; it must load before colonist's bundle creates the
socket, so `run_at: document_start`.

## `msgpack.js` — decoder spec

`decode(u8: Uint8Array, opts?) → any` returns plain JS values. Supports the
formats colonist's frames use (and the rest of the core spec for safety):
- fixint (pos/neg), `uint 8/16/32/64`, `int 8/16/32/64`
- `nil`/`true`/`false`, `float 32/64`
- `fixstr`, `str 8/16/32` (UTF-8)
- `fixarray`, `array 16/32`
- `fixmap`, `map 16/32`
- `bin 8/16/32` → returned as `Uint8Array`
- `ext` family → returned as `{ __ext: type, data: Uint8Array }` (don't throw on
  an unknown ext such as a timestamp extension; surface it so we can identify it)

`uint64`/`int64` beyond `Number.MAX_SAFE_INTEGER` → `BigInt` (so ids/timestamps
aren't silently rounded). A truncated/invalid buffer throws a clear error; the
tap catches it and records the raw bytes instead of crashing.

API surface stays tiny: `decode`, and `decode` only. (A future encoder is YAGNI.)

## `ws-inspector.js` — main-world tap

- Wrap the `WebSocket` constructor (keep a reference to the native one). For each
  instance, attach a `message` listener and wrap `send` to also capture outgoing.
- Frame handling: text frames recorded as-is (the JSON handshake); binary frames
  (`ArrayBuffer`, or `Blob` → read async) decoded via `msgpack.decode`.
- Record `{ t, dir: 'in'|'out', id, data }` into a capped ring buffer
  (default 500). `id` is pulled from the decoded object's `id` field when present
  (else `null`). Decode failures record `{ t, dir, error, bytesHex }`.
- **Quiet by default** — no `console.log` spam. Everything is on demand.
- `window.__cstWS` API:
  - `.log` — the raw buffer array
  - `.dump(n = 20)` — pretty-print the last `n` entries (id + data)
  - `.byId()` — histogram `{ id: count }` over the buffer (spot the frequent/rare)
  - `.find(substr)` — entries whose stringified data contains `substr`
  - `.clear()` — empty the buffer
- Defensive: if `window.WebSocket` is missing or wrapping throws, fail silent
  (the rest of the extension is unaffected — purely additive).

## Reverse-engineering workflow (how we "see the data")

1. Stan loads a game (the tap is already capturing).
2. Stan performs ONE clear action (e.g. build a settlement), then runs
   `__cstWS.dump(10)` and pastes the output.
3. We correlate the action with the new frame(s) → name that `id` and its schema.
4. Repeat for city, road, robber move, dice roll, dev card, etc.
5. `byId()` / `find()` help locate candidate messages.

Output of this sub-project: a documented **message catalog** (id → meaning →
schema) that sub-project 2's board model will consume.

## Testing

- `msgpack.js`: TDD against known byte sequences, including the **real captured
  frame** (`{ id: "136", data: { timestamp … } }`), plus nested maps/arrays, the
  int/uint/float widths, negative fixint, bin, and a truncated-buffer error case.
- `ws-inspector.js`: the main-world wrap is browser-only; verified live (Stan).
  The decode path it relies on is covered by the `msgpack.js` tests. Where cheap,
  factor the buffer/dump logic so it can be exercised under Node.

## Versioning

- **1.45.0** — the WS inspector (this sub-project). Per the per-feature policy:
  bump manifest + CHANGELOG + commit when done.
- The board model and live-exact ⛔ are later versions (1.46.0+), specced
  separately once the catalog is known.

## Risks & mitigations

- **Frames are `Blob`, not `ArrayBuffer`** → handle both (async read for Blob).
- **An unknown MessagePack ext (e.g. timestamp)** → don't throw; surface as
  `{__ext}` so we can identify it.
- **colonist changes its protocol** → the inspector degrades to "unknown id";
  it's a debug tool, low blast radius. The real feature (sub-project 2) will need
  a maintenance posture, decided then.
- **Main-world injection unsupported on an old Chrome** → `world: "MAIN"` needs
  Chrome 111+. Acceptable (Stan's Chrome is current); note it as a requirement.
- **Performance** — quiet ring buffer, O(1) per frame, capped size. Negligible.

## Out of scope / next

Sub-project 2 (separate spec): from the catalog, build a board model (tiles,
buildings, robber), compute exact per-tile production live, and feed exact ⛔
(and possibly more) into the panel — then revisit "supplement vs replace" the
log system with real knowledge of what the WS provides.
