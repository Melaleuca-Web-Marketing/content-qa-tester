import * as store from "./store.js";
import {
  BUILTIN_TEMPLATES, LAYOUT_OPTIONS, SLOT_INFO, rulesFor, slotForWidth,
  buildPage, setContent, prepareSnippet, isFullBanner, snippetKind, snippetImages, placeholderImage,
} from "./render.js";
import { analyze, drawOverlay, waitForAssets } from "./analyze.js";
import { lint } from "./lint.js";
import { extractBanners } from "./extract.js";
import { createEditor, setClassIndex } from "./editor.js";
import { loadClassIndex, prefixInfo, KIND_LABELS } from "./classes.js";

const $ = (id) => document.getElementById(id);
const IN_EXTENSION = typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.id && chrome.scripting);
const BREAKPOINTS = [415, 576, 768, 992, 1024, 1210];
const SLOTS = ["desktop", "medium", "small"];
const LOCALES = ["en-US", "es-US", "en-CA", "fr-CA", "es-MX", "en-GB", "en-IE", "nl-NL", "de-DE", "pl-PL", "lt-LT", "ja-JP", "ko-KR", "zh-TW", "zh-CN", "en-AU", "en-MY"];
// ---- which tool this page is ----------------------------------------------------------
// The same page runs as Category Banner Preview (index.html) or Mix-In Ad Preview (index.html?tool=mixin).
// Each keeps its own saved items, settings and look so the two don't get mixed up.
const TOOLS = {
  banner: {
    id: "banner", ns: "bp", other: "mixin", template: "category", logo: "CB", badge: "Category banner",
    name: "Category Banner Preview", noun: "banner", nounCap: "Banner",
    placeholder: 'Paste the banner HTML: the contents of .m-rte, or the whole <a class="m-fwBanner"> copied from the site.',
    copyHint: "goes in the banner's .m-rte",
  },
  mixin: {
    id: "mixin", ns: "mp", other: "banner", template: "mixin", logo: "MI", badge: "Mix-in ad",
    name: "Mix-In Ad Preview", noun: "ad", nounCap: "Ad",
    placeholder: 'Paste the mix-in ad copy (the contents of .m-mixinAd__headline), or the whole <article class="m-mixinAd"> copied from the site.',
    copyHint: "goes in the ad's .m-mixinAd__headline (a 230×450 card in the product grid)",
  },
};
const TOOL = TOOLS[new URLSearchParams(location.search).get("tool") === "mixin" ? "mixin" : "banner"];
const OTHER = TOOLS[TOOL.other];
store.setNamespace(TOOL.ns, TOOL.id);
const toolUrl = (tool, hash = "") => location.pathname + (tool.id === "mixin" ? "?tool=mixin" : "") + hash;

// Starter content for a first run.
const SAMPLES = {};
SAMPLES.mixin = {
  name: "Sample: Mix-in ad",
  html: `<div class="text-center text-white pt-24 px-10">
  <p class="text-sm uppercase tracking-wide">New</p>
  <h3 class="text-2xl font-bold leading-tight pt-4">Collagen Boost with Ceramides</h3>
  <p class="text-base pt-8">Shop Now&nbsp;❯</p>
</div>`,
  images: {},
};
// The Feb 2026 heart-health category banner.
SAMPLES.banner = {
  name: "Sample: Heart Health (Feb 2026)",
  html: `<div class="md:flex md:items-center md:mb-0" style="height: 112px">
  <div class="sm:text-center text-white pr-40 xs:pr-150 sm:pr-1_4 sm:mr-30 sm:pl-20 sm:pt-30 md:mr-60 md:pl-0 md:pt-20 lg:pt-15 lg:pl-60 xl:mr-0 xl:pl-75 xl:pt-15">
    <img src="https://cdnsc1.melaleuca.com/na/images/product-store/category-landing/banners/20260201/cat-supplements-hearthealthlogo--enus.png" height="auto" width="114px" alt="We love you" class="mx-auto hidden sm:block">
    <h2 class="text-2xl md:text-2xl-2 xl:text-4xl font-light sm:pt-4"><span class="font-bold">A Heartfelt Approach </span>to Wellness</h2>
    <p class="text-base md:mb-0 pt-2">Learn More About Heart Health&nbsp;❯</p>
  </div>
</div>`,
  images: {
    desktop: "https://cdnsc1.melaleuca.com/na/images/product-store/category-landing/banners/20260201/cat-supplements-hearthealth--enus.jpg",
    medium: "https://cdnsc1.melaleuca.com/na/images/product-store/category-landing/banners/20260201/cat-supplements-hearthealth-medium--enus.jpg",
    small: "https://cdnsc1.melaleuca.com/na/images/product-store/category-landing/banners/20260201/cat-supplements-hearthealth-small--enus.jpg",
  },
};

let S; // settings
let P; // current banner / ad (project)
let customTemplates = [];
let tiles = [];
const blobUrls = new Map();
let editor; // see editor.js
let classIdx = null; // see classes.js

// ---- small helpers ----------------------------------------------------------
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null && k !== false));
  return e;
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
function option(value, label, selected) {
  return el("option", { value, textContent: label, selected: value === selected });
}

const saveProjectSoon = debounce(async () => {
  await store.saveProject(P);
  $("saveStatus").textContent = "Saved " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}, 400);
const saveSettingsSoon = debounce(() => store.saveSettings(S), 300);

async function ensureBlobUrl(key) {
  if (!key || blobUrls.has(key)) return;
  const b = await store.getBlob(key).catch(() => null);
  blobUrls.set(key, b ? URL.createObjectURL(b) : "");
}

// ---- project data access ----------------------------------------------------
const langObj = (code) => P.langs.find((l) => l.code === code) || P.langs[0];
const langHtml = (code) => langObj(code).html;

const placeholders = {};
function placeholderFor(slot) {
  const [w, h] = TOOL.id === "mixin" ? [460, 900] : [1200, 300]; // ad cards are portrait
  return (placeholders[slot] ||= placeholderImage(`No ${SLOT_INFO[slot].label.toLowerCase()} image set`, w, h));
}

/** Background image per slot for a language: explicit image > image in that language's pasted banner > first language's > placeholder. */
function resolveImages(code) {
  const own = snippetImages(langHtml(code));
  const first = code === P.langs[0].code ? own : snippetImages(P.langs[0].html);
  const out = {};
  for (const slot of SLOTS) {
    const img = P.images[slot];
    const set = img ? img.url || blobUrls.get(img.blob) || "" : "";
    const snip = own[slot] || first[slot] || "";
    const url = set || snip;
    out[slot] = { url: url || placeholderFor(slot), placeholder: !url, fromSnippet: !set && !!snip };
  }
  // A mix-in ad normally has one background at every size; the mobile image is optional.
  if (TOOL.id === "mixin" && out.small.placeholder) out.small = { ...out.desktop, sameAsDesktop: true };
  return out;
}

/** The background-image slot shown at a viewport width (a mix-in without its own mobile image uses desktop). */
function slotAt(width) {
  if (TOOL.id !== "mixin") return slotForWidth("category", width);
  return width <= 575 && !resolveImages(P.activeLang).small.sameAsDesktop ? "small" : "desktop";
}

function urlsFor(code) {
  const r = resolveImages(code);
  return { desktop: r.desktop.url, medium: r.medium.url, small: r.small.url };
}

const isFull = (html) => isFullBanner(html, TOOL.id);

function prepared(code) {
  const html = langHtml(code);
  return prepareSnippet(html, { expansion: S.expansion, accents: S.accents, images: isFull(html) ? urlsFor(code) : null });
}

function pageFor(code) {
  const html = langHtml(code);
  const full = isFull(html);
  const custom = customTemplates.find((t) => t.id === P.template);
  const page = buildPage({
    template: P.template, customHtml: custom && custom.html, layout: P.layout, full, neighbors: P.mixin.neighbors,
    stylesheets: S.stylesheets, baseHref: S.baseHref, lang: code, images: urlsFor(code), content: prepared(code),
  });
  return { full, page };
}

// ---- tiles -------------------------------------------------------------------
function deviceName(width) {
  const d = S.devices.find((x) => x.width === width);
  return d ? d.name : width + "px";
}

function tileSpecs() {
  if (S.view === "compare") {
    return P.langs.map((l) => ({ key: "cmp-" + l.code, name: l.code, width: S.compareWidth, lang: l.code, compare: true }));
  }
  const lang = P.activeLang;
  const specs = S.devices.map((d) => ({ key: `dev-${d.name}-${d.width}`, name: d.name, width: d.width, lang }));
  if (S.edges) {
    for (const bp of BREAKPOINTS) {
      const w = bp - 1;
      if (!specs.some((s) => s.width === w)) specs.push({ key: "edge-" + w, name: `Edge (below ${deviceName(bp)})`, width: w, lang });
    }
  }
  for (const d of P.designs) {
    const w = targetWidth(d);
    if (w && !specs.some((s) => s.width === w)) specs.push({ key: "design-" + d.id, name: "Design: " + d.name, width: w, lang });
  }
  specs.sort((a, b) => a.width - b.width);
  if (S.sweep) specs.unshift({ key: "sweep", name: "Free width", width: S.sweepWidth, lang, sweep: true });
  return specs;
}

