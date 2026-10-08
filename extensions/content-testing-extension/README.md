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

### Banner Preview
Replaces the "Category Banner Live Preview" VS Code extension. Open it from the popup
(**Open Banner Preview**); it runs in its own tab (`banner-preview/index.html`).

- **Copy**: paste the banner HTML, either the contents of `.m-rte` or the whole `<a class="m-fwBanner">`
  copied from the site. Every viewport updates as you type (no reloads). One tab per language;
  the first language is the reference. The editor is a code editor (CodeMirror):
  - Syntax colors, line numbers, wrapping, auto-closing tags, folding, Ctrl+F search, undo per language.
  - **Class suggestions** inside `class="…"`, read from the live app.css: CSS value next to each, color
    swatches, and breakpoint/state prefixes (type `md:` to see only classes that exist at that breakpoint).
    Ctrl+Space opens them. Hover any class to see its CSS and the breakpoint it applies at.
  - Classes that aren't in app.css are underlined, with "did you mean" fixes (`pl-65` → `pl-64`, `pl-60`, `pl-70`).
  - Unclosed / stray tags are underlined in red.
  - **Format** (Shift+Alt+F) indents the HTML without changing how it renders: inline text and
    `span`/`strong`/`a` runs keep their exact spacing.
  - **Classes…** opens a reference: the brand color palette (every `text-`/`bg-`/`border-` class per color),
    typography, spacing, sizing, layout and components, filterable by breakpoint. Click to insert at the cursor.
- **Viewports**: the site's Tailwind breakpoints: XXS 320, XS 415, SM 576, MD 768, LG 992, XL 1210.
  Jump to one with the buttons under the toolbar (each has a status dot) or **Alt+1…9** in order
  (Alt+0 = Free width); the button for the viewport at the top of the preview is highlighted.
  *Breakpoint edges* adds 414/575/767/991/1023/1209; *Free width* is a tile you can drag to any width.
  Edit the list under Settings.
- **Background images**: desktop (≥1024), tablet/medium (576–1023), mobile/small (≤575). Drop a file,
  click to browse, or paste an https URL. Pasted full banners use their own images unless you set one.
- **Keep-out zones**: drag over the products/faces in each image. The image crops differently at every
  width (object-fit: cover), and zones follow it; any line of copy that touches a zone is flagged red.
  The editor also shows what part of the image is visible at the narrowest/widest width.
- **Center copy** (per image: horizontally, vertically or both): measures the empty space the copy sits in,
  from the banner edges to the nearest keep-out zone (where the objects begin), and draws the gaps on each
  side in px, plus a readout in the tile header. Green = balanced; amber = off by more than the tolerance
  (Settings, default 6px). It's a visual aid only (no warnings). For a different space, draw a *Copy area*
  in the zone editor.
- **Checks** under each tile: copy overlapping a zone, copy running outside the banner or a clipping box,
  horizontal scroll, banner taller than its set height, broken images, missing images.
- **Text expansion**: lengthen the copy (+15–100%, or *Smart*, which grows short strings more, like real
  translations) and add *Accents* (Ä É Š ą ł) to judge localized copy before you have it.
- **Check all languages**: renders every language at every viewport and shows a pass/fail grid;
  click a cell to jump to it. **Compare languages** shows all languages side by side at one width.
- **Snippet lint**: unclosed tags, images without alt, http:// images, English (`--enus`) assets left in
  another language, copy identical to the reference language.
- **Design overlays**: add the XD export or paste a screenshot (Ctrl+V). It's sized to the banner box
  (fit width / fit height / stretch / actual pixels) and shown on the viewport you pick, or on every
  viewport that uses the desktop, tablet or mobile image. Compare with *Overlay* (opacity, *Difference*),
  *Swipe* (hover across the tile) or *Below* (design under the build). Turn on *Move* to drag it into
  place; arrow keys nudge 1px (Shift = 10px). X/Y/Scale fields fine-tune it.
- **Banners**: each banner (copy, images, zones, designs) is saved in the browser. Use *Duplicate* for next
  month's version, *Export*/*Import file* to share a `.banner.json` with teammates, and
  *Import from tab…* (or **Import banner from this tab** in the popup) to pull a banner off a live or
  stage melaleuca.com page, as a new banner or as another language of the current one.
- **Templates**: Category banner (with height/width/alignment options matching the `m-fwBanner` modifiers),
  Mix-in ad, or your own page-context HTML (same `@@BANNER_SNIPPET@@` tokens as the VS Code extension).

Styles come from the live `app.css` and the brand font kits (editable under Settings), so the preview
matches production. Scripts in snippets don't run (extension pages block inline scripts).

#### Editor bundle
Chrome extensions can't load code from a CDN, so CodeMirror is bundled into
`banner-preview/vendor/codemirror.js`. Source and pinned versions are in `extensions/banner-editor-src/`;
to update: `cd extensions/banner-editor-src && npm install && npm run build`.

## Adding more tools
The popup is organised into tool cards (`<section class="card">` in popup.html) under a shared
header and on/off switch. Add a new card there, and its logic alongside the existing code.
Storage keys (`ignoreRules`, `showIgnored`, `enabled`) are unchanged from the original build, so
existing settings carry over.
