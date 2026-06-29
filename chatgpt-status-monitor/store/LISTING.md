# Chrome Web Store Submission Pack

Everything you paste into the Developer Dashboard for **Status Monitor for ChatGPT**. Copy each field as-is.

---

## 1. Store listing

**Product name** (manifest `name`, EN default locale): `Status Monitor for ChatGPT`
zh-TW locale name: `服務狀態監控 for ChatGPT`

**Summary / short description** (max 132 chars, this is `manifest.description`):

EN:
```
OpenAI / ChatGPT service status on chatgpt.com: 30-day uptime timeline, live incidents and outage alerts. Unofficial.
```
zh-TW:
```
在 chatgpt.com 即時顯示 OpenAI／ChatGPT 服務狀態：30 天運行時間軸、進行中事件與中斷提醒。非官方工具。
```

**Detailed description** (max 16,000 chars): paste the contents of `../DESCRIPTION.en.md` (English listing). Keep the **Unofficial** paragraph at the bottom. The Traditional Chinese version is in `../DESCRIPTION.md`.

**Category:** `Developer Tools` (alternative: `Productivity`).

**Language:** English (default). Traditional Chinese is supported in-product via `_locales`.

---

## 2. Single purpose

> This extension has one purpose: to display OpenAI's public service status (uptime history and live incidents from status.openai.com) as a small widget on chatgpt.com, so the user can see at a glance whether ChatGPT and related OpenAI services are operational.

---

## 3. Permission justifications

Paste one per permission in the dashboard's permission-justification fields.

- **`storage`**: Stores the user's own UI preferences (badge position, panel size, font size, language) locally via `chrome.storage.local`. No browsing data is stored.
- **`alarms`**: Schedules a background refresh of the public status data every 30 seconds so the badge stays current without the page needing focus.
- **Host permission `https://status.openai.com/*`**: The only network destination. The background service worker fetches OpenAI's public status JSON (`summary.json`, `incidents.json`) from here. No credentials are sent.
- **Content script on `chatgpt.com` / `chat.openai.com`**: Injects the read-only status widget into the ChatGPT tab. It does not read page content, form data, or messages; it only appends its own Shadow DOM element.

**Why no broad permissions:** no `tabs`, no `<all_urls>`, no `scripting`, no `webRequest`, no remote code. The host permission is a single status domain.

---

## 4. Privacy practices (dashboard "Privacy" tab)

**Data collection:** select **does not collect or use user data**. Nothing is collected, transmitted, or sold.

For each data-type checkbox (personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity, website content): leave **all unchecked**.

**Remote code:** `No, I am not using remote code` (Manifest V3, all code is in the package).

**Privacy policy URL:** required because the extension requests host/storage permissions. Host `PRIVACY.md` somewhere public and paste the URL. Options:
- GitHub raw/rendered: `https://github.com/stantheman0128/chrome-extensions/blob/master/chatgpt-status-monitor/PRIVACY.md`
- or any page you control.

**Limited Use certification:** check the three boxes confirming the data-use rules. This extension collects no data, so all are satisfied by default.

---

## 5. Assets (all generated, in this folder)

| Asset | File | Size | Required |
|---|---|---|---|
| Store icon | `store-icon-128.png` | 128×128 | Yes |
| Screenshot 1 | `screenshots/01-overview.png` | 1280×800 | Yes (min 1) |
| Screenshot 2 | `screenshots/02-timeline.png` | 1280×800 | |
| Screenshot 3 | `screenshots/03-components.png` | 1280×800 | |
| Screenshot 4 | `screenshots/04-bilingual.png` | 1280×800 | |
| Screenshot 5 | `screenshots/05-badge.png` | 1280×800 | |
| Small promo tile | `promo-small-440x280.png` | 440×280 | Recommended |
| Marquee promo | `promo-marquee-1400x560.png` | 1400×560 | Optional (featured) |

Raw, un-captioned panel screenshots are in `screenshots/raw-panel-en.png` and `raw-panel-zh.png` if you prefer a plainer look. Max 5 screenshots per listing.

---

## 6. Trademark / impersonation safeguards (already applied)

OpenAI polices its brand and Chrome rejects listings that imply an official relationship. This listing is built to avoid that:

- Name leads with the function (`Status Monitor`), uses `for ChatGPT` as a qualifier, not as the lead brand.
- Original icon (pulse line + status dot). No OpenAI logo or wordmark. The status green is a generic success green (`#16A34A`), deliberately not OpenAI's brand teal (`#10A37F`); the rest of the UI is monochrome black and white.
- An **Unofficial / not affiliated with OpenAI** line in the summary, the detailed description, and the privacy policy.
- "ChatGPT" / "OpenAI" used only descriptively (nominative use) to say what the tool monitors.

Disclaimer block (already in both DESCRIPTION files):
```
This is an independent tool. It is not affiliated with, endorsed by, or sponsored by OpenAI. "ChatGPT" and "OpenAI" are trademarks of OpenAI, used here only to describe the service this tool monitors.
```

---

## 7. Pre-submission checklist

- [ ] Bump nothing. First release is `1.0.0` in `manifest.json`.
- [ ] Zip the extension root (manifest.json, background.js, content.js, icons/, _locales/). Do **not** include `store/`, `DESCRIPTION*.md`, `PRIVACY.md`, `CHANGELOG.md`, or `README.md` in the zip.
- [ ] Upload zip, fill name/summary/description, pick category, set language.
- [ ] Upload icon + 1 to 5 screenshots + promo tile.
- [ ] Paste single-purpose + permission justifications.
- [ ] Privacy tab: no data collected, all checkboxes off, remote code = no, Limited Use certified.
- [ ] Paste the privacy policy URL.
- [ ] Submit for review.

Build the upload zip from the project root:
```
cd chatgpt-status-monitor
zip -r ../chatgpt-status-monitor-1.0.0.zip manifest.json background.js content.js icons _locales
```