const blockNav = (e) => { if (e.target.closest && e.target.closest("a,button,form")) e.preventDefault(); };

function makeTile(spec) {
  const t = { ...spec, seq: 0, ready: false, result: null, height: 220 };
  t.el = el("div", { className: "tile" + (spec.sweep ? " sweep" : ""), id: "tile-" + spec.key });
  t.iframe = el("iframe", { title: spec.name + " preview" });
  t.wrap = el("div", { className: "frameWrap" }, t.iframe);
  t.list = el("ul", { className: "issues tileIssues" });

  t.nameEl = el("span", { className: "tname" });
  t.widthEl = el("span", { className: "tw" });
  t.slotEl = el("span", { className: "tag" });
  t.heightEl = el("span", { className: "tag" });
  t.langEl = el("span", { className: "tag lang" });
  t.balEl = el("span", { className: "tag bal", hidden: true });
  t.scaleEl = el("span", { className: "hint" });
  t.badge = el("span", { className: "badge wait", textContent: "…" });
  const head = el("div", { className: "tileHead" }, t.nameEl, t.widthEl);
  if (spec.sweep) {
    const range = el("input", { type: "range", min: 300, max: 1600, value: t.width, title: "Drag to change the width" });
    const reanalyze = debounce(() => analyzeTile(t), 80);
    range.addEventListener("input", () => {
      t.width = S.sweepWidth = Number(range.value);
      sizeTile(t, false);
      renderTileInfo(t);
      reanalyze();
      saveSettingsSoon();
    });
    head.append(range);
  }
  head.append(t.slotEl, t.heightEl, t.langEl, t.balEl, t.scaleEl, t.badge);
  t.el.append(head, t.wrap, t.list);
  return t;
}

function scaleFor(width) {
  const z = S.zoom / 100;
  if (!S.fit) return z;
  const avail = $("tiles").clientWidth - 2 * 14 - 2 * 11;
  return Math.max(0.1, Math.min(z, avail / width));
}

function sizeTile(t, measure = true) {
  const doc = t.ready && t.iframe.contentDocument;
  if (measure && doc && doc.body) t.height = Math.min(2400, Math.max(60, Math.ceil(doc.body.getBoundingClientRect().height)));
  const s = (t.scale = scaleFor(t.width));
  Object.assign(t.iframe.style, { width: t.width + "px", height: t.height + "px", transform: `scale(${s})` });
  Object.assign(t.wrap.style, { width: Math.round(t.width * s) + "px", height: Math.round(t.height * s) + "px" });
  t.scaleEl.textContent = s < 0.995 || s > 1.005 ? Math.round(s * 100) + "%" : "";
  if (t.below) drawDesign(t); // the "below" image lives outside the frame, so it follows the tile scale
}

function renderTileInfo(t) {
  const slot = slotAt(t.width);
  t.nameEl.textContent = t.name;
  t.widthEl.textContent = t.width + "px";
  t.slotEl.textContent = SLOT_INFO[slot].label + " image";
  t.langEl.textContent = t.lang;
  const r = t.result;
  t.heightEl.textContent = !r || !r.bannerH ? "" : TOOL.id === "mixin" ? `ad ${r.bannerW}×${r.bannerH}` : `banner ${r.bannerH}px`;
  t.heightEl.hidden = !t.heightEl.textContent;
  const b = r && r.balance;
  t.balEl.hidden = !b;
  if (b) {
    const parts = [];
    if (b.axes.includes("h")) parts.push(`↔ ${b.gaps.l} | ${b.gaps.r}`);
    if (b.axes.includes("v")) parts.push(`↕ ${b.gaps.t} | ${b.gaps.b}`);
    t.balEl.textContent = parts.join("  ") + "px";
    t.balEl.className = "tag bal " + (b.okH && b.okV ? "ok" : "off");
    t.balEl.title = "Gaps around the copy in its space (" + (b.okH && b.okV ? "balanced" : "off-center") + ")";
  }
  t.list.textContent = "";
  if (!r) { t.badge.className = "badge wait"; t.badge.textContent = "…"; return; }
  const errors = r.issues.filter((i) => i.level === "error").length;
  const warns = r.issues.length - errors;
  t.badge.className = "badge " + (errors ? "error" : warns ? "warn" : "ok");
  t.badge.textContent = errors ? `${errors} problem${errors > 1 ? "s" : ""}` : warns ? `${warns} warning${warns > 1 ? "s" : ""}` : "✓ Clear";
  for (const i of r.issues) t.list.append(el("li", { className: i.level, textContent: i.msg }));
  paintChip(t);
}

function loadTile(t) {
  t.seq++;
  if (t.settle) t.settle();
  const { full, page } = pageFor(t.lang);
  t.full = full;
  t.ready = false;
  sizeTile(t, false);
  t.loading = new Promise((resolve) => {
    t.settle = resolve;
    t.iframe.onload = async () => {
      t.ready = true;
      const doc = t.iframe.contentDocument;
      doc.addEventListener("click", blockNav, true);
      doc.addEventListener("submit", blockNav, true);
      await refreshTile(t); // picks up anything typed while the frame was loading
      if (t.settle === resolve) t.settle = null;
      resolve();
    };
  });
  t.iframe.srcdoc = page;
  return t.loading;
}

/** Puts the latest copy into an already-loaded frame (no reload), then re-checks it. */
async function refreshTile(t) {
  if (!t.ready) return t.loading;
  const doc = t.iframe.contentDocument;
  if (!doc || !doc.body || isFull(langHtml(t.lang)) !== t.full) return loadTile(t);
  const seq = ++t.seq;
  doc.documentElement.lang = t.lang;
  if (!setContent(doc, prepared(t.lang))) return loadTile(t);
  await waitForAssets(doc);
  if (seq === t.seq) await analyzeTile(t);
}

// ---- design overlay drawing ----------------------------------------------------
// A design targets either one width ("w:768") or every viewport using an image slot ("slot:medium").
const targetWidth = (d) => (/^w:\d+$/.test(d.target) ? Number(d.target.slice(2)) : 0);

function designFor(t) {
  if (!S.showDesign) return null;
  const slot = slotAt(t.width);
  return P.designs.find((d) => targetWidth(d) === t.width) || P.designs.find((d) => d.target === "slot:" + slot) || null;
}

/** Size of the design in CSS px, based on the banner box it's fitted to. */
function designSize(d, br) {
  const ratio = (d.natH || 1) / (d.natW || 1);
  const k = (d.scale || 100) / 100;
  if (d.fit === "height") return { w: (br.height / ratio) * k, h: br.height * k };
  if (d.fit === "stretch") return { w: br.width * k, h: br.height * k };
  if (d.fit === "actual") return { w: d.natW * k, h: d.natH * k };
  return { w: br.width * k, h: br.width * ratio * k }; // fit banner width
}

function drawDesign(t) {
  if (t.below) { t.below.remove(); t.below = null; }
  const doc = t.ready && t.iframe.contentDocument;
  if (!doc || !doc.body) return;
  doc.getElementById("__bp_design")?.remove();
  const d = designFor(t);
  const src = d && blobUrls.get(d.blob);
  if (!src || !t.result) return;
  const br = t.result.bannerRect || { left: 0, top: 0, width: t.width, height: t.height };
  const { w, h } = designSize(d, br);
  const s = t.scale || 1;

  if (S.designMode === "below") {
    const im = el("img", { src, alt: "", title: `Design: ${d.name}` });
    Object.assign(im.style, { width: w * s + "px", height: h * s + "px", marginLeft: (br.left + d.dx) * s + "px" });
    t.below = el("div", { className: "designBelow" }, el("span", { className: "hint", textContent: `Design: ${d.name}` }), im);
    t.wrap.after(t.below);
    return;
  }

  const sx = doc.defaultView.scrollX, sy = doc.defaultView.scrollY;
  const box = doc.createElement("div");
  box.id = "__bp_design";
  const swipe = S.designMode === "swipe";
  box.style.cssText = `position:absolute;left:${br.left + sx + d.dx}px;top:${br.top + sy + d.dy}px;width:${w}px;height:${h}px;z-index:2147483646;` +
    `pointer-events:${S.designMove ? "auto" : "none"};cursor:${S.designMove ? "move" : "default"};touch-action:none;` +
    `opacity:${swipe ? 1 : S.designOpacity / 100};mix-blend-mode:${swipe ? "normal" : S.designBlend}`;
  const im = doc.createElement("img");
  im.src = src;
  im.draggable = false;
  im.style.cssText = "display:block;width:100%;height:100%;max-width:none;user-select:none";
  box.append(im);

  if (swipe) {
    // Build on the left of the line, design on the right; hover over the tile to move the line.
    const line = doc.createElement("div");
    line.style.cssText = "position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#38bdf8;box-shadow:0 0 0 1px rgba(0,0,0,.4)";
    box.append(line);
    const setSplit = (f) => {
      t.swipe = Math.min(1, Math.max(0, f));
      im.style.clipPath = `inset(0 0 0 ${t.swipe * 100}%)`;
      line.style.left = t.swipe * 100 + "%";
    };
    setSplit(t.swipe ?? 0.5);
    doc.onpointermove = (e) => { if (!t.dragging) setSplit((e.clientX - (br.left + d.dx)) / w); };
  } else doc.onpointermove = null;

  if (S.designMove) {
    box.onpointerdown = (e) => {
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY, dx0 = d.dx, dy0 = d.dy;
      t.dragging = true;
      grabbedDesign = d;
      box.onpointermove = (ev) => {
        d.dx = Math.round(dx0 + ev.clientX - x0);
        d.dy = Math.round(dy0 + ev.clientY - y0);
        box.style.left = br.left + sx + d.dx + "px";
        box.style.top = br.top + sy + d.dy + "px";
      };
      box.onpointerup = () => { box.onpointermove = null; t.dragging = false; designChanged(d); };
    };
    doc.onkeydown = (e) => { grabbedDesign = d; nudgeDesign(e); };
  } else doc.onkeydown = null;
  doc.body.appendChild(box);
}

