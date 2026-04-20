# Changelog

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
