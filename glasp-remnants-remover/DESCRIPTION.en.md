Automatically removes leftover UI elements that the Glasp extension injects into every web page. If you've uninstalled Glasp but still see its sidebar or highlights on websites, this extension silently cleans them up.

**Features**
- Works on all URLs (`<all_urls>`)
- Removes existing `.glasp-extension` elements on page load
- Uses `MutationObserver` to watch DOM changes and instantly remove dynamically injected elements