// Arrow keys nudge the design last grabbed in Move mode (1px, Shift = 10px).
let grabbedDesign = null;
function nudgeDesign(e) {
  const d = grabbedDesign;
  if (!S.designMove || !d || !P.designs.includes(d) || e.target.closest?.("input,textarea,select")) return;
  const step = e.shiftKey ? 10 : 1;
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!move) return;
  e.preventDefault();
  d.dx += move[0];
  d.dy += move[1];
  designChanged();
}
document.addEventListener("keydown", nudgeDesign);

const redrawDesigns = () => tiles.forEach(drawDesign);

/** After a design's position/fit changes: persist, refresh its panel row, and redraw every tile. */
const saveDesignsSoon = debounce(() => { saveProjectSoon(); renderDesigns(); }, 250);
function designChanged() {
  redrawDesigns();
  saveDesignsSoon();
}

async function analyzeTile(t) {
  const doc = t.ready && t.iframe.contentDocument;
  if (!doc || !doc.body) return;
  const slot = slotAt(t.width);
  const img = resolveImages(t.lang)[slot];
  t.result = await analyze(doc, {
    slot, zones: P.zones[slot] || [], placeholder: img.placeholder,
    balance: P.balance[slot] || "", copyArea: P.copyAreas[slot] || null, tolerance: S.balanceTolerance,
    noun: TOOL.noun, growCheck: TOOL.id === "banner",
  });
  drawOverlay(doc, t.result, { showZones: S.showZones });
  sizeTile(t);
  drawDesign(t);
  renderTileInfo(t);
  updateSummary();
}

function redrawOverlays() {
  for (const t of tiles) {
    const doc = t.ready && t.iframe.contentDocument;
    if (doc && t.result) drawOverlay(doc, t.result, { showZones: S.showZones });
    drawDesign(t);
  }
}

const refreshAll = () => Promise.all(tiles.map(refreshTile));
const reloadAll = () => Promise.all(tiles.map(loadTile));
const reanalyzeAll = () => Promise.all(tiles.map(analyzeTile));

/** Syncs the tile list with the current view; keeps frames that are still needed. */
function rebuildTiles(forceReload = false) {
  const box = $("tiles");
  const old = new Map(tiles.map((t) => [t.key, t]));
  const fresh = [];
  tiles = tileSpecs().map((s) => {
    const o = old.get(s.key);
    if (o) { old.delete(s.key); Object.assign(o, { name: s.name, width: s.width, lang: s.lang }); return o; }
    const t = makeTile(s);
    fresh.push(t);
    return t;
  });
  for (const t of old.values()) { t.el.remove(); if (t.settle) t.settle(); }
  tiles.forEach((t, i) => { if (box.children[i] !== t.el) box.insertBefore(t.el, box.children[i] || null); });
  for (const t of tiles) {
    renderTileInfo(t);
    if (fresh.includes(t) || forceReload) loadTile(t);
    else { sizeTile(t, false); refreshTile(t); }
  }
  renderCompareSelect();
  renderJumpbar();
  updateSummary();
}

// ---- jump to a viewport (buttons under the toolbar; Alt+1…9 in order, Alt+0 = Free width) --------
const shortcutTiles = () => tiles.filter((t) => !t.sweep);

function renderJumpbar() {
  const bar = $("jumpbar");
  bar.textContent = "";
  const numbered = shortcutTiles();
  tiles.forEach((t) => {
    const i = numbered.indexOf(t);
    const key = t.sweep ? " (Alt+0)" : i >= 0 && i < 9 ? ` (Alt+${i + 1})` : "";
    t.chip = el("button", { type: "button", className: "jump", title: `${t.name} · ${t.width}px${key}` },
      el("span", { className: "dot" }), t.sweep ? "Free" : t.name);
    t.chip.addEventListener("click", () => flash(t));
    bar.append(t.chip);
    paintChip(t);
  });
  markVisibleChip();
}

/** Status dot on a jump button, matching the tile's badge. */
function paintChip(t) {
  if (!t.chip) return;
  const r = t.result;
  const level = !r ? "" : r.issues.some((i) => i.level === "error") ? "error" : r.issues.length ? "warn" : "ok";
  t.chip.firstChild.className = "dot " + level;
}

/** Highlights the button of the tile at the top of the scrolled preview. */
function markVisibleChip() {
  const top = $("tiles").getBoundingClientRect().top + 40;
  const current = tiles.find((t) => t.el.getBoundingClientRect().bottom > top);
  for (const t of tiles) if (t.chip) t.chip.classList.toggle("on", t === current);
}

function bindJumpbar() {
  let pending = false;
  $("tiles").addEventListener("scroll", () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; markVisibleChip(); });
  });
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || !/^Digit\d$/.test(e.code)) return;
    const n = Number(e.code.slice(5));
    const t = n === 0 ? tiles.find((x) => x.sweep) : shortcutTiles()[n - 1];
    if (!t) return;
    e.preventDefault();
    flash(t);
  });
}

function updateSummary() {
  const chip = $("summary");
  if (document.body.classList.contains("busy")) return;
  const done = tiles.filter((t) => t.result);
  if (!done.length) { chip.className = "chip"; chip.textContent = "Rendering…"; return; }
  const bad = done.filter((t) => t.result.issues.some((i) => i.level === "error")).length;
  const warn = done.filter((t) => t.result.issues.length).length - bad;
  chip.className = "chip " + (bad ? "error" : warn ? "warn" : "ok");
  const noun = S.view === "compare" ? "language" : "viewport";
  chip.textContent = bad ? `${bad} of ${tiles.length} ${noun}s have problems` : warn ? `${warn} ${noun}${warn > 1 ? "s" : ""} with warnings` : `All ${tiles.length} ${noun}s clear`;
}

// ---- languages / editor -------------------------------------------------------
function renderLangs() {
  const box = $("langTabs");
  box.textContent = "";
  P.langs.forEach((l, i) => {
    const b = el("button", { className: "lang" + (l.code === P.activeLang ? " on" : ""), title: i === 0 ? "Reference language (other languages are compared with it)" : "" }, l.code);
    b.addEventListener("click", () => setActiveLang(l.code));
    if (P.langs.length > 1) {
      const x = el("span", { className: "x", textContent: "×", title: "Remove " + l.code });
      x.addEventListener("click", (e) => { e.stopPropagation(); removeLang(l.code); });
      b.append(x);
    }
    box.append(b);
  });
  const add = el("button", { className: "lang add", textContent: "+ Language" });
  add.addEventListener("click", addLang);
  box.append(add);
}

function setActiveLang(code) {
  P.activeLang = code;
  editor.setValue(langHtml(code), P.id + "|" + code);
  renderLangs();
  runLint();
  updateFullNote();
  renderSlots();
  saveProjectSoon();
  if (S.view === "viewports") {
    for (const t of tiles) t.lang = code;
    refreshAll();
  } else {
    const t = tiles.find((x) => x.lang === code);
    if (t) flash(t);
  }
}

async function addLang() {
  const input = el("input", { placeholder: "e.g. pl-PL", autocomplete: "off" });
  input.setAttribute("list", "localeList");
  const dl = el("datalist", { id: "localeList" }, ...LOCALES.filter((c) => !P.langs.some((l) => l.code === c)).map((c) => el("option", { value: c })));
  const copy = el("input", { type: "checkbox", checked: true });
  const body = el("div", {},
    el("label", { className: "field" }, el("span", { textContent: "Language code" }), input, dl),
    el("label", { className: "tb chk", style: "margin-top:8px" }, copy, ` Start from the ${P.langs[0].code} copy`));
  setTimeout(() => input.focus(), 50);
  const ok = await choose("Add a language", [{ label: "Add", value: true }], body);
  const code = input.value.trim();
  if (!ok || !code) return;
  if (P.langs.some((l) => l.code.toLowerCase() === code.toLowerCase())) return toast(code + " is already there.");
  P.langs.push({ code, html: copy.checked ? P.langs[0].html : "" });
  if (S.view === "compare") rebuildTiles();
  setActiveLang(code);
}

function removeLang(code) {
  if (!confirm(`Remove ${code} and its copy?`)) return;
  P.langs = P.langs.filter((l) => l.code !== code);
  if (P.activeLang === code) P.activeLang = P.langs[0].code;
  if (S.view === "compare") rebuildTiles();
  setActiveLang(P.activeLang);
}

