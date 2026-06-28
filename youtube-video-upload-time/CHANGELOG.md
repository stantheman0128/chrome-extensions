# Changelog

## [9.11] - 2026-06-19

### Fixed
- **False "YouTube DOM 可能已改版，選擇器需要更新" warning on perfectly healthy watch pages.** The watch-info miss tracker warned after 20s of consecutive misses, on the assumption that "missing 20s = selectors broke." That assumption is wrong: `WATCH_INFO_SELECTORS` already ends in the bare `ytd-watch-metadata`, so genuine selector rot (an inner `#info`/`#owner` rename) is caught by that fallback and the badge injects silently — which means the warning can *only* ever fire when the **entire metadata block is absent**. That is never selector rot; it's a transient/environmental state — still loading, an unavailable/members-only video, an ad, or (most commonly) a **backgrounded tab**, where the extension's scan timers keep running but the target legitimately isn't there. Confirmed on the live page that a watch tab reports `document.visibilityState === 'hidden'` whenever its Chrome window isn't focused (true even when it's the window's only tab), so opening a video and switching to another app before the metadata finished rendering left the scanner missing-and-counting in the background until it crossed 20s.
  - The shared `createMissTracker` now **ignores and resets** misses while `document.visibilityState === 'hidden'`, so the streak only accrues while the page is actually visible. A real "visible for 20s and the block still never rendered" miss still warns (verified by a regression test), so a future genuine DOM change is still surfaced. Gating on the explicit `'hidden'` state also covers Chrome's prerender (Prerender2 reports `'hidden'`).
  - The warning text was corrected to stop blaming the selectors as the definite cause: it now states the factual observation ("found nothing for Ns while visible") and lists the benign causes first, keeping "DOM may have changed" as a last possibility.
  - **No change to selector or injection logic** — the date badge still resolves and injects exactly as before; only the false-alarm console warning is affected. Fixes both the watch-info and Shorts-title trackers, which share `createMissTracker`.

### Added
- Tests (4): hidden-tab suppression past the threshold, streak not carrying across a hidden interval, the watch-info real-world background-tab false alarm, and a guard proving visible misses past the threshold still warn. (Repo suite: 187 green.)

## [9.10] - 2026-06-15

### Fixed
- **Chrome Web Store upload rejection: en description too long (223 > 132 chars).** The `en` locale's `extensionDescription` predated our work and exceeded the store's 132-char manifest description limit. Trimmed to 130 chars ("Show precise YouTube upload dates, down to the second on videos & Shorts. Works on home, subscriptions, history, playlists & more."). zh_TW (73 chars) and both names were already within limits.

## [9.9] - 2026-06-15

### Changed
- **Shorts date appears faster (fetch-on-arrival).** Two changes to cut the lag after scrolling to a new Short:
  - **Instant reaction to URL change.** A new `onUrlMaybeChanged()` (a cheap string compare) runs on both `yt-navigate-finish` and every DOM mutation, so the moment you land on a new Short / video the date fetch kicks off immediately instead of waiting up to 300ms for the next throttled scan. Robust for Shorts vertical scrolling, which doesn't reliably fire navigation events but always churns the DOM.
  - **Fetch decoupled from title render.** `injectShortsWatchDate()` previously returned early when the title overlay wasn't rendered yet (it renders ~4-5s after navigation), so the ~1s date fetch only *started* after the title appeared — serialized. The fetch now starts as soon as the Short's video ID is known and runs in parallel with the title rendering; the badge is injected once both are ready.
- **Note on true "preload the next Short":** investigated the live 2026-06 Shorts DOM and confirmed it's not feasible without fragile internal-API interception — only one reel is mounted, `ytInitialData` carries no upcoming IDs, and no preload/prefetch hints expose the next video. The next Short's ID simply doesn't exist in the page until YouTube fetches it on a real scroll gesture. So this ships the achievable "land → fetch immediately, overlapped" win instead.

## [9.8] - 2026-06-15

### Changed
- **Earlier prefetch for snappier perceived loading.** The grid's `IntersectionObserver` rootMargin widened 300px → 800px (`PREFETCH_MARGIN`), so a card's exact date is fetched well before it scrolls into view and is usually already shown by the time you reach it. Trade-off: a few cards you never scroll to may get fetched in the background. (The underlying cost — one fetch per uncached video — is inherent to reading exact dates from each watch page; cached videos remain instant.)

## [9.7] - 2026-06-15

### Fixed
- **Watch page "Could not find watch page info target" console spam**: `renderWatchBadge()` still used the old warn-every-call `findElementWithWarn`, so on a `/watch` page the warning fired on every scan tick during the few seconds the info block takes to render — the same false-alarm pattern v9.6 fixed for Shorts, but on the watch path. It now warns at most once per 20s streak of consecutive misses.

### Changed
- Extracted the v9.6 Shorts time-based warn-once logic into a shared `createMissTracker(label, getDetail)` factory; the Shorts title tracker and the new watch-info tracker are both instances of it. Removed the now-unused `findElementWithWarn`; watch-info selectors moved to a named `WATCH_INFO_SELECTORS` const.

### Added
- Tests (5): the shared `createMissTracker` factory (silent-before-threshold, warn-once, reset, independent instances) and the watch-info tracker's silent-delay / warn-once behaviour.

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
