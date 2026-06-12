'use strict';

// Tests for youtube-video-upload-time/content.js pure logic.
//
// content.js is a browser content script. Like colonist-stats-tracker, it
// detects the CommonJS environment, skips boot() (observers / chrome.storage),
// and exports its pure functions instead.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'https://www.youtube.com/',
});
global.window = dom.window;
global.document = dom.window.document;

const yt = require('../youtube-video-upload-time/content.js');

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

// ---------- getVideoId ----------

test('getVideoId parses /watch?v=ID URLs', () => {
  assert.equal(yt.getVideoId('https://www.youtube.com/watch?v=abc123XYZ_-'), 'abc123XYZ_-');
});

test('getVideoId parses /shorts/ID URLs', () => {
  assert.equal(yt.getVideoId('https://www.youtube.com/shorts/sh0rtID9'), 'sh0rtID9');
  assert.equal(yt.getVideoId('https://www.youtube.com/shorts/sh0rtID9?feature=share'), 'sh0rtID9');
});

test('getVideoId returns null for non-video URLs', () => {
  assert.equal(yt.getVideoId('https://www.youtube.com/feed/history'), null);
  assert.equal(yt.getVideoId('not a url'), null);
});

// ---------- hasTimeComponent / convertToLocalTime ----------

test('hasTimeComponent distinguishes date-only from datetime strings', () => {
  assert.equal(yt.hasTimeComponent('2023-04-15T09:32:07+00:00'), true);
  assert.equal(yt.hasTimeComponent('2023-04-15'), false);
});