function runLint() {
  const code = P.activeLang;
  const issues = lint(langHtml(code), { lang: code, isSource: code === P.langs[0].code, source: P.langs[0].html });
  const ul = $("lint");
  ul.textContent = "";
  for (const i of issues) ul.append(el("li", { className: i.level, textContent: i.msg }));
}

function updateFullNote() {
  const html = langHtml(P.activeLang);
  const full = isFull(html);
  $("fullNote").hidden = !full;
  $("layoutFields").hidden = full || P.template !== "category";
  $("mixinFields").hidden = TOOL.id !== "mixin";
  // Markup for the other tool (a category banner pasted into Mix-In Ad Preview, or the reverse).
  const kind = snippetKind(html);
  $("wrongTool").hidden = !kind || kind === TOOL.id;
}

/** Sends this item's copy and images to the other tool as a new item there, then opens it. */
async function moveToOtherTool() {
  await store.saveProject(P);
  const data = await store.exportProject(P);
  Object.assign(data.project, { tool: OTHER.id, template: OTHER.template });
  data.tool = OTHER.id;
  await store.setJSON(store.nsKey("handoff", OTHER.ns), data);
  location.href = toolUrl(OTHER, "#handoff");
}

/** Picks up an item sent from the other tool. */
async function takeHandoff() {
  const key = store.nsKey("handoff");
  const data = await store.getJSON(key, null);
  if (!data) return;
  await store.setJSON(key, null);
  history.replaceState(null, "", toolUrl(TOOL));
  try {
    await store.saveProject(P);
    await openProject(await store.importProject(data));
    toast(`Moved here from ${OTHER.name}. The original is still there; delete it if you don't need it.`);
  } catch (err) { toast("Couldn't move it: " + err.message); }
}

let lastSnippetImages = "";
const onCopyChanged = debounce(() => {
  saveProjectSoon();
  runLint();
  updateFullNote();
  const sig = JSON.stringify(snippetImages(langHtml(P.activeLang)));
  if (sig !== lastSnippetImages) { lastSnippetImages = sig; renderSlots(); }
  refreshAll();
}, 150);

// ---- template + layout ----------------------------------------------------------
function renderLayout() {
  const sel = $("tplSel");
  sel.textContent = "";
  for (const t of BUILTIN_TEMPLATES) if (t.tool === TOOL.id || t.id === P.template) sel.append(option(t.id, t.name, P.template));
  for (const t of customTemplates) sel.append(option(t.id, "Custom: " + t.name, P.template));
  $("mxNeighbors").checked = P.mixin.neighbors !== false;
  const fill = (id, opts, val) => { const s = $(id); s.textContent = ""; for (const [v, l] of opts) s.append(option(v, l, val)); };
  fill("lyHeight", LAYOUT_OPTIONS.height, P.layout.height);
  fill("lyWidth", LAYOUT_OPTIONS.width, P.layout.width);
  fill("lyAlign", LAYOUT_OPTIONS.align, P.layout.align);
  fill("lyValign", LAYOUT_OPTIONS.valign, P.layout.valign);
  $("lyExtra").value = P.layout.extra || "";
  updateFullNote();
}

function onLayoutChanged() {
  P.template = $("tplSel").value;
  P.layout = { height: $("lyHeight").value, width: $("lyWidth").value, align: $("lyAlign").value, valign: $("lyValign").value, extra: $("lyExtra").value.trim() };
  P.mixin = { ...P.mixin, neighbors: $("mxNeighbors").checked };
  saveProjectSoon();
  updateFullNote();
  renderSlots();
  reloadAll();
}

