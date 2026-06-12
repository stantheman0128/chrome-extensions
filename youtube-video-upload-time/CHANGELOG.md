# Changelog

## [9.6] - 2026-06-12

### Fixed
- **False-alarm console warning on Shorts**: "Could not find Shorts title element with any known selector" fired on every scan tick (~4×) during the first seconds of a Shorts page load. Root cause: the title overlay renders asynchronously ~4-5s after navigation, but the scanner treated every momentary miss as a selector failure. Title lookup is now silent; a single warning is emitted only if the title stays missing for 20s+ of consecutive scans (a real sign the selectors are outdated).
- **Active-reel detection updated for the 2026-06 Shorts DOM**: YouTube removed the `is-active` attribute and now keeps a single `ytd-reel-video-renderer` whose content is swapped in place on scroll. `findActiveShortsTitle()` now also scopes to that single reel (the legacy `[is-active]` path and in-viewport fallback are kept for older DOM variants).

### Added
- Tests (6): legacy `is-active` reel targeting, single-reel 2026-06 DOM regression, silent-miss behaviour, and the time-based warn-once/reset logic.

### Changed
- **Faster date loading.** When a fetch slot frees up, a scan is triggered immediately so cards waiting on the concurrency limit are picked up within ~300ms instead of waiting for the 3s safety-net poll. Concurrency raised 8 → 12. (Note: the v9.2 cache purge means every video refetches once; speed returns to instant as the new cache warms up.)

## [9.4] - 2026-06-12

### Changed
- **Icon replaced with Stan's hand-drawn artwork** (red YouTube-window clock + "YY-MM-DD" lettering), superseding the v9.3 script-generated design. Converted from the source photo via the new generic `tools/jpg-to-icons.js` (jpeg-js decode → center-crop → area-average resize → PNG). The v9.3 generator script was removed.

## [9.3] - 2026-06-12

### Fixed
- **Missing icon on the extensions page and toolbar**: the manifest declared no `icons` and no `action`, so Chrome fell back to the generic gray puzzle icon. Added `icons/icon{16,32,48,128}.png` plus `icons` and `action.default_icon`/`default_title` manifest entries (same structure as colonist-stats-tracker).

### Added
- `tools/generate-youtube-icons.js`: dependency-free Node script (built-in zlib PNG encoder, supersampled geometry) that regenerates all icon sizes. Design: YouTube-red rounded square with a white clock face, hands at 10:10.

## [9.2] - 2026-06-12

### Changed
- **Renamed** to "YouTube 精確時間" (en: "YouTube Precise Time").
- Cache now stores the raw ISO date string (`v2_` key prefix) instead of a pre-formatted local date, so watch/Shorts pages can show seconds while grid cards show date-only from the same entry.

### Fixed
- **Shorts scroll showing the first Short's date forever**: the date source read `<meta itemprop=...>` from `document.head`, which YouTube only writes on full page load and never updates during SPA navigation (including Shorts vertical scrolling). Page dates are now only trusted when they verifiably belong to the current video ID (head meta → initial full-load video only; JSON-LD → only when its `embedUrl`/`url` contains the video ID); otherwise the date is fetched per video ID.
- **Wrong dates being cached**: the stale-meta bug also wrote the first Short's date into the persistent cache under *other* videos' IDs (poisoning grid cards for up to 180 days). All legacy `v_` cache entries are purged once on update; the new `v2_` entries are only ever written from ID-verified sources.
- **Shorts badge not updating**: badges now carry `data-video-id` and are replaced whenever the URL's video ID changes — independent of whether `yt-navigate-finish` fires. The badge is also injected next to the *active* reel's title (`ytd-reel-video-renderer[is-active]` / in-viewport fallback) instead of the first title in the DOM, since the Shorts player keeps neighbouring reels mounted.
- **Watch page showing the previous video's date after SPA navigation**: same stale-meta root cause; the watch page now falls back to cache → fetch when the page date cannot be verified, and re-checks the URL before injecting async results.
- **Grid cards permanently missing dates**: when the same video appeared in two cards, the second card hit the `processingQueue` early-return with its processed mark already set and was never retried. Busy/duplicate cards are now unmarked and re-observed so the next scan picks them up from cache.

### Added
- Test suite (`tests/youtube-upload-time.test.js`): pure-function coverage plus regression tests proving stale head meta and mismatched JSON-LD are rejected.
- `content.js` exports its pure functions under CommonJS (same pattern as colonist-stats-tracker) to enable testing.

## [9.1] - 2026-04-11

### Added
- **Cache TTL mechanism**: Cache entries now include a `cachedAt` timestamp. Entries older than 180 days are automatically cleaned up on extension load.
- **DOM selector fallback system**: Added `findElement()` / `findElementWithWarn()` utilities that try multiple selectors in order, improving resilience against YouTube DOM changes.
- Fallback selectors for watch page info target and Shorts title element.

### Changed
- Cache storage format updated from `{ [videoId]: dateString }` to `{ [videoId]: { date: dateString, cachedAt: timestamp } }`.
- Legacy cache entries (old string format) are migrated by removal on cleanup, allowing re-caching in the new format on next view.

### Fixed
- Potential unbounded growth of `chrome.storage.local` from never-expiring cache entries.

## [9.0] - Previous release
- Renamed to YouTube Upload Time, added i18n and privacy policy.
