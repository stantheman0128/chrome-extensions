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
