Replaces YouTube's vague relative timestamps (e.g., *"2 years ago"*) with precise local upload dates and times, accurate to the second.

**Features**
- **Watch page** — Injects the exact date and time (e.g., `2023-04-15 09:32:07`) directly into the video info section, displayed alongside the view count
- **Home / Channel / Search results** — Uses `IntersectionObserver` to show precise upload dates next to video thumbnails, only fetching when videos enter the viewport
- **Stream reading** — Stops downloading as soon as the date is found, without waiting for the full page to transfer — dramatically reducing network traffic and memory usage
- **Persistent cache (`chrome.storage.local`)** — Dates persist across tabs and refreshes; revisiting a video shows the date instantly with zero network requests
- Displays dates in the user's local timezone
- Compatible with YouTube 2024+ new homepage UI (`yt-lockup-view-model`)
- Instantly updates after SPA navigation, no stale dates from previous videos
- Supports Shorts, playlists (Watch Later, Liked Videos), recommendations, subscriptions, watch history, and all other video-containing pages

**v9.0 Updates**
- Stream-reads HTML (`ReadableStream` scans chunk by chunk), calls `cancel()` as soon as the date is found — reduces per-fetch traffic from ~500KB to tens of KB
- `chrome.storage.local` persistent cache: dates survive tab closure, repeat browsing has near-zero overhead
- Fixed Watch History page date leaking into the description area (precisely targets `ytd-video-meta-block #metadata-line`)

**v8.0 Updates**
- Added support: recommendations sidebar (watch page right side), Watch Later, Liked Videos, custom playlists
- Added support: Shorts shelf (`ytd-reel-item-renderer`) and Shorts URL format parsing
- Fixed: recommendations not updating after SPA navigation (`yt-navigate-finish` triggers full clear and rescan)
- Added injection fallback targets (`#meta`, `#details`) for better compatibility with unknown page types