// ---- background images ------------------------------------------------------------
function renderSlots() {
  const box = $("slots");
  box.textContent = "";
  const imgs = resolveImages(P.activeLang);
  for (const rule of rulesFor(TOOL.template)) {
    const slot = rule.slot;
    const cur = P.images[slot];
    const res = imgs[slot];
    // Mix-in: the mobile image is optional; without one the desktop image is used at every width.
    const optional = TOOL.id === "mixin" && slot === "small";
    const hint = TOOL.id === "mixin" && slot === "desktop" && imgs.small.sameAsDesktop ? "all widths" : rule.hint + (optional ? " · optional" : "");
    const dims = el("span", { className: "dims" });
    const thumb = el("div", { className: "thumb", title: "Click to choose a file, or drop one here" });
    if (res.sameAsDesktop) thumb.textContent = "Same as desktop";
    else if (res.placeholder) thumb.textContent = "Drop image";
    else {
      const im = el("img", { src: res.url, alt: "" });
      im.onload = () => (dims.textContent = `${im.naturalWidth}×${im.naturalHeight}`);
      im.onerror = () => (dims.textContent = "failed to load");
      thumb.append(im);
    }
    const file = el("input", { type: "file", accept: "image/*", hidden: true });
    file.addEventListener("change", () => setSlotFile(slot, file.files[0]));
    thumb.addEventListener("click", () => file.click());
    thumb.addEventListener("dragover", (e) => { e.preventDefault(); thumb.classList.add("over"); });
    thumb.addEventListener("dragleave", () => thumb.classList.remove("over"));
    thumb.addEventListener("drop", (e) => {
      e.preventDefault();
      thumb.classList.remove("over");
      const f = e.dataTransfer.files[0];
      if (f) setSlotFile(slot, f);
      else { const u = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"); if (u) setSlotUrl(slot, u); }
    });

    const url = el("input", {
      className: "url", value: (cur && cur.url) || "", spellcheck: false,
      placeholder: cur && cur.blob ? "File: " + cur.name : res.fromSnippet ? "Using the image in your snippet"
        : res.sameAsDesktop ? "Optional: only if the ad has its own mobile background" : "https://…",
    });
    url.addEventListener("change", () => setSlotUrl(slot, url.value));
    const zones = (P.zones[slot] || []).length + (P.copyAreas[slot] ? 1 : 0);
    const zbtn = el("button", { className: "small", textContent: zones ? `Zones (${zones})` : "Zones…", disabled: res.placeholder || res.sameAsDesktop,
      title: "Keep-out zones (where copy must not go) and an optional copy area" });
    zbtn.addEventListener("click", () => openZones(slot));
    const center = el("select", { className: "small", disabled: !!res.sameAsDesktop, title: "Check that the copy is centered in the empty space next to the objects in this image" });
    for (const [v, l] of [["", "Center copy: off"], ["h", "Center ↔ horizontally"], ["v", "Center ↕ vertically"], ["hv", "Center both ways"]]) center.append(option(v, l, P.balance[slot] || ""));
    center.addEventListener("change", () => {
      if (center.value) P.balance[slot] = center.value; else delete P.balance[slot];
      saveProjectSoon();
      reanalyzeAll();
    });
    const clear = el("button", { className: "small", textContent: "Clear", disabled: !cur });
    clear.addEventListener("click", () => setSlotUrl(slot, ""));
    let note = null;
    if (cur && cur.url && /^http:/i.test(cur.url)) note = el("span", { className: "note", style: "color:var(--warm)", textContent: "http:// images are blocked on the live site; use https://" });

    box.append(el("div", { className: "slot" }, thumb,
      el("div", {},
        el("div", { className: "slotHead" }, el("strong", { textContent: SLOT_INFO[slot].label }), el("span", { className: "hint", textContent: hint }), dims),
        url, file,
        el("div", { className: "row" }, zbtn, center, clear),
        note)));
  }
}

async function dropSlotBlob(slot) {
  const cur = P.images[slot];
  if (cur && cur.blob) await store.delBlob(cur.blob).catch(() => {});
}

async function setSlotFile(slot, f) {
  if (!f || !/^image\//.test(f.type)) return toast("That isn't an image file.");
  const key = P.id + ":" + store.uid();
  await store.putBlob(key, f);
  blobUrls.set(key, URL.createObjectURL(f));
  await dropSlotBlob(slot);
  P.images[slot] = { blob: key, name: f.name };
  imagesChanged();
}

async function setSlotUrl(slot, url) {
  url = (url || "").trim();
  await dropSlotBlob(slot);
  if (url) P.images[slot] = { url };
  else delete P.images[slot];
  imagesChanged();
}

function imagesChanged() {
  saveProjectSoon();
  renderSlots();
  reloadAll();
}

// ---- keep-out zone editor ------------------------------------------------------------
let zoneSlot = null;

function openZones(slot) {
  zoneSlot = slot;
  $("zoneSlot").textContent = `${SLOT_INFO[slot].label} image`;
  $("zoneImg").src = resolveImages(P.activeLang)[slot].url;
  setZoneMode("zone");
  renderZones();
  renderGuides();
  $("zoneDlg").showModal();
}

let zoneMode = "zone"; // zone | area

function setZoneMode(m) {
  zoneMode = m;
  for (const b of $("zoneModeSeg").children) b.classList.toggle("on", b.dataset.mode === m);
}

function renderZones() {
  const layer = $("zoneLayer");
  layer.textContent = "";
  const area = P.copyAreas[zoneSlot];
  if (area) {
    const d = el("div", { className: "zone area" }, el("span", { textContent: "copy area" }));
    Object.assign(d.style, { left: area.x * 100 + "%", top: area.y * 100 + "%", width: area.w * 100 + "%", height: area.h * 100 + "%" });
    const x = el("button", { textContent: "×", title: "Remove copy area (go back to automatic)" });
    x.addEventListener("pointerdown", (e) => e.stopPropagation());
    x.addEventListener("click", () => { delete P.copyAreas[zoneSlot]; zonesChanged(); });
    d.append(x);
    layer.append(d);
  }
  (P.zones[zoneSlot] || []).forEach((z, i) => {
    const d = el("div", { className: "zone" });
    Object.assign(d.style, { left: z.x * 100 + "%", top: z.y * 100 + "%", width: z.w * 100 + "%", height: z.h * 100 + "%" });
    const x = el("button", { textContent: "×", title: "Remove zone" });
    x.addEventListener("pointerdown", (e) => e.stopPropagation());
    x.addEventListener("click", () => { P.zones[zoneSlot].splice(i, 1); zonesChanged(); });
    d.append(x);
    layer.append(d);
  });
}

/** Dashed frames showing the visible crop at the narrowest and widest viewports that use this image. */
function renderGuides() {
  const box = $("zoneGuides");
  box.textContent = "";
  const using = tiles.filter((t) => t.result && t.result.visible && t.result.slot === zoneSlot && !t.compare).sort((a, b) => a.width - b.width);
  const picks = using.length > 1 ? [using[0], using[using.length - 1]] : using;
  picks.forEach((t, i) => {
    const v = t.result.visible;
    const g = el("div", { className: "guide" + (i ? " max" : "") }, el("span", { textContent: `visible at ${t.width}px` }));
    Object.assign(g.style, { left: v.x * 100 + "%", top: v.y * 100 + "%", width: v.w * 100 + "%", height: v.h * 100 + "%" });
    box.append(g);
  });
}

function zonesChanged() {
  saveProjectSoon();
  renderZones();
  renderSlots();
  reanalyzeAll();
}

function bindZoneEditor() {
  const layer = $("zoneLayer");
  const clamp = (v) => Math.min(1, Math.max(0, v));
  layer.addEventListener("pointerdown", (e) => {
    // Draw on the image or on top of the copy area (the area sits behind zones, so you can still draw zones over it).
    if ((e.target !== layer && !e.target.classList.contains("area")) || e.button !== 0) return;
    const box = layer.getBoundingClientRect();
    const x0 = clamp((e.clientX - box.left) / box.width), y0 = clamp((e.clientY - box.top) / box.height);
    const d = el("div", { className: "zone" + (zoneMode === "area" ? " area" : "") });
    layer.append(d);
    layer.setPointerCapture(e.pointerId);
    let rect = null;
    const move = (ev) => {
      const x1 = clamp((ev.clientX - box.left) / box.width), y1 = clamp((ev.clientY - box.top) / box.height);
      rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      Object.assign(d.style, { left: rect.x * 100 + "%", top: rect.y * 100 + "%", width: rect.w * 100 + "%", height: rect.h * 100 + "%" });
    };
    const up = () => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      d.remove();
      if (rect && rect.w > 0.005 && rect.h > 0.01) {
        const r4 = (v) => Math.round(v * 10000) / 10000;
        const r = { x: r4(rect.x), y: r4(rect.y), w: r4(rect.w), h: r4(rect.h) };
        if (zoneMode === "area") P.copyAreas[zoneSlot] = r; // one per image; drawing again replaces it
        else (P.zones[zoneSlot] ||= []).push(r);
        zonesChanged();
      }
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
  });
  for (const b of $("zoneModeSeg").children) b.addEventListener("click", () => setZoneMode(b.dataset.mode));
  $("zoneClear").addEventListener("click", () => {
    if (confirm("Remove all zones and the copy area for this image?")) { P.zones[zoneSlot] = []; delete P.copyAreas[zoneSlot]; zonesChanged(); }
  });
  const close = () => $("zoneDlg").close();
  $("zoneDone").addEventListener("click", close);
  $("zoneClose").addEventListener("click", close);
}

// ---- design overlays ----------------------------------------------------------------
const FITS = [["width", `Fit ${TOOL.noun} width`], ["height", `Fit ${TOOL.noun} height`], ["stretch", `Stretch to ${TOOL.noun}`], ["actual", "Actual pixels"]];

function targetLabel(target) {
  const w = /^w:(\d+)$/.exec(target);
  if (w) { const n = Number(w[1]); return S.devices.some((d) => d.width === n) ? `${deviceName(n)} (${n}px)` : `${n}px (own tile)`; }
  const slot = target.slice(5);
  return `All ${SLOT_INFO[slot] ? SLOT_INFO[slot].label.toLowerCase() : slot}-image viewports`;
}

function targetOptions(current) {
  const opts = S.devices.map((d) => "w:" + d.width);
  for (const r of rulesFor(TOOL.template)) opts.push("slot:" + r.slot);
  if (current && !opts.includes(current)) opts.push(current);
  return opts;
}

function renderDesigns() {
  const box = $("designs");
  box.textContent = "";
  for (const d of P.designs) {
    const name = el("input", { className: "name", value: d.name, title: "Name" });
    name.addEventListener("change", () => { d.name = name.value.trim() || d.name; saveProjectSoon(); rebuildTiles(); });

    const target = el("select", { title: "Which viewport(s) show this design" });
    for (const v of targetOptions(d.target)) target.append(option(v, targetLabel(v), d.target));
    target.append(option("other", "Other width…", ""));
    target.addEventListener("change", () => {
      if (target.value === "other") {
        const w = Number(prompt("Show this design on a tile of what width (px)?", targetWidth(d) || 1210));
        if (w >= 280 && w <= 2560) d.target = "w:" + Math.round(w);
      } else d.target = target.value;
      saveProjectSoon(); renderDesigns(); rebuildTiles(); redrawDesigns();
    });

    const fit = el("select", { title: `How the design is sized against the ${TOOL.noun}` });
    for (const [v, l] of FITS) fit.append(option(v, l, d.fit));
    fit.addEventListener("change", () => { d.fit = fit.value; designChanged(); });

    const num = (key, label, title) => {
      const i = el("input", { type: "number", value: d[key], step: 1, title });
      i.addEventListener("input", () => { if (i.value !== "" && !isNaN(i.value)) { d[key] = Number(i.value); redrawDesigns(); saveProjectSoon(); } });
      return el("label", { className: "mini" }, el("span", { textContent: label }), i);
    };
    const reset = el("button", { className: "small", textContent: "Reset", title: "Back to fitted, no offset" });
    reset.addEventListener("click", () => { Object.assign(d, { dx: 0, dy: 0, scale: 100 }); designChanged(); });
    const rm = el("button", { className: "small danger", textContent: "Remove" });
    rm.addEventListener("click", async () => {
      await store.delBlob(d.blob).catch(() => {});
      P.designs = P.designs.filter((x) => x !== d);
      saveProjectSoon(); renderDesigns(); rebuildTiles(); redrawDesigns();
    });

    box.append(el("div", { className: "design" },
      el("div", { className: "dtop" }, el("img", { src: blobUrls.get(d.blob) || "", alt: "", title: `${d.natW}×${d.natH}` }), name, rm),
      el("div", { className: "grid2" },
        el("label", { className: "field" }, el("span", { textContent: "Show on" }), target),
        el("label", { className: "field" }, el("span", { textContent: "Size" }), fit)),
      el("div", { className: "row" },
        num("dx", "X", "Horizontal offset in px (or drag with Move on)"),
        num("dy", "Y", "Vertical offset in px (or drag with Move on)"),
        num("scale", "Scale %", "Extra scaling on top of the fit"),
        reset)));
  }
}

const imageSize = (url) => new Promise((r) => {
  const im = new Image();
  im.onload = () => r({ w: im.naturalWidth, h: im.naturalHeight });
  im.onerror = () => r({ w: 1210, h: 192 });
  im.src = url;
});

/** Best first guess at where a new design belongs; the user can change it in the panel. */
function guessTarget(natW, template = P.template) {
  for (const w of [natW, Math.round(natW / 2)]) if (S.devices.some((d) => d.width === w)) return "w:" + w;
  const w = natW > 1600 ? natW / 2 : natW;
  return "slot:" + slotForWidth(template, w);
}

async function addDesigns(files, label) {
  const added = [];
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    const key = P.id + ":" + store.uid();
    await store.putBlob(key, f);
    const url = URL.createObjectURL(f);
    blobUrls.set(key, url);
    const { w, h } = await imageSize(url);
    const d = { id: store.uid(), blob: key, name: label || f.name.replace(/\.[^.]+$/, ""), natW: w, natH: h, target: guessTarget(w), fit: "width", dx: 0, dy: 0, scale: 100 };
    P.designs.push(d);
    added.push(d);
  }
  if (!added.length) return;
  if (!S.showDesign) { S.showDesign = true; $("showDesign").checked = true; saveSettingsSoon(); }
  saveProjectSoon();
  renderDesigns();
  rebuildTiles();
  redrawDesigns();
  toast(`Showing on: ${targetLabel(added[0].target)}. Change it under Design overlays.`);
}

// ---- check all languages ------------------------------------------------------------
async function checkAll() {
  if (S.view !== "viewports") { setView("viewports"); await Promise.all(tiles.map((t) => t.loading)); }
  const rows = tiles.filter((t) => !t.sweep);
  const cols = P.langs.map((l) => l.code);
  const data = {};
  document.body.classList.add("busy");
  editor.setReadOnly(true);
  try {
    for (const code of cols) {
      $("summary").className = "chip";
      $("summary").textContent = `Checking ${code}…`;
      for (const t of rows) t.lang = code;
      await Promise.all(rows.map(refreshTile));
      for (const t of rows) data[t.key + "|" + code] = t.result ? t.result.issues : null;
    }
  } finally {
    for (const t of tiles) t.lang = P.activeLang;
    document.body.classList.remove("busy");
    editor.setReadOnly(false);
    await refreshAll();
  }
  renderMatrix(rows, cols, data);
}

function renderMatrix(rows, cols, data) {
  const m = $("matrix");
  m.hidden = false;
  m.textContent = "";
  const exp = S.expansion === "off" ? "" : ` · text expansion ${S.expansion === "smart" ? "smart" : "+" + S.expansion + "%"}`;
  const close = el("button", { className: "small", textContent: "Close" });
  close.addEventListener("click", () => (m.hidden = true));
  m.append(el("div", { className: "mhead" }, el("h3", { textContent: "All languages × viewports" }),
    el("span", { className: "hint", textContent: `${cols.length} languages, ${rows.length} viewports${exp}${S.accents ? " · accents" : ""}. Click a cell to open it.` }),
    el("span", { className: "spacer" }), close));
  const thead = el("tr", {}, el("th", { textContent: "Viewport" }), ...cols.map((c) => el("th", { textContent: c })));
  const body = rows.map((t) => el("tr", {},
    el("th", { textContent: `${t.name} · ${t.width}px` }),
    ...cols.map((c) => {
      const issues = data[t.key + "|" + c] || [];
      const errors = issues.filter((i) => i.level === "error").length;
      const b = el("button", {
        className: errors ? "error" : issues.length ? "warn" : "ok",
        textContent: errors ? `${errors} ✕` : issues.length ? `${issues.length} !` : "✓",
        title: issues.map((i) => "• " + i.msg).join("\n") || "No problems",
      });
      b.addEventListener("click", () => { if (P.activeLang !== c) setActiveLang(c); flash(t); });
      return el("td", {}, b);
    })));
  m.append(el("table", {}, el("thead", {}, thead), el("tbody", {}, ...body)));
}

function flash(t) {
  t.el.scrollIntoView({ behavior: "smooth", block: "start" });
  t.el.classList.remove("flash");
  void t.el.offsetWidth;
  t.el.classList.add("flash");
}

// ---- view + toolbar --------------------------------------------------------------------
function setView(v) {
  S.view = v;
  saveSettingsSoon();
  for (const b of $("viewSeg").children) b.classList.toggle("on", b.dataset.view === v);
  $("compareWidth").hidden = v !== "compare";
  rebuildTiles();
}

function renderCompareSelect() {
  const sel = $("compareWidth");
  const widths = [...new Set([...S.devices.map((d) => d.width), ...P.designs.map(targetWidth).filter(Boolean), S.compareWidth])].sort((a, b) => a - b);
  sel.textContent = "";
  for (const w of widths) sel.append(option(String(w), `at ${deviceName(w)} (${w}px)`, String(S.compareWidth)));
}

function bindToolbar() {
  for (const b of $("viewSeg").children) b.addEventListener("click", () => setView(b.dataset.view));
  $("compareWidth").addEventListener("change", (e) => { S.compareWidth = Number(e.target.value); saveSettingsSoon(); for (const t of tiles) t.width = S.compareWidth; tiles.forEach((t) => { sizeTile(t, false); renderTileInfo(t); }); reanalyzeAll(); });
  $("zoom").addEventListener("input", (e) => { S.zoom = Number(e.target.value); $("zoomOut").textContent = S.zoom + "%"; saveSettingsSoon(); tiles.forEach((t) => sizeTile(t, false)); });
  const toggle = (id, key, after) => $(id).addEventListener("change", (e) => { S[key] = e.target.checked; saveSettingsSoon(); after(); });
  toggle("fit", "fit", () => tiles.forEach((t) => sizeTile(t, false)));
  toggle("edges", "edges", () => rebuildTiles());
  toggle("sweep", "sweep", () => rebuildTiles());
  toggle("accents", "accents", refreshAll);
  toggle("showZones", "showZones", redrawOverlays);
  toggle("showDesign", "showDesign", redrawOverlays);
  $("expansion").addEventListener("change", (e) => { S.expansion = e.target.value; saveSettingsSoon(); refreshAll(); });
  $("designOpacity").addEventListener("input", (e) => {
    S.designOpacity = Number(e.target.value);
    saveSettingsSoon();
    if (S.designMode !== "overlay") return;
    for (const t of tiles) { const box = t.ready && t.iframe.contentDocument.getElementById("__bp_design"); if (box) box.style.opacity = S.designOpacity / 100; }
  });
  $("designBlend").addEventListener("change", (e) => { S.designBlend = e.target.value; saveSettingsSoon(); redrawDesigns(); });
  $("designMode").addEventListener("change", (e) => { S.designMode = e.target.value; saveSettingsSoon(); syncDesignControls(); redrawDesigns(); });
  toggle("designMove", "designMove", redrawDesigns);
  $("checkAll").addEventListener("click", checkAll);
}

// Opacity/blend only mean something for the overlay mode; Move doesn't apply to "below".
function syncDesignControls() {
  $("designOpacity").hidden = $("designBlend").hidden = S.designMode !== "overlay";
  $("designMoveLabel").hidden = S.designMode === "below";
}

function applySettingsToUI() {
  document.documentElement.style.setProperty("--side", S.sideWidth + "px");
  $("zoom").value = S.zoom;
  $("zoomOut").textContent = S.zoom + "%";
  $("fit").checked = S.fit;
  $("edges").checked = S.edges;
  $("sweep").checked = S.sweep;
  $("expansion").value = S.expansion;
  $("accents").checked = S.accents;
  $("showZones").checked = S.showZones;
  $("showDesign").checked = S.showDesign;
  $("designOpacity").value = S.designOpacity;
  $("designBlend").value = S.designBlend;
  $("designMode").value = S.designMode;
  $("designMove").checked = S.designMove;
  syncDesignControls();
  for (const b of $("viewSeg").children) b.classList.toggle("on", b.dataset.view === S.view);
  $("compareWidth").hidden = S.view !== "compare";
  $("setDevices").value = S.devices.map((d) => `${d.name} ${d.width}`).join("\n");
  $("setCss").value = S.stylesheets.join("\n");
  $("setBase").value = S.baseHref;
  $("setTolerance").value = S.balanceTolerance;
  renderCustomTemplates();
}

// ---- settings panel ------------------------------------------------------------------
function renderCustomTemplates() {
  const box = $("customTpls");
  box.textContent = "";
  for (const t of customTemplates) {
    const rm = el("button", { className: "small danger", textContent: "Remove" });
    rm.addEventListener("click", async () => {
      customTemplates = customTemplates.filter((x) => x !== t);
      await store.setJSON(store.nsKey("templates"), customTemplates);
      if (P.template === t.id) { P.template = "category"; saveProjectSoon(); reloadAll(); }
      renderCustomTemplates();
      renderLayout();
    });
    box.append(el("div", { className: "tpl" }, el("span", { textContent: t.name, title: t.name }), rm));
  }
}

function bindSettings() {
  $("applySettings").addEventListener("click", () => {
    const devices = $("setDevices").value.split(/\r?\n/).map((line) => {
      const m = line.trim().match(/^(.*?)[\s,]+(\d{3,4})\s*(px)?$/);
      return m ? { name: m[1].trim() || m[2], width: Number(m[2]) } : null;
    }).filter(Boolean);
    if (!devices.length) return toast("Add at least one viewport, e.g. “XS 415”.");
    S.devices = devices;
    const css = $("setCss").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const cssChanged = css.join("\n") !== S.stylesheets.join("\n");
    S.stylesheets = css;
    if (cssChanged) loadClasses();
    S.baseHref = $("setBase").value.trim();
    S.balanceTolerance = Math.max(0, Number($("setTolerance").value) || 0);
    saveSettingsSoon();
    applySettingsToUI();
    rebuildTiles(true);
    toast("Settings applied.");
  });
  $("resetSettings").addEventListener("click", () => {
    if (!confirm("Reset viewports, stylesheets and toolbar options to defaults?")) return;
    S = { ...store.DEFAULT_SETTINGS };
    saveSettingsSoon();
    applySettingsToUI();
    rebuildTiles(true);
  });
  $("tplFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const html = await f.text();
    if (!html.includes("@@BANNER_SNIPPET@@")) toast(`No @@BANNER_SNIPPET@@ token found; the ${TOOL.noun} will be added at the end of <body>.`);
    const t = { id: "custom-" + store.uid(), name: f.name.replace(/\.html?$/i, ""), html };
    customTemplates.push(t);
    await store.setJSON(store.nsKey("templates"), customTemplates);
    renderCustomTemplates();
    P.template = t.id;
    renderLayout();
    onLayoutChanged();
  });
}

