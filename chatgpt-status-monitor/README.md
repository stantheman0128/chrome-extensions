# Status Monitor for ChatGPT

A small widget that shows OpenAI / ChatGPT service status on `chatgpt.com`, using public data from [status.openai.com](https://status.openai.com). Architecture ported from `claude-status-monitor` and adapted to OpenAI's status backend.

Unofficial. Not affiliated with, endorsed by, or sponsored by OpenAI.

## Load it unpacked

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** and pick this folder.
3. Open `https://chatgpt.com`. A status badge appears bottom-right; click it for the dashboard.

## File map

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Injects on `chatgpt.com` / `chat.openai.com`, fetches `status.openai.com`. |
| `background.js` | Service worker. Fetches + caches the status API, builds the 30-day timeline, pushes updates on an alarm. |
| `content.js` | The whole UI: Shadow DOM, badge, two-column panel, timeline, incident cards, i18n, drag/resize. |
| `_locales/` | `en` and `zh_TW` extension name + description. |
| `icons/` | 16 / 32 / 48 / 128 px. |
| `store/` | Chrome Web Store submission pack: `LISTING.md`, icon, screenshots, promo tiles. |
| `DESCRIPTION.en.md` / `DESCRIPTION.md` | Long store description (EN / 繁中). |
| `PRIVACY.md` | Privacy policy. |

## Data source notes

OpenAI's status page is backed by incident.io behind a Statuspage-compatible API:

- `summary.json` and `incidents.json` work; `incidents/unresolved.json` returns 404, so active incidents come from `summary.incidents`.
- Incidents don't link to individual components, so the left column is one **overall** 30-day timeline (worst impact per day) plus a current-status list of each component, rather than per-component history.
- Uptime % counts only `major` / `critical` days as downtime; `minor` degradations still show on the timeline but don't zero out the day.

## Develop

No build step. Edit the source, then hit **Reload** on the extension card. To package for the store:

```
zip -r ../chatgpt-status-monitor-1.0.0.zip manifest.json background.js content.js icons _locales
```
