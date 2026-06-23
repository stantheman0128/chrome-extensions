'use strict';

// The how-to "?" tour. The overlay lives inside the panel, whose transform makes it
// the containing block for the position:fixed layer — so coordinates are taken relative
// to the overlay's own rect, and every step re-measures the live element (so the ring
// and callout track it through window resizes). jsdom returns zero rects, so we stub
// getBoundingClientRect to exercise the spotlight-step path.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cst, document } = require('./helpers/setup');
const window = global.window;

function withStubbedRects(run) {
  const orig = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 10, right: 30, bottom: 30, width: 20, height: 20, x: 10, y: 10 };
  };
  try { run(); } finally { window.Element.prototype.getBoundingClientRect = orig; }
}

test('opening the tour spotlights step 1 and Next walks to the following step', () => {
  cst.resetState();
  cst.createPanel();
  cst.render();
  const overlay = document.querySelector('#cst-help-overlay');
  withStubbedRects(() => {
    document.querySelector('#cst-help').click();
    assert.equal(overlay.style.display, 'block', 'opening shows the overlay');
    assert.equal(typeof overlay._helpStep, 'function', 'step navigator is wired');
    assert.ok(overlay._ring, 'a spotlight ring element is created');
    assert.match(overlay._ring.getAttribute('style'), /9999px/, 'the ring dims everything around it');
    assert.match(overlay.textContent, /1 \/ \d/, 'starts on step 1 of N');
    const first = overlay.querySelector('strong').textContent;
    overlay._helpStep(1);
    assert.match(overlay.textContent, /2 \/ \d/, 'Next advances the counter');
    assert.notEqual(overlay.querySelector('strong').textContent, first, 'and re-queries a new target');
  });
});

test('a resize while open re-renders without throwing, and closing removes the listeners', () => {
  cst.resetState();
  cst.createPanel();
  cst.render();
  const overlay = document.querySelector('#cst-help-overlay');
  withStubbedRects(() => {
    document.querySelector('#cst-help').click();
    assert.equal(typeof overlay._helpCleanup, 'function', 'a reflow cleanup is registered while open');
    assert.doesNotThrow(() => window.dispatchEvent(new window.Event('resize')), 'resize re-measures safely');
    overlay.click();                                   // target === overlay → close
    assert.equal(overlay.style.display, 'none', 'closing hides the overlay');
    assert.equal(overlay._helpCleanup, null, 'and tears down the resize/scroll listeners');
  });
});
