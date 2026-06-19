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
