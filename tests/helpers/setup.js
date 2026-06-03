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
