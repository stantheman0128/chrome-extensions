'use strict';

// v1.29.0 — the dice-face view prefers colonist's REAL dice artwork once we've
// seen it in the roll log (self-healing, like RESOURCE_ICON), and falls back to
// the built-in SVG dice everywhere the real asset isn't available (preview.html,
// before the first roll, or a 404 after a colonist redeploy changes the hash).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');

function imgWith({ src = '', alt = '', cls = '' }) {
  const img = document.createElement('img');
  if (src) img.setAttribute('src', src);
  if (alt) img.setAttribute('alt', alt);
  if (cls) img.className = cls;
  return img;
}
const clearDiceCache = () => {
  for (const k of Object.keys(cst.DICE_ICON || {})) delete cst.DICE_ICON[k];
};

test('diceFromImg reads the face value AND caches a real dice image URL', () => {
  clearDiceCache();
  const real = imgWith({ src: 'https://cdn.colonist.io/dist/assets/dice_3.deadbeef1234.svg', alt: 'dice' });
  assert.equal(cst.diceFromImg(real), 3, 'reads the face value from the image');
  assert.equal(
    cst.DICE_ICON[3],
    'https://cdn.colonist.io/dist/assets/dice_3.deadbeef1234.svg',
    'caches the live (hashed) URL under its face value'
  );
});

test('diceFromImg does NOT cache when the value came from alt/class, not a dice image URL', () => {
  clearDiceCache();
  // alt matches (dice_5) but the src is an unrelated icon — must not poison the cache.
  const fake = imgWith({ src: 'https://cdn.colonist.io/dist/assets/icon_player.svg', alt: 'dice_5' });
  assert.equal(cst.diceFromImg(fake), 5, 'still reads the value from alt/class');
  assert.equal(cst.DICE_ICON[5], undefined, 'but never caches a non-dice URL');
});

test('dieFaceHTML uses the cached colonist image when present, else the built-in SVG', () => {
  clearDiceCache();
  // Nothing cached yet → self-drawn SVG die.
  const svg = cst.dieFaceHTML(4, 1.05);
  assert.match(svg, /<svg/, 'falls back to the self-drawn SVG die');
  assert.doesNotMatch(svg, /<img/, 'no <img> when nothing is cached');

  // Seed the cache the way a live roll would, then render → colonist's real art.
  cst.diceFromImg(imgWith({ src: 'https://cdn.colonist.io/dist/assets/dice_4.abc123.svg' }));
  const img = cst.dieFaceHTML(4, 1.05);
  assert.match(img, /<img[^>]+dice_4\.abc123\.svg/, 'uses colonist art once it has been seen');
});

test('dieFaceHTML strips quotes from the cached URL (no attribute breakout)', () => {
  clearDiceCache();
  cst.DICE_ICON[2] = 'https://x/dice_2.svg" onerror="alert(1)';
  const html = cst.dieFaceHTML(2, 1);
  assert.doesNotMatch(html, /onerror="/, 'the closing quote must be stripped so onerror can\'t break out');
});
