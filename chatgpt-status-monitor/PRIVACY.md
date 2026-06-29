# Status Monitor for ChatGPT: Privacy Policy

**Last updated:** 2026-06-29

## Data Collection

This extension does not collect, transmit, or store any personal data.

## What This Extension Does

- **Status data**: Fetches public service status from OpenAI's status page ([status.openai.com](https://status.openai.com)). These requests contain no user data.
- **Local preferences**: UI settings (badge position, panel size, font size, display language, badge scale) are stored locally on your device through `chrome.storage.local`. They never leave your browser.

## Permissions

| Permission | Purpose |
|-----------|---------|
| `alarms` (permission) | Schedules a periodic status refresh every 30 seconds in the background |
| `storage` (permission) | Saves your UI preferences locally on your device |
| Host access to `status.openai.com` | Fetches public service status data from OpenAI's status page |
| Content script on `chatgpt.com`, `chat.openai.com` | Injects the status widget into the ChatGPT page |

## Third Parties

- No third-party analytics, advertising, or tracking.
- No data is sold or transferred to anyone.
- No data is used for anything beyond showing you OpenAI's service status.

## Affiliation

This extension is an independent project. It is not affiliated with, endorsed by, or sponsored by OpenAI. "ChatGPT" and "OpenAI" are trademarks of OpenAI.

## Contact

Questions about this policy: open an issue on the [GitHub repository](https://github.com/stantheman0128/chrome-extensions).