test('convertToLocalTime formats datetime with seconds when includeTime', () => {
  const out = yt.convertToLocalTime('2023-04-15T09:32:07+00:00', true);
  assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('convertToLocalTime returns null for invalid input', () => {
  assert.equal(yt.convertToLocalTime('garbage', true), null);
});

// ---------- extractDateFromHtml ----------

test('extractDateFromHtml finds meta itemprop datePublished', () => {
  const html = '<meta itemprop="datePublished" content="2023-04-15T09:32:07-07:00">';
  assert.equal(yt.extractDateFromHtml(html), '2023-04-15T09:32:07-07:00');
});

test('extractDateFromHtml finds JSON-LD uploadDate', () => {
  const html = '{"uploadDate":"2024-01-02T03:04:05+00:00"}';
  assert.equal(yt.extractDateFromHtml(html), '2024-01-02T03:04:05+00:00');
});

test('extractDateFromHtml finds ytInitialPlayerResponse publishDate', () => {
  const html = '"publishDate":"2024-01-02"';
  assert.equal(yt.extractDateFromHtml(html), '2024-01-02');
});

// ---------- getPageDateForVideo (the stale-meta regression) ----------

function setHeadMeta(date) {
  const meta = document.createElement('meta');
  meta.setAttribute('itemprop', 'datePublished');
  meta.setAttribute('content', date);
  document.head.appendChild(meta);
}

function setJsonLd(obj) {
  const s = document.createElement('script');
  s.setAttribute('type', 'application/ld+json');
  s.textContent = JSON.stringify(obj);
  document.body.appendChild(s);
}

test('trusts head meta tags for the initially loaded video', () => {
  setHeadMeta('2023-04-15T09:32:07-07:00');
  const raw = yt.getPageDateForVideo('vidA', /* trustHeadMeta */ true);
  assert.equal(raw, '2023-04-15T09:32:07-07:00');
});

test('REGRESSION: does NOT trust stale head meta after SPA navigation', () => {
  // Head meta still describes the FIRST video; we navigated (SPA) to vidB.
  setHeadMeta('2023-04-15T09:32:07-07:00');
  const raw = yt.getPageDateForVideo('vidB', /* trustHeadMeta */ false);
  assert.equal(raw, null); // must fall through to cache/fetch, never the stale date
});

test('accepts JSON-LD only when its embedUrl matches the requested video', () => {
  setJsonLd({
    embedUrl: 'https://www.youtube.com/embed/vidB',
    uploadDate: '2024-06-01T12:00:00+00:00',
  });
  assert.equal(
    yt.getPageDateForVideo('vidB', false),
    '2024-06-01T12:00:00+00:00'
  );
});

test('REGRESSION: rejects JSON-LD belonging to a different video', () => {
  setJsonLd({
    embedUrl: 'https://www.youtube.com/embed/vidA',
    uploadDate: '2023-04-15T09:32:07-07:00',
  });
  assert.equal(yt.getPageDateForVideo('vidB', false), null);
});

test('prefers datetime-bearing meta over date-only meta when trusted', () => {
  const upload = document.createElement('meta');
  upload.setAttribute('itemprop', 'uploadDate');
  upload.setAttribute('content', '2023-04-15T09:32:07-07:00');
  document.head.appendChild(upload);
  setHeadMeta('2023-04-15'); // datePublished date-only
  assert.equal(yt.getPageDateForVideo('vidA', true), '2023-04-15T09:32:07-07:00');
});

// ---------- findActiveShortsTitle ----------

function buildReel({ isActive = false, title = 'A title' } = {}) {
  const reel = document.createElement('ytd-reel-video-renderer');
  if (isActive) reel.setAttribute('is-active', '');
  const titleModel = document.createElement('yt-shorts-video-title-view-model');
  const h2 = document.createElement('h2');
  h2.className = 'ytShortsVideoTitleViewModelShortsVideoTitle';
  h2.textContent = title;
  titleModel.appendChild(h2);
  reel.appendChild(titleModel);
  document.body.appendChild(reel);
  return reel;
}

function captureWarns(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => warns.push(args);
  try { fn(); } finally { console.warn = orig; }
  return warns;
}

test('finds the active reel title in legacy multi-reel DOM (is-active)', () => {
  buildReel({ title: 'previous short' });
  buildReel({ isActive: true, title: 'current short' });
  buildReel({ title: 'next short' });
  const el = yt.findActiveShortsTitle();
  assert.equal(el.textContent, 'current short');
});

test('REGRESSION (2026-06 DOM): finds title in the single reel without is-active, silently', () => {
  // YouTube 改版後 DOM 只保留一個 reel 容器，且不再標 is-active
  buildReel({ title: 'only short' });
  let el;
  const warns = captureWarns(() => { el = yt.findActiveShortsTitle(); });
  assert.equal(el && el.textContent, 'only short');
  assert.equal(warns.length, 0);
});

test('REGRESSION: returns null WITHOUT warning when title not yet rendered', () => {
  // 載入初期標題尚未渲染屬正常，不該每次掃描都對 console 噴警告
  let el;
  const warns = captureWarns(() => { el = yt.findActiveShortsTitle(); });
  assert.equal(el, null);
  assert.equal(warns.length, 0);
});

// ---------- Shorts title miss warning (time-based, once per streak) ----------

test('noteShortsTitleMiss stays silent during normal render delay', () => {
  yt.resetShortsTitleMiss();
  const warns = captureWarns(() => {
    yt.noteShortsTitleMiss(1000);
    yt.noteShortsTitleMiss(1000 + yt.SHORTS_TITLE_WARN_AFTER_MS - 1);
  });
  assert.equal(warns.length, 0);
});

test('noteShortsTitleMiss warns exactly once after the threshold elapses', () => {
  yt.resetShortsTitleMiss();
  const warns = captureWarns(() => {
    yt.noteShortsTitleMiss(1000);
    yt.noteShortsTitleMiss(1000 + yt.SHORTS_TITLE_WARN_AFTER_MS);     // 應警告
    yt.noteShortsTitleMiss(1000 + yt.SHORTS_TITLE_WARN_AFTER_MS * 2); // 不重複警告
  });
  assert.equal(warns.length, 1);
});

test('resetShortsTitleMiss restarts the streak (success in between)', () => {
  yt.resetShortsTitleMiss();
  const warns = captureWarns(() => {
    yt.noteShortsTitleMiss(1000);
    yt.resetShortsTitleMiss(); // 找到標題 → 重新計時
    yt.noteShortsTitleMiss(1000 + yt.SHORTS_TITLE_WARN_AFTER_MS + 5000);
  });
  assert.equal(warns.length, 0);
});
