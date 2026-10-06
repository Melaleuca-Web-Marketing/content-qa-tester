# Melaleuca Content Testing Tools (browser extension)

Companion to the Content QA Tester. Lives in `extensions/content-testing-extension/`.
Load: chrome://extensions -> Developer mode -> Load unpacked -> pick this folder.

## Tools

### Culture Links
- Red glow + label: link goes to a different culture than the page (e.g. ie link on pl site).
- Orange dashed: stage page links to a production host (right culture, wrong environment).
- Bottom-right badge shows the count; click it to jump through offenders.
- Hover a flagged link to see the full URL in the tooltip.

Hosts understood: `www.melaleuca.com` (US), `xx.melaleuca.com` and `productstore2-xx-preview.melaleuca.com`.
GB and UK are treated as the same culture. Edit ALIASES / parseHost in content.js if the UK
site uses a different code.

## Adding more tools
The popup is organised into tool cards (`<section class="card">` in popup.html) under a shared
header and on/off switch. Add a new card there, and its logic alongside the existing code.
Storage keys (`ignoreRules`, `showIgnored`, `enabled`) are unchanged from the original build, so
existing settings carry over.
