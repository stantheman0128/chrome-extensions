'use strict';

// 1.124 security hardening — the two pure guards that 1.124 added but only had
// behavioural / repro coverage. (a) isTrustedCstPageMessage: the content script must
// only act on page messages from the colonist.io page itself (same window, colonist
// origin), so a hostile frame can't drive the panel. (b) safeCssColor: a player colour
// pulled from a DOM log span must be a real CSS colour before it reaches an inline
// style, or it's dropped to a fallback — no style/markup injection.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst } = require('./helpers/setup');

const window = global.window;
const msg = (over) => ({ data: { __cstWS: 'state' }, source: window, origin: 'https://colonist.io', ...over });

test('isTrustedCstPageMessage accepts only colonist.io page messages from this window', () => {
  const ok = cst.isTrustedCstPageMessage;
  assert.equal(ok(msg()), true, 'colonist.io, same window → trusted');
  assert.equal(ok(msg({ origin: 'https://www.colonist.io' })), true, 'www subdomain → trusted');
  assert.equal(ok(msg({ origin: 'https://colonist.io:443' })), true, 'explicit port → trusted');
  assert.equal(ok(msg({ origin: '' })), true, 'empty origin (jsdom / same-doc relay) → trusted');
  assert.equal(ok(msg({ origin: 'https://evil.com' })), false, 'foreign origin → rejected');
  assert.equal(ok(msg({ origin: 'https://notcolonist.io.evil.com' })), false, 'look-alike host → rejected');
  assert.equal(ok(msg({ source: {} })), false, 'a different source window → rejected');
  assert.equal(ok({ source: window }), false, 'no data → rejected');
  assert.equal(ok(null), false, 'no event → rejected');
});

test('safeCssColor passes real CSS colours and drops anything that could inject', () => {
  const f = cst.safeCssColor;
  assert.equal(f('#abc'), '#abc');
  assert.equal(f('#aabbcc'), '#aabbcc');
  assert.equal(f('rgb(12, 34, 56)'), 'rgb(12, 34, 56)');
  assert.equal(f('rgba(12,34,56,0.5)'), 'rgba(12,34,56,0.5)');
  assert.equal(f('hsl(120, 50%, 50%)'), 'hsl(120, 50%, 50%)');
  // anything that isn't a clean colour → the fallback, never the raw string
  assert.equal(f('red; background:url(javascript:alert(1))'), '#888', 'injection attempt → fallback');
  assert.equal(f('</style><script>'), '#888', 'markup → fallback');
  assert.equal(f(''), '#888', 'empty → fallback');
  assert.equal(f(null), '#888', 'null → fallback');
  assert.equal(f('blue'), '#888', 'a bare keyword is not in the allow-list → fallback');
  assert.equal(f('#abc', '#000'), '#abc', 'a valid colour ignores the custom fallback');
  assert.equal(f('nope', '#000'), '#000', 'custom fallback honoured');
});
