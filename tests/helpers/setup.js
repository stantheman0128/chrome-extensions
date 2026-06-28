'use strict';

// Test harness for the content-script parsing logic.
//
// content.js is a browser content script (an IIFE that reads the colonist DOM).
// To exercise its pure parsing functions under Node we:
//   1. stand up a jsdom document and expose the DOM globals content.js touches
//      (document/Node/NodeFilter) BEFORE requiring it, and
//   2. stub requestAnimationFrame to a no-op so renderSoon() never schedules
//      real work (there is no panel in tests, so render() early-returns anyway).
// content.js detects the CommonJS environment and skips boot()/observers,
// exporting the parsing functions instead.

const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.NodeFilter = dom.window.NodeFilter;
global.MutationObserver = dom.window.MutationObserver;
global.requestAnimationFrame = () => {};
// In a browser getComputedStyle is a bare global; jsdom only exposes it on
// window. Surface it so visibility checks (elVisible / ghost helpers) run.
global.getComputedStyle = (el) => dom.window.getComputedStyle(el);

// localStorage: a Map-backed stub so persistState/restoreState and the snapshot
// helpers work under Node. content.js reads it lazily (at call time), so installing
// it here once covers every test that requires this helper — no per-file re-stub.
// Only install if a test hasn't already provided its own (a few pre-seed or read
// their own backing Map directly); never overwrite and orphan their store.
if (!global.localStorage) {
  const __lsStore = new Map();
  global.localStorage = {
    getItem: (k) => (__lsStore.has(k) ? __lsStore.get(k) : null),
    setItem: (k, v) => __lsStore.set(k, String(v)),
    removeItem: (k) => __lsStore.delete(k),
  };
}

// Wire the WS board model as a global (content.js reads `__cstBoard`, the same
// global ws-inspector sets in the browser). Without a full state applied it stays
// not-ready, so the log/DOM paths are unaffected.
global.__cstBoard = require('../../colonist-stats-tracker/board.js');

const cst = require('../../colonist-stats-tracker/content.js');

// Turn a feedMessage outerHTML string (from fixtures) into the live element the
// parser expects to receive (the [class*="feedMessage"] node).
function makeMessage(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html.trim();
  return holder.querySelector('[class*="feedMessage"]');
}

// Convenience: process one or more fixture HTML strings against fresh state.
function feed(...htmls) {
  for (const html of htmls) cst.processMessage(makeMessage(html));
}

module.exports = { cst, makeMessage, feed, document };
