// Builds the preview documents that go into each viewport iframe.
//
// The snippet is placed between two comment markers (<!--bp-start--> / <!--bp-end-->) so later
// edits can be swapped in place without reloading the iframe (and re-parsing app.css), and
// without adding a wrapper element that could break `.m-rte > p` style selectors.

export const SLOT_INFO = {
  desktop: { label: "Desktop", },
  medium: { label: "Tablet / medium" },
  small: { label: "Mobile / small" },
};

// Which background image each template shows at a given viewport width.
const RULES = {
  category: [
    { slot: "desktop", min: 1024, hint: "≥ 1024px" },
    { slot: "medium", min: 576, hint: "576–1023px" },
    { slot: "small", min: 0, hint: "≤ 575px" },
  ],
  mixin: [
    { slot: "desktop", min: 576, hint: "≥ 576px" },
    { slot: "small", min: 0, hint: "≤ 575px" },
  ],
};

export const rulesFor = (templateId) => RULES[templateId === "mixin" ? "mixin" : "category"];
export const slotForWidth = (templateId, w) => rulesFor(templateId).find((r) => w >= r.min).slot;

export const LAYOUT_OPTIONS = {
  height: [["-h-sm", "Small (192px)"], ["-h-sm-md", "Small-medium (220px)"], ["-h-md", "Medium (272px)"], ["-h-lg", "Large (380px)"]],
  width: [["", "None"], ["-w-xs", "XS"], ["-w-sm", "SM"], ["-w-md", "MD"], ["-w-lg", "LG"], ["-w-xl", "XL"]],
  align: [["-left", "Left"], ["-center", "Center"], ["-right", "Right"]],
  valign: [["", "Default"], ["-top", "Top"], ["-middle", "Middle"], ["-bottom", "Bottom"]],
};

const CATEGORY_BODY = `
<div class="p-catListing__main"><div class="p-catListing__banner"><div>
  <a href="#" data-testid="link-fullWidthBanner" class="m-fwBanner @@BANNER_CLASSES@@">
    <div class="m-fwBanner__row -media">
      <picture class="a-genImg">
        <source srcset="@@BANNER_DESKTOP@@" media="(min-width: 1024px)">
        <source srcset="@@BANNER_MEDIUM@@" media="(min-width: 576px)">
        <source srcset="@@BANNER_SMALL@@" media="(max-width: 575px)">
        <img src="@@BANNER_DESKTOP@@" alt="" class="a-genImg__img">
      </picture>
    </div>
    <div class="m-fwBanner__row -columns @@ROW_CLASSES@@">
      <div class="m-fwBanner__columns"><div class="m-fwBanner__col -content"><div class="m-fwBanner__rte">
        <div class="m-rte">@@BANNER_SNIPPET@@</div>
      </div></div></div>
    </div>
  </a>
</div></div></div>`;

// ---- Mix-In Ads ----------------------------------------------------------------
// A mix-in ad is one card in the category page's product grid (2 per row, 3 at ≥992px, 4 at ≥1210px,
// beside the filter sidebar from 768px), max 230px wide and 450px tall. It's rendered in that grid,
// next to real product cards, so its width and row height match production at every viewport.
const MIXIN_AD = `
<article class="m-mixinAd -variant3">
  <div aria-hidden="true" class="m-mixinAd__bg" style="background-image: url('@@BANNER_DESKTOP@@')"></div>
  <a href="#" aria-label="" class="m-mixinAd__row -content">
    <div class="m-mixinAd__header"><div class="m-mixinAd__headline">@@BANNER_SNIPPET@@</div></div>
  </a>
</article>`;

