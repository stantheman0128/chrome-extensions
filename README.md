# Stan Chrome Extensions

A collection of lightweight Chrome extensions built with Manifest V3.

---

## Extensions

### 1. Glasp Remnants Remover

**Location:** `glasp-remnants-remover/`

Automatically removes leftover UI elements injected by the Glasp extension from every page you visit. If you've uninstalled Glasp but still see its sidebar or highlight markers on websites, this extension silently cleans them up.

**Features**
- Runs on all URLs (`<all_urls>`)
- Cleans up existing `.glasp-extension` elements when the page loads
- Uses a `MutationObserver` to remove any elements that Glasp injects dynamically after load

**How to install**
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `glasp-remnants-remover` folder

---

### 2. YouTube Exact Upload Date

**Location:** `youtube-video-upload-time/`

Replaces YouTube's vague relative timestamps (e.g. *"2 years ago"*) with the precise local upload date and time, accurate to the second.

**Features**
- **Watch page** – injects the exact date & time (e.g. `2023-04-15 09:32:07`) directly into the video info bar
- **Homepage / Channel / Search listings** – fetches and displays the exact upload date next to each video thumbnail via an `IntersectionObserver` (only fetches when a video scrolls into view)
- Caches fetched dates to avoid redundant network requests
- Displays dates in your local timezone

**How to install**
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `youtube-video-upload-time` folder

---

## Repository Structure

```
stan-chrome-extensions/
├── glasp-remnants-remover/
│   ├── manifest.json
│   └── content.js
└── youtube-video-upload-time/
    ├── manifest.json
    └── content.js
```

## Contributing

Pull requests are welcome. Please keep each extension self-contained inside its own folder.

## License

MIT
