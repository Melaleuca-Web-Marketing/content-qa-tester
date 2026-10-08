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
  width: [["-w-xs", "XS"], ["-w-sm", "SM"], ["-w-md", "MD"], ["-w-lg", "LG"], ["-w-xl", "XL"]],
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

const MIXIN_BODY = `
<style>@media (max-width: 575px) { .m-mixinAd__bg { background-image: url("@@BANNER_SMALL_CSS@@") !important; } }</style>
<ul class="p-catListing__list" style="list-style:none;padding:0;margin:0">
  <li class="p-catListing__col">
    <article class="m-mixinAd -variant3">
      <div aria-hidden="true" class="m-mixinAd__bg" style="background-image: url('@@BANNER_DESKTOP@@')"></div>
      <a href="#" aria-label="" class="m-mixinAd__row -content">
        <div class="m-mixinAd__header"><div class="m-mixinAd__headline">@@BANNER_SNIPPET@@</div></div>
      </a>
    </article>
  </li>
</ul>`;

// Used when the pasted snippet is a whole banner (<a class="m-fwBanner">…) copied from the site.
const FULL_BODY = `<div class="p-catListing__main"><div class="p-catListing__banner">@@BANNER_SNIPPET@@</div></div>`;

export const BUILTIN_TEMPLATES = [
  { id: "category", name: "Category banner" },
  { id: "mixin", name: "Mix-in ad" },
];

export const isFullBanner = (html) => /class\s*=\s*["'][^"']*\b(m-fwBanner|m-mixinAd)\b/.test(html || "");

const BASE_STYLE = `<style id="__bp_base">
html,body{margin:0;background:#fff;color:#000;overflow:hidden;height:auto!important;min-height:0!important}
body{display:flow-root}
</style>`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// <style> is raw text (entities aren't decoded), so percent-encode anything that could end url("…").
const cssUrl = (u) => String(u).replace(/["'()\\\n]/g, encodeURIComponent);

export function placeholderImage(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><defs><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="24" fill="#eef1f5"/></pattern></defs><rect width="100%" height="100%" fill="#f7f8fa"/><rect width="100%" height="100%" fill="url(#p)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" fill="#8a94a6">${label}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function stripScripts(html) {
  return html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/?>/gi, "");
}

/**
 * Full preview document for one iframe.
 * opts: { template, customHtml, layout, full, stylesheets, baseHref, lang, images, content }
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
    const body = opts.full ? FULL_BODY : opts.template === "mixin" ? MIXIN_BODY : CATEGORY_BODY;
    page = `<!DOCTYPE html><html lang="${esc(opts.lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${base}
${links}${BASE_STYLE}</head><body>${body}</body></html>`;
  }

  const rowClasses = [layout.width, layout.align, layout.valign, layout.extra].filter(Boolean).join(" ");
  return page
    .replace(/@@BANNER_CLASSES@@/g, esc(layout.height || "-h-sm"))
    .replace(/@@ROW_CLASSES@@/g, esc(rowClasses))
    .replace(/@@BANNER_HREF@@/g, "#")
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

/**
 * Snippet HTML as it should be rendered: images in full-banner pastes swapped for the configured
 * ones, and text optionally expanded / accented.
 */
export function prepareSnippet(html, { expansion = "off", accents = false, images = null } = {}) {
  const needsText = expansion !== "off" || accents;
  if (!needsText && !(images && isFullBanner(html))) return html;
  const t = document.createElement("template");
  t.innerHTML = html;
  const root = t.content;

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
