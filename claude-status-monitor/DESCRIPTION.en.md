Real-time Claude service status widget on Claude.ai (including Claude Code web), powered by [status.claude.com](https://status.claude.com).

**Features**

- Floating status badge in the bottom-right corner — color-coded to current status (green = operational, yellow = minor, orange = major, red = critical)
- Click the badge to open a two-column dashboard: left column shows 30-day uptime bar charts per component, right column shows active incidents
- Incident cards display the latest status (Monitoring / Identified / Investigating); click to expand the full update timeline
- Hover over bar charts to see the date and incident status for each day
- Click outside the panel to dismiss; smooth open/close animations
- Auto-refreshes every 30 seconds with a live footer timer and manual refresh button
- Bilingual UI (English / Traditional Chinese) with one-click language toggle
- Draggable badge and panel; resizable badge (drag edges to scale) and panel (drag edges/corners)
- Shadow DOM ensures complete style isolation — zero interference with Claude.ai's UI
- Claude-themed light palette design, consistent with Claude.ai's look and feel

**Technical Details**

- Fetches real-time status and history via Atlassian Statuspage public API (`summary.json`, `incidents/unresolved.json`, `incidents.json`)
- Service Worker (`background.js`) handles all API requests with caching (25s TTL) and supports forced refresh
- Content Script polls every 30 seconds + `chrome.alarms` pushes every 30 seconds to ensure data stays current
