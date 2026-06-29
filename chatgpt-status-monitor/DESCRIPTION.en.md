Real-time OpenAI and ChatGPT service status on chatgpt.com, powered by public data from status.openai.com. The widget sits quietly in the corner of your ChatGPT tab and changes color the moment something breaks, so you can tell whether it's your connection or OpenAI before you waste time debugging.

**Features**

- Floating status badge in the corner, color-coded to the current state (green for operational, yellow for degraded, orange for partial outage, red for major outage)
- Click the badge for a two-column dashboard: a 30-day uptime timeline for OpenAI's services on the left, active incidents on the right
- Incident cards show the latest status (Monitoring / Identified / Investigating) and the outage duration; click to expand the full update history
- Hover any day on the timeline to preview that day's incidents; click a day to pin its full detail into the side panel
- Tracks every OpenAI component the status page reports: ChatGPT, Codex, Sora, Voice mode, Login, the API, and more
- Auto-refreshes every 30 seconds with a live "updated" timer and a manual refresh button
- Bilingual interface (English and Traditional Chinese) with a one-click toggle
- Draggable and resizable badge and panel, adjustable font size; every preference is saved locally
- Built with Shadow DOM, so it never touches or restyles the ChatGPT page itself

**How it works**

- Reads public service status from the OpenAI status API (`summary.json` and `incidents.json`). No account, no login, no personal data.
- A background service worker fetches and caches the data; the content script polls every 30 seconds so the badge stays current.

**Privacy**

This extension does not collect, transmit, or store any personal data. Your display preferences (badge position, panel size, font size, language) stay on your device through `chrome.storage.local`. There is no analytics, no tracking, and no third-party server.

**Unofficial**

This is an independent tool. It is not affiliated with, endorsed by, or sponsored by OpenAI. "ChatGPT" and "OpenAI" are trademarks of OpenAI, used here only to describe the service this tool monitors.