const PRODUCTS = [
  ["32995h-01-enus.png", "Revive™ Room Spray Refill", "$6.79", "$10.00", "3 Points"],
  ["33985h-01-enus.png", "Revive™ Room Spray Refill 2-Pack", "$11.99", "$20.00", "5 Points"],
  ["33964h-01-enus.png", "Revive™ Room Spray Starter Pack", "$16.99", "$27.00", "8 Points"],
].map(([img, title, member, non, points]) => `
<li class="p-catListing__col bp-neighbor"><article class="m-prodCard -grid">
  <a href="#" class="m-prodCard__row -content">
    <div class="m-prodCard__header">
      <div class="m-prodCard__media"><img src="https://cdnsc1.melaleuca.com/cdn-cgi/image/width=200,height=200,quality=85/global/products/${img}" alt="" class="m-prodCard__hero"></div>
      <div class="m-prodCard__heading"><em class="m-prodCard__title">${title}</em></div>
      <div class="m-prodCard__shop">Shop 3 Options</div>
    </div>
    <div class="m-prodCard__body"><div class="m-prodCard__content -top"><div class="m-prodCard__save"></div></div>
      <div class="m-prodCard__content -bottom">
        <div class="m-prodCard__pricing"><div class="text-xs text-gray leading-tight">
          <div><span class="text-gray-150 text-xl font-bold">${member}</span> <span>Member</span></div>
          <div><span class="text-base font-bold">${non}</span> <span>Non-Member</span></div>
        </div></div>
        <div class="m-prodCard__points"><span class="m-prodCard__text -points">${points}</span></div>
      </div>
    </div>
  </a>
  <div class="m-prodCard__row -actions"><div class="m-prodCard__button -shelfToggle">
    <button type="button" class="a-button justify-center -shelfToggle w-full"><span class="sr-only md:not-sr-only md:block">SELECT</span></button>
  </div></div>
</article></li>`).join("");

function mixinGrid(cell, neighbors) {
  return `
<style>
  @media (max-width: 575px) { .m-mixinAd__bg { background-image: url("@@BANNER_SMALL_CSS@@") !important; } }
  .bp-side { display: none; }
  @media (min-width: 768px) { .bp-side { display: block; height: 220px; border-radius: 4px; background: repeating-linear-gradient(180deg, #f1f3f6 0 18px, transparent 18px 30px); } }
</style>
<div class="p-catListing">
  <div class="p-catListing__side"><div class="bp-side" title="Filter menu"></div></div>
  <div class="p-catListing__main"><div class="p-catListing__results"><ul class="p-catListing__grid">${cell}${neighbors ? PRODUCTS : ""}</ul></div></div>
</div>`;
}

// ---- Hero carousel slides ----------------------------------------------------------
// A homepage hero slide is an m-fwBanner (-slide -stackMobile) inside the Slick carousel. The structure
// below mirrors production (.o-heroCarousel) so app.css positions the arrows and the dots/pause pill
// exactly where they sit live. The button is CMS-generated outside the authored HTML: only its color
// class, text and link (the slide's href) are set, and it centers on the copy column.
const HERO_CTA = `<div class="@@CTA_WRAP_CLASSES@@" style="@@CTA_WRAP_STYLE@@"><div class="@@CTA_CLASSES@@" style="@@CTA_STYLE@@">@@CTA_TEXT@@</div></div>`;

// The button markup the CMS produces. Slides imported from Optimizely keep their exact classes and inline
// styles (which can include extra margin someone added to nudge the copy); everything else uses these.
export const CTA_DEFAULT_CLASSES = "a-authorBtn text-center -default bg-green rounded-full px-36 to-sm:px-36 md:px-36";
export const CTA_DEFAULT_WRAP = "m-fwBanner__cta -center";
const CTA_STANDARD = /^(a-authorBtn|text-center|-default|-tiny|-xs|-sm|-md|-lg|rounded-full|bg-[\w-]+|(?:[\w-]+:)?px-\d+|m-fwBanner__cta|-center|-left|-right)$/;

/** Button class string with the chosen color. */
export function ctaClasses(cta) {
  const base = (cta && cta.classes) || CTA_DEFAULT_CLASSES;
  return base.split(/\s+/).filter((c) => c && !/^bg-/.test(c)).concat((cta && cta.color) || "bg-green").join(" ");
}

