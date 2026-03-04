# Claude Status Monitor — Privacy Policy

**Last updated:** 2025-03-04

## Data Collection

This extension **does not collect, transmit, or store any personal data**.

## What This Extension Does

- **Status data**: Fetches service status from the public Anthropic status API ([status.claude.com](https://status.claude.com)). No user data is included in these requests.
- **Local preferences**: UI settings (badge position, panel size, font size, display language, badge scale) are stored locally on your device via `chrome.storage.local`. These preferences never leave your browser.

## Permissions Explained

| Permission | Purpose |
|-----------|---------|
| `alarms` | Schedules periodic status updates every 30 seconds in the background |
| `storage` | Saves your UI preferences locally on your device |
| `host_permissions` (`status.claude.com`) | Fetches public service status data from Anthropic's status page |
| `content_scripts` (`claude.ai`) | Injects the status widget UI into Claude.ai pages |

## Third Parties

- No third-party analytics, advertising, or tracking services are used.
- No data is sold or transferred to third parties.
- No data is used for purposes unrelated to the extension's core functionality.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/stantheman0128/stan-chrome-extensions).
