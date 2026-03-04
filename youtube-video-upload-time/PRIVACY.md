# YouTube Upload Time — Privacy Policy

**Last updated:** 2025-03-04

## Data Collection

This extension **does not collect, transmit, or store any personal data**.

## What This Extension Does

- **Upload dates**: Fetches video upload dates by reading publicly accessible YouTube video pages. No user credentials or personal information are included in these requests.
- **Local cache**: Upload dates are cached locally on your device via `chrome.storage.local` to avoid redundant network requests. This cache never leaves your browser.

## Permissions Explained

| Permission | Purpose |
|-----------|---------|
| `storage` | Caches video upload dates locally on your device to reduce network traffic and improve performance |
| `content_scripts` (`youtube.com`) | Injects upload date displays into YouTube pages |

## Third Parties

- No third-party analytics, advertising, or tracking services are used.
- No data is sold or transferred to third parties.
- No data is used for purposes unrelated to the extension's core functionality.
- The extension only reads publicly available YouTube page content to extract upload dates.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/stantheman0128/stan-chrome-extensions).