// ---- banners (projects) ----------------------------------------------------------------
function normalizeProject(p) {
  const base = store.newProject(p.name);
  p = { ...base, ...p, tool: TOOL.id, layout: { ...base.layout, ...(p.layout || {}) }, mixin: { ...base.mixin, ...(p.mixin || {}) } };
  if (!p.langs || !p.langs.length) p.langs = base.langs;
  if (!p.langs.some((l) => l.code === p.activeLang)) p.activeLang = p.langs[0].code;
  if (!BUILTIN_TEMPLATES.some((t) => t.id === p.template) && !customTemplates.some((t) => t.id === p.template)) p.template = TOOL.template;
  p.images ||= {};
  p.zones ||= {};
  p.balance ||= {}; // slot -> "h" | "v" | "hv"
  p.copyAreas ||= {}; // slot -> { x, y, w, h } as fractions of the image
  p.designs = (p.designs || []).map((d) => ({
    fit: "width", dx: 0, dy: 0, scale: 100, ...d,
    target: d.target || guessTarget(d.width || 1210, p.template), // designs saved before targets existed only had a width
  }));
  return p;
}

async function renderProjectList() {
  const list = await store.listProjects();
  const sel = $("projSel");
  sel.textContent = "";
  for (const r of list) sel.append(option(r.id, r.name, P.id));
}

