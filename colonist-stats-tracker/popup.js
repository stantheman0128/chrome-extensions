'use strict';

// MV3 popups disallow inline scripts (CSP), so the version is injected here
// from the manifest — a single source of truth, no hard-coded string to drift.
document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