/** Classes and inline styles on the button/wrapper beyond what the CMS normally outputs (e.g. Optimizely nudges). */
export function ctaExtras(cta) {
  if (!cta) return [];
  const extra = (s) => (s || "").split(/\s+/).filter((c) => c && !CTA_STANDARD.test(c));
  return [
    ...extra(cta.classes).map((c) => ({ kind: "class", on: "button", value: c })),
    ...extra(cta.wrapClasses).map((c) => ({ kind: "class", on: "wrapper", value: c })),
    ...(cta.style ? [{ kind: "style", on: "button", value: cta.style }] : []),
    ...(cta.wrapStyle ? [{ kind: "style", on: "wrapper", value: cta.wrapStyle }] : []),
  ];
}

const HERO_SLIDE = `
<a href="@@BANNER_HREF@@" class="m-fwBanner @@BANNER_CLASSES@@ -slide -stackMobile">
  <div class="m-fwBanner__row -media">
    <picture class="a-genImg">
      <source srcset="@@BANNER_DESKTOP@@" media="(min-width: 1024px)">
      <source srcset="@@BANNER_MEDIUM@@" media="(min-width: 768px)">
      <source srcset="@@BANNER_MEDIUM@@" media="(min-width: 576px)">
      <source srcset="@@BANNER_SMALL@@" media="(max-width: 575px)">
      <img src="@@BANNER_DESKTOP@@" alt="" class="a-genImg__img">
    </picture>
  </div>
  <div class="m-fwBanner__row -columns @@ROW_CLASSES@@">
    <div class="m-fwBanner__columns"><div class="m-fwBanner__col -content">
      <div class="m-fwBanner__rte"><div class="m-rte">@@BANNER_SNIPPET@@</div></div>
      ${HERO_CTA}
    </div></div>
  </div>
</a>`;

function heroCarousel(slide) {
  const dots = [0, 1, 2, 3, 4, 5, 6].map((i) => `<li${i ? "" : ' class="slick-active"'}><button type="button">${i + 1}</button></li>`).join("");
  return `
<div class="o-heroCarousel">
  <nav class="o-heroCarousel__actions"><div class="o-heroCarousel__dots">
    <button type="button" class="o-heroCarousel__playPause" aria-label="Stop automatic slide show."><span class="o-heroCarousel__label sr-only"></span></button>
    <ul class="slick-dots">${dots}</ul>
  </div></nav>
  <div class="o-heroCarousel__slider slick-initialized slick-slider slick-dotted">
    <!-- Slick's JS puts this transform on the track; it keeps the slide (z-index:1) below the arrows and dots. -->
    <div class="slick-list"><div class="slick-track" style="opacity:1;transform:translate3d(0px,0px,0px);width:100%">
      <div class="slick-slide slick-current slick-active" style="width:100%"><div><div>${slide}</div></div></div>
    </div></div>
  </div>
  <div class="o-heroCarousel__arrows">
    <button type="button" class="slick-prev slick-arrow" aria-label="Previous Slide">Previous Slide</button>
    <button type="button" class="slick-next slick-arrow" aria-label="Next Slide">Next Slide</button>
  </div>
</div>`;
}

/** The carousel controls drawn over a slide (for overlap checks), with readable names. */
export const HERO_CONTROLS = [
  [".o-heroCarousel__arrows .slick-prev", "previous-slide arrow"],
  [".o-heroCarousel__arrows .slick-next", "next-slide arrow"],
  [".o-heroCarousel__dots", "dots / pause control"],
];

export const CTA_COLORS = [
  ["bg-green", "Green"], ["bg-dark", "Dark"], ["bg-white", "White (green outline)"], ["bg-dark-secondary", "Dark outline"],
  ["bg-white-secondary", "White outline"], ["bg-yellow", "Yellow"], ["bg-gray", "Gray"], ["bg-clear", "Clear"],
];

// Used when the pasted snippet is a whole banner (<a class="m-fwBanner">…) copied from the site.
const FULL_BODY = `<div class="p-catListing__main"><div class="p-catListing__banner">@@BANNER_SNIPPET@@</div></div>`;

export const BUILTIN_TEMPLATES = [
  { id: "category", name: "Category banner", tool: "banner" },
  { id: "mixin", name: "Mix-in ad in the product grid", tool: "mixin" },
  { id: "hero", name: "Hero carousel slide (home page)", tool: "hero" },
];