async function openProject(p) {
  P = normalizeProject(p);
  await store.setLastProjectId(P.id);
  for (const img of Object.values(P.images)) if (img && img.blob) await ensureBlobUrl(img.blob);
  for (const d of P.designs) {
    await ensureBlobUrl(d.blob);
    if (!d.natW && blobUrls.get(d.blob)) Object.assign(d, await imageSize(blobUrls.get(d.blob)).then(({ w, h }) => ({ natW: w, natH: h })));
  }
  await renderProjectList();
  editor.setValue(langHtml(P.activeLang), P.id + "|" + P.activeLang);
  lastSnippetImages = JSON.stringify(snippetImages(langHtml(P.activeLang)));
  $("matrix").hidden = true;
  renderLangs();
  renderLayout();
  renderSlots();
  renderDesigns();
  runLint();
  rebuildTiles(true);
}

async function switchProject(id) {
  await store.saveProject(P);
  const p = await store.loadProject(id);
  if (p) await openProject(p);
}

function bindProjects() {
  $("projSel").addEventListener("change", (e) => switchProject(e.target.value));
  $("projNew").addEventListener("click", async () => {
    const name = prompt(`Name for the new ${TOOL.noun} (e.g. “Heart Health – Feb 2026”):`, "");
    if (name == null) return;
    await store.saveProject(P);
    const p = store.newProject(name.trim() || `Untitled ${TOOL.noun}`);
    await store.saveProject(p);
    await openProject(p);
  });
  $("projDup").addEventListener("click", async () => {
    const name = prompt("Name for the copy:", P.name + " (copy)");
    if (name == null) return;
    await store.saveProject(P);
    await openProject(await store.duplicateProject(P, name.trim() || P.name + " (copy)"));
  });
  $("projRename").addEventListener("click", async () => {
    const name = prompt(`Rename ${TOOL.noun}:`, P.name);
    if (!name || !name.trim()) return;
    P.name = name.trim();
    await store.saveProject(P);
    renderProjectList();
  });
  $("projDel").addEventListener("click", async () => {
    if (!confirm(`Delete “${P.name}”? Its copy, images and zones will be removed.`)) return;
    await store.deleteProject(P);
    const list = await store.listProjects();
    let next = list[0] && (await store.loadProject(list[0].id));
    if (!next) { next = store.newProject(`Untitled ${TOOL.noun}`); await store.saveProject(next); }
    await openProject(next);
  });
  $("exportBtn").addEventListener("click", async () => {
    const data = await store.exportProject(P);
    const a = el("a", {
      href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })),
      download: P.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + (TOOL.id === "mixin" ? ".mixin.json" : ".banner.json"),
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("importFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      await store.saveProject(P);
      await openProject(await store.importProject(JSON.parse(await f.text())));
      toast("Imported “" + P.name + "”.");
    } catch (err) { toast("Couldn't import: " + err.message); }
  });
  $("importTab").addEventListener("click", () => importFromTab());
}

// ---- import from a melaleuca.com tab -------------------------------------------------------
function layoutFromClasses(bannerClasses, rowClasses) {
  const bc = (bannerClasses || "").split(/\s+/), rc = (rowClasses || "").split(/\s+/);
  const known = new Set(Object.values(LAYOUT_OPTIONS).flat().map(([v]) => v).filter(Boolean));
  const pick = (list, opts) => list.find((c) => opts.some(([v]) => v && v === c));
  return {
    height: pick(bc, LAYOUT_OPTIONS.height) || "-h-sm",
    width: pick(rc, LAYOUT_OPTIONS.width) || "-w-sm",
    align: pick(rc, LAYOUT_OPTIONS.align) || "-left",
    valign: pick(rc, LAYOUT_OPTIONS.valign) || "",
    extra: rc.filter((c) => c && c !== "m-fwBanner__row" && c !== "-columns" && !known.has(c)).join(" "),
  };
}

async function importFromTab(tabId) {
  if (!IN_EXTENSION) return toast("Importing from a tab only works inside the browser extension.");
  if (!tabId) {
    const tabs = await chrome.tabs.query({ url: "https://*.melaleuca.com/*" });
    if (!tabs.length) return toast("Open a melaleuca.com page in another tab first.");
    tabId = tabs.length === 1 ? tabs[0].id : await choose("Import from which tab?", tabs.map((t) => ({ label: t.title || t.url, sub: t.url, value: t.id })));
    if (tabId == null) return;
  }
  let found;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: extractBanners });
    found = (r && r.result) || [];
  } catch (err) { return toast("Couldn't read that tab: " + err.message); }
  // Each tool only imports its own kind: category banners here, mix-in ads in Mix-In Ad Preview.
  const banners = found.filter((b) => (b.template === "mixin" ? "mixin" : "banner") === TOOL.id);
  if (!banners.length) {
    return toast(found.length
      ? `That page has no ${TOOL.badge.toLowerCase()}s, only ${OTHER.badge.toLowerCase()}s. Use ${OTHER.name} for those.`
      : `No ${TOOL.badge.toLowerCase()}s found on that page.`);
  }
  const idx = banners.length === 1 ? 0 : await choose(`Which ${TOOL.noun}?`, banners.map((b, i) => ({
    label: b.label || "(no text)", sub: b.url, value: i,
  })));
  if (idx == null) return;
  const b = banners[idx];
  const code = b.lang || "en-US";
  const existing = P.langs.find((l) => l.code.toLowerCase() === code.toLowerCase());
  const N = TOOL.noun;
  const target = await choose("Import into…", [
    { label: `A new ${N}`, sub: "Copy, images and layout from the page", value: "new" },
    { label: existing ? `This ${N}: replace the ${existing.code} copy` : `This ${N}, as a new ${code} language`, sub: `Keeps this ${N}'s images and zones`, value: "lang" },
  ]);
  if (!target) return;
  if (target === "new") {
    await store.saveProject(P);
    const p = store.newProject(b.label.slice(0, 50) || `Imported ${N}`);
    if (TOOL.id === "banner") p.layout = layoutFromClasses(b.bannerClasses, b.rowClasses);
    p.langs = [{ code, html: b.html }];
    p.activeLang = code;
    for (const [slot, url] of Object.entries(b.images)) if (url) p.images[slot] = { url };
    await store.saveProject(p);
    await openProject(p);
  } else {
    if (existing) existing.html = b.html;
    else P.langs.push({ code, html: b.html });
    for (const [slot, url] of Object.entries(b.images)) if (url && !P.images[slot]) P.images[slot] = { url };
    renderSlots();
    if (S.view === "compare") rebuildTiles();
    setActiveLang(existing ? existing.code : code);
    reloadAll();
  }
  toast("Imported from " + new URL(b.url).hostname);
}

function handleHash() {
  const m = /import-tab=(\d+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  importFromTab(Number(m[1]));
}

// ---- generic chooser dialog --------------------------------------------------------------
function choose(title, items, body = null) {
  const dlg = $("pickDlg");
  $("pickTitle").textContent = title;
  $("pickBody").replaceChildren(...(body ? [body] : []));
  const list = $("pickList");
  list.textContent = "";
  return new Promise((resolve) => {
    let value = null;
    for (const it of items) {
      // With a form body (e.g. a text field), the single action is a real submit button so Enter works.
      const b = el("button", { type: body ? "submit" : "button", className: body ? "primary" : "" },
        el("b", { textContent: it.label }), it.sub ? el("small", { textContent: it.sub }) : null);
      if (!body) b.addEventListener("click", () => { value = it.value; dlg.close(); });
      list.append(b);
    }
    $("pickForm").onsubmit = (e) => { e.preventDefault(); if (body) { value = items[0].value; dlg.close(); } };
    $("pickClose").onclick = () => dlg.close();
    dlg.onclose = () => resolve(value);
    dlg.showModal();
  });
}

// ---- brand classes (autocomplete + reference) --------------------------------------------
async function loadClasses() {
  const status = $("classStatus");
  status.textContent = "Reading app.css…";
  const idx = await loadClassIndex(S.stylesheets).catch(() => null);
  if (!idx || !idx.size) {
    status.textContent = "Couldn't read the stylesheet, so class suggestions are off.";
    return;
  }
  classIdx = idx;
  setClassIndex(idx);
  const base = [...idx.keys()].filter((k) => !k.includes(":")).length;
  status.textContent = `${base.toLocaleString()} classes from app.css`;
  status.title = "Type inside class=\"…\" for suggestions (Ctrl+Space to open them). Hover a class to see its CSS.";
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const REF_KINDS =["color", "type", "space", "size", "layout", "other", "comp"];
let refKind = "color";

function openClassRef() {
  if (!classIdx) return toast("Classes are still loading (or the stylesheet couldn't be read).");
  const sel = $("classPrefix");
  if (sel.options.length <= 1) for (const [p, info] of prefixInfo(classIdx)) sel.append(option(p, `${p}: (${info})`, ""));
  const seg = $("classKinds");
  if (!seg.children.length) {
    for (const k of REF_KINDS) {
      const b = el("button", { textContent: KIND_LABELS[k], type: "button" });
      b.dataset.kind = k;
      b.addEventListener("click", () => { refKind = k; renderClassRef(); });
      seg.append(b);
    }
  }
  $("classDlg").show();
  renderClassRef();
  $("classSearch").focus();
}

function renderClassRef() {
  for (const b of $("classKinds").children) b.classList.toggle("on", b.dataset.kind === refKind);
  const prefix = $("classPrefix").value;
  const terms = $("classSearch").value.toLowerCase().split(/\s+/).filter(Boolean);
  const want = prefix ? prefix + ":" : "";
  const rows = [];
  let total = 0;
  for (const e of classIdx.values()) {
    if (want ? !e.name.startsWith(want) || e.name.slice(want.length).includes(":") : e.name.includes(":")) continue;
    if (!terms.length && e.kind !== refKind) continue;
    const hay = (e.name + " " + e.summary).toLowerCase();
    if (terms.length && !terms.every((t) => hay.includes(t))) continue;
    total++;
    if (rows.length < 300) rows.push(e);
  }
  const list = $("classList");
  list.textContent = "";
  const pick = async (name) => {
    if (editor.insertClass(name)) toast(`Added ${name}`);
    else { await navigator.clipboard.writeText(name); toast(`Copied ${name}. Put the cursor inside class="…" to insert directly.`); }
  };

  // Colors: a palette, one row per color with every class that applies it.
  if (refKind === "color" && !terms.length) {
    const byColor = new Map();
    for (const e of classIdx.values()) {
      if (e.kind !== "color" || !e.swatch || (want ? !e.name.startsWith(want) || e.name.slice(want.length).includes(":") : e.name.includes(":"))) continue;
      const k = e.swatch.toLowerCase();
      if (!byColor.has(k)) byColor.set(k, []);
      byColor.get(k).push(e.name);
    }
    for (const [color, names] of [...byColor].sort((a, b) => b[1].length - a[1].length)) {
      const chips = names.sort(natural).map((n) => {
        const c = el("button", { type: "button", className: "chip2", textContent: n });
        c.addEventListener("click", () => pick(n));
        return c;
      });
      const sw = el("span", { className: "prev big" });
      sw.style.background = color;
      list.append(el("div", { className: "pal" }, sw, el("code", { className: "hex", textContent: color }), el("div", { className: "chips" }, ...chips)));
    }
    $("classCount").textContent = `${byColor.size} colors`;
    return;
  }

  rows.sort((a, b) => natural(a.name, b.name));
  for (const e of rows) {
    let preview = el("span", { className: "prev" });
    if (e.swatch) preview.style.background = e.swatch;
    else if (e.kind === "type" && e.rules[0]) {
      preview = el("span", { className: "prev aa", textContent: "Aa" });
      preview.style.cssText = e.rules[0].decl;
      if (parseFloat(preview.style.fontSize) > 22) preview.style.fontSize = "22px"; // the exact size is in the summary
    }
    const b = el("button", { type: "button", className: "cls", title: e.rules.map((r) => (r.media ? `@media ${r.media}\n` : "") + r.decl).join("\n\n") || e.summary },
      preview, el("code", { textContent: e.name }), el("span", { className: "sum", textContent: e.summary }));
    b.addEventListener("click", () => pick(e.name));
    list.append(b);
  }
  $("classCount").textContent = total > rows.length ? `showing ${rows.length} of ${total.toLocaleString()}` : `${total.toLocaleString()} classes`;
}

function bindClassRef() {
  $("classSearch").addEventListener("input", debounce(renderClassRef, 120));
  $("classPrefix").addEventListener("change", renderClassRef);
  $("classClose").addEventListener("click", () => $("classDlg").close());
  $("classDlg").addEventListener("keydown", (e) => { if (e.key === "Escape") $("classDlg").close(); });
}

// ---- editor + layout bindings ------------------------------------------------------------
function bindEditor() {
  editor = createEditor($("editor"), {
    placeholderText: TOOL.placeholder,
    onChange: (text) => { langObj(P.activeLang).html = text; onCopyChanged(); },
    onSave: (msg) => (msg ? toast(msg) : store.saveProject(P).then(() => toast("Saved."))),
  });
  $("copyHtml").addEventListener("click", async () => {
    await navigator.clipboard.writeText(editor.getValue());
    toast(`Copied the ${P.activeLang} HTML.`);
  });
  $("formatHtml").addEventListener("click", () => { const err = editor.format(); toast(err || "Formatted."); });
  $("classRef").addEventListener("click", openClassRef);
  for (const id of ["tplSel", "lyHeight", "lyWidth", "lyAlign", "lyValign"]) $(id).addEventListener("change", onLayoutChanged);
  $("lyExtra").addEventListener("change", onLayoutChanged);
  $("mxNeighbors").addEventListener("change", onLayoutChanged);
  $("designFile").addEventListener("change", (e) => { addDesigns([...e.target.files]); e.target.value = ""; });
  // Paste a screenshot (e.g. copied from XD) anywhere to add it as a design overlay.
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData && e.clipboardData.files || [])].filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    // Pasting into the editor or a field when the clipboard also has text: that's a text paste.
    if (e.target.closest && e.target.closest(".cm-editor, input, textarea") && e.clipboardData.getData("text/plain")) return;
    e.preventDefault();
    addDesigns(files, "Pasted " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  });
}

function bindSplitter() {
  const sp = $("splitter");
  sp.addEventListener("pointerdown", (e) => {
    sp.setPointerCapture(e.pointerId);
    sp.classList.add("drag");
    const move = (ev) => {
      S.sideWidth = Math.round(Math.min(Math.max(ev.clientX, 300), window.innerWidth * 0.6));
      document.documentElement.style.setProperty("--side", S.sideWidth + "px");
    };
    const up = () => {
      sp.classList.remove("drag");
      sp.removeEventListener("pointermove", move);
      sp.removeEventListener("pointerup", up);
      saveSettingsSoon();
    };
    sp.addEventListener("pointermove", move);
    sp.addEventListener("pointerup", up);
  });
  new ResizeObserver(debounce(() => tiles.forEach((t) => sizeTile(t, false)), 60)).observe($("tiles"));
}

// ---- start ---------------------------------------------------------------------------------
/** Name, colors and wording for the tool this page is running as. */
function applyBranding() {
  document.title = TOOL.name;
  document.body.classList.add("tool-" + TOOL.id);
  $("brandLogo").textContent = TOOL.logo;
  $("brandName").textContent = TOOL.name;
  $("toolBadge").textContent = TOOL.badge;
  $("copyHint").textContent = TOOL.copyHint;
  $("otherTool").textContent = "Open " + OTHER.name;
  $("otherTool").addEventListener("click", () => { location.href = toolUrl(OTHER); });
  $("wrongToolText").textContent = `This is ${OTHER.badge.toLowerCase()} markup, so it won't preview correctly in ${TOOL.name}.`;
  $("moveTool").textContent = `Move it to ${OTHER.name}`;
  $("moveTool").addEventListener("click", moveToOtherTool);
  $("layoutTitle").textContent = TOOL.id === "mixin" ? "Template & grid" : "Template & layout";
}

async function init() {
  S = await store.loadSettings();
  customTemplates = await store.getJSON(store.nsKey("templates"), []);
  let p = null;
  const last = await store.getLastProjectId();
  if (last) p = await store.loadProject(last);
  if (!p) { const list = await store.listProjects(); if (list[0]) p = await store.loadProject(list[0].id); }
  if (!p) {
    const sample = SAMPLES[TOOL.id];
    p = store.newProject(sample.name);
    p.langs[0].html = sample.html;
    for (const [slot, url] of Object.entries(sample.images)) p.images[slot] = { url };
    await store.saveProject(p);
  }
  applyBranding();
  if (!IN_EXTENSION) $("importTab").title = "Only available inside the browser extension";
  bindProjects();
  bindEditor();
  bindToolbar();
  bindSettings();
  bindZoneEditor();
  bindSplitter();
  bindClassRef();
  bindJumpbar();
  applySettingsToUI();
  await openProject(p);
  loadClasses();
  await takeHandoff();
  handleHash();
  window.addEventListener("hashchange", handleHash);
  window.addEventListener("beforeunload", () => { if (P) store.saveProject(P); });
}

init();