/**
 * What a pasted whole element is: "hero" for an <a class="m-fwBanner -slide">, "banner" for another
 * m-fwBanner, "mixin" for an <article class="m-mixinAd">; null for plain copy.
 */
export function snippetKind(html) {
  const m = /class\s*=\s*["']([^"']*\b(?:m-fwBanner|m-mixinAd)\b[^"']*)["']/.exec(html || "");
  if (!m) return null;
  if (/\bm-mixinAd\b/.test(m[1])) return "mixin";
  return /(^|\s)-slide(\s|$)/.test(m[1]) ? "hero" : "banner";
}

/** Is this a whole banner/ad (rather than just its copy)? With a tool, only that tool's kind counts. */
export const isFullBanner = (html, tool) => (tool ? snippetKind(html) === tool : !!snippetKind(html));

const BASE_STYLE = `<style id="__bp_base">
html,body{margin:0;background:#fff;color:#000;overflow:hidden;height:auto!important;min-height:0!important}
body{display:flow-root}
</style>`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// <style> is raw text (entities aren't decoded), so percent-encode anything that could end url("…").
const cssUrl = (u) => String(u).replace(/["'()\\\n]/g, encodeURIComponent);

// Mid-gray so both white and dark copy stay readable before an image is added.
export function placeholderImage(label, w = 1200, h = 300) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="24" fill="#8f98a8"/></pattern></defs><rect width="100%" height="100%" fill="#9aa3b2"/><rect width="100%" height="100%" fill="url(#p)"/><text x="50%" y="${h - 40}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${Math.round(w / 24)}" fill="#eef1f5">${label}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function stripScripts(html) {
  return html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/?>/gi, "");
}

/**
 * Full preview document for one iframe.
 * opts: { template, customHtml, layout, full, neighbors, cta: {color, text, href}, stylesheets, baseHref, lang, images, content }
 */
export function buildPage(opts) {
  const { layout = {}, images } = opts;
  const content = "<!--bp-start-->" + (opts.content || "") + "<!--bp-end-->";
  const links = opts.stylesheets.map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join("\n");
  const base = opts.baseHref ? `<base href="${esc(opts.baseHref)}">` : "";

  let page;
  if (opts.customHtml && !opts.full) {
    page = stripScripts(opts.customHtml);
    if (!/@@BANNER_SNIPPET@@/.test(page)) page = page.replace(/<\/body>/i, "@@BANNER_SNIPPET@@</body>");
    if (/<!--\s*BRAND_CSS\s*-->/.test(page)) page = page.replace(/<!--\s*BRAND_CSS\s*-->/, links);
    const head = (base && !/<base\s/i.test(page) ? base : "") + BASE_STYLE;
    page = /<head[^>]*>/i.test(page)
      ? page.replace(/<head([^>]*)>/i, (m) => m + head)
      : head + page;
    page = page.replace(/<html([^>]*)>/i, (m, attrs) => "<html" + attrs.replace(/\slang=("[^"]*"|'[^']*')/i, "") + ` lang="${esc(opts.lang)}">`);
  } else {
    let body;
    if (opts.template === "mixin") {
      // A pasted whole ad may or may not include its grid cell (<li class="p-catListing__col">).
      const cell = !opts.full ? `<li class="p-catListing__col">${MIXIN_AD}</li>`
        : /p-catListing__col/.test(opts.content || "") ? "@@BANNER_SNIPPET@@" : `<li class="p-catListing__col">@@BANNER_SNIPPET@@</li>`;
      body = mixinGrid(cell, opts.neighbors !== false);
    } else if (opts.template === "hero") {
      body = heroCarousel(opts.full ? "@@BANNER_SNIPPET@@" : HERO_SLIDE);
    } else body = opts.full ? FULL_BODY : CATEGORY_BODY;
    page = `<!DOCTYPE html><html lang="${esc(opts.lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${base}
${links}${BASE_STYLE}</head><body>${body}</body></html>`;
  }

  const rowClasses = [layout.width, layout.align, layout.valign, layout.extra].filter(Boolean).join(" ");
  return page
    .replace(/@@BANNER_CLASSES@@/g, esc(layout.height || "-h-sm"))
    .replace(/@@ROW_CLASSES@@/g, esc(rowClasses))
    .replace(/@@BANNER_HREF@@/g, esc(opts.cta && opts.cta.href ? opts.cta.href : "#"))
    .replace(/@@CTA_CLASSES@@/g, esc(ctaClasses(opts.cta)))
    .replace(/@@CTA_STYLE@@/g, esc((opts.cta && opts.cta.style) || ""))
    .replace(/@@CTA_WRAP_CLASSES@@/g, esc((opts.cta && opts.cta.wrapClasses) || CTA_DEFAULT_WRAP))
    .replace(/@@CTA_WRAP_STYLE@@/g, esc((opts.cta && opts.cta.wrapStyle) || ""))
    .replace(/@@CTA_TEXT@@/g, () => escText((opts.cta && opts.cta.text) || ""))
    .replace(/@@BANNER_DESKTOP@@/g, esc(images.desktop))
    .replace(/@@BANNER_MEDIUM@@/g, esc(images.medium))
    .replace(/@@BANNER_SMALL@@/g, esc(images.small))
    .replace(/@@BANNER_SMALL_CSS@@/g, cssUrl(images.small))
    .replace("@@BANNER_SNIPPET@@", () => content);
}

/** Swaps the snippet in an already-loaded preview document. Returns false if markers are gone. */
export function setContent(doc, html) {
  const it = doc.createNodeIterator(doc.body || doc.documentElement, NodeFilter.SHOW_COMMENT);
  let start = null, end = null, n;
  while ((n = it.nextNode())) {
    if (n.data === "bp-start") start = n;
    else if (n.data === "bp-end" && start) { end = n; break; }
  }
  if (!start || !end || start.parentNode !== end.parentNode) return false;
  while (start.nextSibling && start.nextSibling !== end) start.nextSibling.remove();
  const range = doc.createRange();
  range.selectNode(start);
  end.parentNode.insertBefore(range.createContextualFragment(stripScripts(html)), end);
  return true;
}

/** All nodes between the markers (the snippet's top-level nodes). */
export function contentNodes(doc) {
  const out = [];
  const it = doc.createNodeIterator(doc.body || doc.documentElement, NodeFilter.SHOW_COMMENT);
  let n, start = null;
  while ((n = it.nextNode())) if (n.data === "bp-start") { start = n; break; }
  for (let s = start && start.nextSibling; s && !(s.nodeType === 8 && s.data === "bp-end"); s = s.nextSibling) out.push(s);
  return out;
}

// ---- snippet image handling (full-banner pastes) ----------------------------
function slotForMedia(media) {
  const m = (media || "").replace(/\s+/g, "");
  if (/min-width:1024px/.test(m)) return "desktop";
  if (/min-width:(768|576)px/.test(m)) return "medium";
  if (/max-width:(575|576)px/.test(m)) return "small";
  return null;
}

const firstSrc = (srcset) => (srcset || "").trim().split(/\s*,\s*/)[0].split(/\s+/)[0];

/** Background image URLs found inside a pasted full banner. */
export function snippetImages(html) {
  const out = {};
  if (!isFullBanner(html)) return out;
  const t = document.createElement("template");
  t.innerHTML = html;
  const pic = t.content.querySelector(".m-fwBanner__row.-media picture, picture.a-genImg");
  if (pic) {
    for (const s of pic.querySelectorAll("source")) {
      const slot = slotForMedia(s.getAttribute("media"));
      const src = firstSrc(s.getAttribute("srcset") || s.getAttribute("data-srcset"));
      if (slot && src && !out[slot]) out[slot] = src;
    }
    const img = pic.querySelector("img");
    const src = img && (img.getAttribute("src") || img.getAttribute("data-src"));
    if (src && !out.desktop) out.desktop = src;
  }
  const bg = t.content.querySelector(".m-mixinAd__bg");
  const m = bg && /url\(\s*['"]?([^'")]+)/.exec(bg.getAttribute("style") || "");
  if (m && !out.desktop) out.desktop = m[1];
  return out;
}

// ---- text expansion (simulates longer localized copy) -----------------------
// "smart" follows the common IBM guideline: short strings grow far more than long ones.
function smartFactor(len) {
  if (len <= 10) return 1.0;
  if (len <= 20) return 0.8;
  if (len <= 30) return 0.6;
  if (len <= 50) return 0.5;
  if (len <= 70) return 0.4;
  return 0.3;
}

// Diacritics above capitals and below the baseline catch clipped line-heights (de, pl, lt, fr).
const ACCENTS = { a: "ą", A: "Ä", e: "ė", E: "É", i: "į", I: "Í", o: "ö", O: "Ö", u: "ų", U: "Ü", c: "ç", C: "Ç", n: "ñ", N: "Ñ", s: "š", S: "Š", z: "ž", Z: "Ž", y: "ý", Y: "Ý", g: "ģ", l: "ł" };
const accent = (s) => s.replace(/[aAeEiIoOuUcCnNsSzZyYgl]/g, (c) => ACCENTS[c] || c);

const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,div,td,th,a,button,figcaption,blockquote";

function expandText(text, factor, blockLen, useAccents) {
  const core = text.trim();
  if (!core) return text;
  const f = factor === "smart" ? smartFactor(blockLen) : Number(factor) / 100;
  let out = core;
  if (f > 0) {
    const words = core.split(/\s+/).filter((w) => /\w/.test(w));
    const target = Math.round(core.length * (1 + f));
    let i = 0;
    while (words.length && out.length < target) {
      const w = words[i++ % words.length];
      out += " " + (out.length + 1 + w.length > target + 3 ? w.slice(0, Math.max(2, target - out.length - 1)) : w);
    }
  }
  if (useAccents) out = accent(out);
  const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
  return lead + out + trail;
}

/** Expansion / accents for a plain string, e.g. a hero slide's button text. */
export function expandPlain(text, { expansion = "off", accents = false } = {}) {
  if ((expansion === "off" && !accents) || !text) return text;
  return expandText(text, expansion, text.trim().length, accents);
}

/**
 * Snippet HTML as it should be rendered: images in full-banner pastes swapped for the configured
 * ones, and text optionally expanded / accented.
 */
export function prepareSnippet(html, { expansion = "off", accents = false, images = null } = {}) {
  const needsText = expansion !== "off" || accents;
  const lazy = /\sdata-src(set)?\s*=/.test(html);
  if (!needsText && !lazy && !(images && isFullBanner(html))) return html;
  const t = document.createElement("template");
  t.innerHTML = html;
  const root = t.content;

  // The site's lazy loader copies data-src into src. Do the same so lazy images render and size like
  // production, e.g. the transparent 1210×1 "width-extender" that stretches the copy column on phones.
  for (const el of root.querySelectorAll("[data-src], [data-srcset]")) {
    if (el.dataset.src && !el.getAttribute("src")) el.setAttribute("src", el.dataset.src);
    if (el.dataset.srcset && !el.getAttribute("srcset")) el.setAttribute("srcset", el.dataset.srcset);
  }

  if (images) {
    const pic = root.querySelector(".m-fwBanner__row.-media picture, picture.a-genImg");
    if (pic) {
      for (const s of pic.querySelectorAll("source")) {
        const slot = slotForMedia(s.getAttribute("media"));
        if (slot && images[slot]) { s.setAttribute("srcset", images[slot]); s.removeAttribute("data-srcset"); }
      }
      const img = pic.querySelector("img");
      if (img && images.desktop) { img.setAttribute("src", images.desktop); img.removeAttribute("data-src"); }
    }
    const bg = root.querySelector(".m-mixinAd__bg");
    if (bg && images.desktop) bg.style.backgroundImage = `url("${images.desktop}")`;
  }

  if (needsText) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const p = node.parentElement;
      if (p && p.closest("style,script,picture")) continue;
      const block = (p && p.closest(BLOCKS)) || p;
      const blockLen = ((block ? block.textContent : node.data) || "").trim().length;
      node.data = expandText(node.data, expansion, blockLen, accents);
    }
  }
  return t.innerHTML;
}
