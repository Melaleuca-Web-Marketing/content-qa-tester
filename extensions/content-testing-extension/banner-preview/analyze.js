// Layout checks run inside each preview iframe (same origin as this page, so we can measure).
//
// Keep-out zones are stored as fractions of the background image. Because the banner image uses
// object-fit: cover (background-size: cover for mix-ins), the visible crop changes with every
// width, so each zone is mapped through the same cover/contain math the browser uses before it's
// compared against the rendered line boxes of the copy.

import { contentNodes } from "./render.js";

const BG_PARTS = ".m-fwBanner__row.-media, .m-mixinAd__bg, .m-fwBanner__bgImage, picture.a-genImg";
const OURS = "#__bp_ov, #__bp_design";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForAssets(doc, timeout = 3000) {
  const pending = [...doc.images].filter((i) => !i.complete).map((i) => new Promise((r) => {
    i.addEventListener("load", r, { once: true });
    i.addEventListener("error", r, { once: true });
  }));
  await Promise.race([Promise.all([doc.fonts ? doc.fonts.ready : null, ...pending]), sleep(timeout)]);
}

const naturalCache = new Map();
function naturalSize(url) {
  if (!naturalCache.has(url)) {
    naturalCache.set(url, new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve(null);
      im.src = url;
    }));
  }
  return naturalCache.get(url);
}

function offset(v, boxLen, imgLen) {
  v = (v || "").trim();
  if (v.endsWith("%")) return (boxLen - imgLen) * parseFloat(v) / 100;
  if (v.endsWith("px")) return parseFloat(v);
  return (boxLen - imgLen) / 2;
}

function fitSize(mode, box, nat) {
  if (mode === "contain") { const s = Math.min(box.width / nat.w, box.height / nat.h); return [nat.w * s, nat.h * s]; }
  if (mode === "fill") return [box.width, box.height];
  if (mode === "none" || mode === "auto") return [nat.w, nat.h];
  const s = Math.max(box.width / nat.w, box.height / nat.h); // cover
  return [nat.w * s, nat.h * s];
}

/** Where the background image is drawn and how big it is: { box, img: {x,y,w,h} } or null. */
async function backgroundGeometry(doc) {
  const win = doc.defaultView;
  const img = doc.querySelector(".m-fwBanner__row.-media img, img.a-genImg__img");
  if (img && img.getBoundingClientRect().width > 0) {
    const box = img.getBoundingClientRect();
    if (!img.naturalWidth) return { box, broken: img.complete };
    const cs = win.getComputedStyle(img);
    const nat = { w: img.naturalWidth, h: img.naturalHeight };
    const [w, h] = fitSize(cs.objectFit, box, nat);
    const [px, py] = cs.objectPosition.split(/\s+/);
    return { box, img: { x: box.left + offset(px, box.width, w), y: box.top + offset(py, box.height, h), w, h } };
  }
  const bg = doc.querySelector(".m-mixinAd__bg, .m-fwBanner__bgImage");
  if (bg && bg.getBoundingClientRect().width > 0) {
    const box = bg.getBoundingClientRect();
    const cs = win.getComputedStyle(bg);
    const m = /url\(["']?([^"')]+)/.exec(cs.backgroundImage);
    const nat = m && (await naturalSize(m[1]));
    if (!nat) return { box, broken: !!m };
    const size = cs.backgroundSize.split(",")[0].trim();
    const [w, h] = fitSize(size === "cover" || size === "contain" ? size : "auto", box, nat);
    const px = cs.backgroundPositionX.split(",")[0], py = cs.backgroundPositionY.split(",")[0];
    return { box, img: { x: box.left + offset(px, box.width, w), y: box.top + offset(py, box.height, h), w, h } };
  }
  return null;
}

function intersect(a, b) {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}

const visible = (el) => !el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
const sample = (s) => { s = s.replace(/\s+/g, " ").trim(); return s.length > 40 ? s.slice(0, 38) + "…" : s; };

/** Rendered pieces of the snippet: one entry per line box of text, plus content images (logos). */
function contentItems(doc) {
  const items = [];
  const range = doc.createRange();
  const filter = { acceptNode: (n) => (n.nodeType === 1 && n.matches(BG_PARTS + "," + OURS + ",style,script,template,noscript") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) };
  for (const top of contentNodes(doc)) {
    if (top.nodeType === 1 && filter.acceptNode(top) === NodeFilter.FILTER_REJECT) continue;
    const walker = doc.createTreeWalker(top, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, filter);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (!n.data.trim() || !n.parentElement || !visible(n.parentElement)) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.width > 1 && r.height > 1) items.push({ kind: "text", rect: r, el: n.parentElement, label: sample(n.data) });
        }
      } else if (n.tagName === "IMG" && visible(n)) {
        const r = n.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) items.push({ kind: "img", rect: r, el: n, label: "image " + sample(n.getAttribute("alt") || n.getAttribute("src") || "") });
      }
    }
  }
  return items;
}

/** The closest ancestor (up to the banner) that clips overflow. */
function clipper(el, stop) {
  const win = el.ownerDocument.defaultView;
  for (let p = el.parentElement; p && p !== stop.parentElement; p = p.parentElement) {
    const cs = win.getComputedStyle(p);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return p;
  }
  return null;
}

/**
 * opts: { slot, zones: [{x,y,w,h}], placeholder: bool }
 * Returns { slot, bannerH, minH, issues: [{level, msg}], zones: [{rect, hit}], marks: [{rect, level}] }
 */
export async function analyze(doc, opts) {
  doc.getElementById("__bp_ov")?.remove();
  doc.getElementById("__bp_design")?.remove();
  const win = doc.defaultView;
  const issues = [];
  const marks = [];
  const res = { slot: opts.slot, issues, marks, zones: [], bannerH: 0, minH: 0 };

  const banner = doc.querySelector(".m-fwBanner, .m-mixinAd");
  const items = contentItems(doc);

  if (banner) {
    const br = banner.getBoundingClientRect();
    res.bannerRect = br;
    res.bannerH = Math.round(br.height);
    res.minH = Math.round(parseFloat(win.getComputedStyle(banner).minHeight) || 0);
    if (res.minH && res.bannerH > res.minH + 1) {
      issues.push({ level: "warn", msg: `Banner grew to ${res.bannerH}px (set height ${res.minH}px), so the image crops differently than the design` });
    }
    const clipped = new Set();
    for (const it of items) {
      const c = clipper(it.el, banner);
      const bound = c ? c.getBoundingClientRect() : br;
      const r = it.rect;
      if (r.left < bound.left - 1 || r.right > bound.right + 1 || r.top < bound.top - 1 || r.bottom > bound.bottom + 1) {
        marks.push({ rect: r, level: "clip" });
        if (!clipped.has(it.label)) {
          clipped.add(it.label);
          issues.push({ level: "error", msg: `${it.kind === "img" ? "Image" : "Text"} runs outside the ${c && c !== banner ? "box that clips it" : "banner"}: “${it.label}”` });
        }
      }
    }
  }

  const sw = doc.documentElement.scrollWidth, vw = doc.documentElement.clientWidth;
  if (sw > vw + 1) issues.push({ level: "error", msg: `Page is ${sw - vw}px wider than the viewport (horizontal scroll)` });

  const geo = await backgroundGeometry(doc);
  if (opts.placeholder) issues.push({ level: "warn", msg: `No ${opts.slot} image set — showing a placeholder` });
  else if (geo && geo.broken) issues.push({ level: "error", msg: `The ${opts.slot} background image failed to load` });

  for (const im of doc.images) {
    if (im.complete && !im.naturalWidth && !im.closest(BG_PARTS)) {
      issues.push({ level: "error", msg: `Image failed to load: ${sample(im.getAttribute("src") || "")}` });
    }
  }

  if (geo && geo.img) {
    // The part of the image visible at this width, as fractions (drawn as guides in the zone editor).
    const c = (v) => Math.min(1, Math.max(0, v));
    const x = c((geo.box.left - geo.img.x) / geo.img.w), y = c((geo.box.top - geo.img.y) / geo.img.h);
    res.visible = { x, y, w: c((geo.box.right - geo.img.x) / geo.img.w) - x, h: c((geo.box.bottom - geo.img.y) / geo.img.h) - y };
  }

  // Image-fraction rect -> on-screen rect at this width.
  const mapRect = (z) => ({
    left: geo.img.x + z.x * geo.img.w, top: geo.img.y + z.y * geo.img.h,
    right: geo.img.x + (z.x + z.w) * geo.img.w, bottom: geo.img.y + (z.y + z.h) * geo.img.h,
  });

  if (geo && geo.img && opts.zones && opts.zones.length) {
    const hitLabels = new Set();
    for (const z of opts.zones) {
      const vis = intersect(mapRect(z), geo.box);
      if (!vis) continue; // cropped out at this width
      const zone = { rect: vis, hit: false };
      res.zones.push(zone);
      for (const it of items) {
        const hit = intersect(it.rect, vis);
        if (!hit) continue;
        zone.hit = true;
        marks.push({ rect: it.rect, level: "hit" });
        if (!hitLabels.has(it.label)) {
          hitLabels.add(it.label);
          issues.push({ level: "error", msg: `${it.kind === "img" ? "Image" : "Text"} overlaps a keep-out zone: “${it.label}”` });
        }
      }
    }
  }

  // Center-copy balance is shown only as guides (gap labels, green/amber), not as issues.
  if (opts.balance && items.length && res.bannerRect) {
    const area = opts.copyArea && geo && geo.img ? intersect(mapRect(opts.copyArea), res.bannerRect) : null;
    res.balance = balanceOf(items, res.zones, res.bannerRect, area, opts.balance);
    const b = res.balance, tol = opts.tolerance ?? 6;
    b.okH = !b.axes.includes("h") || Math.abs(b.dx) <= tol;
    b.okV = !b.axes.includes("v") || Math.abs(b.dy) <= tol;
  }
  return res;
}

/**
 * The empty space the copy sits in, and how far the copy is from its center.
 * Without a drawn copy area, the space runs from the banner edges to the nearest keep-out zone on each
 * side of the copy (only zones level with the copy count for left/right, and zones in line with it for top/bottom).
 */
function balanceOf(items, zones, banner, area, axes) {
  const T = items.reduce((u, it) => ({
    left: Math.min(u.left, it.rect.left), top: Math.min(u.top, it.rect.top),
    right: Math.max(u.right, it.rect.right), bottom: Math.max(u.bottom, it.rect.bottom),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const S = area
    ? { left: area.left, top: area.top, right: area.right, bottom: area.bottom }
    : { left: banner.left, top: banner.top, right: banner.right, bottom: banner.bottom };
  if (!area) {
    const cx = (T.left + T.right) / 2, cy = (T.top + T.bottom) / 2;
    for (const { rect: z } of zones) {
      const zcx = (z.left + z.right) / 2, zcy = (z.top + z.bottom) / 2;
      if (z.top < T.bottom && z.bottom > T.top) { // level with the copy
        if (zcx > cx && z.left < S.right) S.right = z.left;
        if (zcx <= cx && z.right > S.left) S.left = z.right;
      }
      if (z.left < T.right && z.right > T.left) { // in line with the copy
        if (zcy > cy && z.top < S.bottom) S.bottom = z.top;
        if (zcy <= cy && z.bottom > S.top) S.top = z.bottom;
      }
    }
  }
  const gaps = {
    l: Math.round(T.left - S.left), r: Math.round(S.right - T.right),
    t: Math.round(T.top - S.top), b: Math.round(S.bottom - T.bottom),
  };
  return {
    axes, gaps,
    space: { ...S, width: S.right - S.left, height: S.bottom - S.top },
    text: { ...T, width: T.right - T.left, height: T.bottom - T.top },
    dx: Math.round((gaps.r - gaps.l) / 2), // + = copy should move right
    dy: Math.round((gaps.b - gaps.t) / 2), // + = copy should move down
  };
}

/** Space outline, copy box, center lines and gap dimensions for the balance check. */
function drawBalance(doc, b, sx, sy) {
  const frag = doc.createDocumentFragment();
  const div = (css, text) => {
    const d = doc.createElement("div");
    d.style.cssText = "position:absolute;box-sizing:border-box;" + css;
    if (text != null) d.textContent = text;
    frag.appendChild(d);
    return d;
  };
  const at = (r) => `left:${r.left + sx}px;top:${r.top + sy}px;width:${Math.max(0, r.right - r.left)}px;height:${Math.max(0, r.bottom - r.top)}px;`;
  const S = b.space, T = b.text;
  div(at(S) + "border:1.5px dashed #22c55e;background:rgba(34,197,94,.06)");
  div(at(T) + "border:1px solid rgba(56,189,248,.9)");
  const label = (x, y, text, ok) => div(`left:${x + sx}px;top:${y + sy}px;transform:translate(-50%,-50%);padding:0 5px;border-radius:8px;` +
    `font:700 11px/16px system-ui,sans-serif;color:#fff;white-space:nowrap;background:${ok ? "#16a34a" : "#d97706"}`, text);

  if (b.axes.includes("h")) {
    const ok = b.okH, color = ok ? "#22c55e" : "#f59e0b";
    const y = (T.top + T.bottom) / 2;
    const cx = (S.left + S.right) / 2;
    div(`left:${cx + sx}px;top:${S.top + sy}px;width:0;height:${S.height}px;border-left:1.5px dashed ${color}`);
    div(`left:${S.left + sx}px;top:${y + sy}px;width:${Math.max(0, T.left - S.left)}px;height:0;border-top:2px solid ${color}`);
    div(`left:${T.right + sx}px;top:${y + sy}px;width:${Math.max(0, S.right - T.right)}px;height:0;border-top:2px solid ${color}`);
    label((S.left + T.left) / 2, y, b.gaps.l + "px", ok);
    label((T.right + S.right) / 2, y, b.gaps.r + "px", ok);
  }
  if (b.axes.includes("v")) {
    const ok = b.okV, color = ok ? "#22c55e" : "#f59e0b";
    const x = (T.left + T.right) / 2;
    const cy = (S.top + S.bottom) / 2;
    div(`left:${S.left + sx}px;top:${cy + sy}px;width:${S.width}px;height:0;border-top:1.5px dashed ${color}`);
    div(`left:${x + sx}px;top:${S.top + sy}px;width:0;height:${Math.max(0, T.top - S.top)}px;border-left:2px solid ${color}`);
    div(`left:${x + sx}px;top:${T.bottom + sy}px;width:0;height:${Math.max(0, S.bottom - T.bottom)}px;border-left:2px solid ${color}`);
    label(x, (S.top + T.top) / 2, b.gaps.t + "px", ok);
    label(x, (T.bottom + S.bottom) / 2, b.gaps.b + "px", ok);
  }
  return frag;
}

/** Draws zones and problem boxes into the preview document (the design overlay is drawn by app.js). */
export function drawOverlay(doc, res, opts = {}) {
  doc.getElementById("__bp_ov")?.remove();
  const sx = doc.defaultView.scrollX, sy = doc.defaultView.scrollY;
  const box = (r, css) => {
    const d = doc.createElement("div");
    d.style.cssText = `position:absolute;left:${r.left + sx}px;top:${r.top + sy}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;${css}`;
    return d;
  };

  const ov = doc.createElement("div");
  ov.id = "__bp_ov";
  ov.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none";
  if (opts.showZones) {
    for (const z of res.zones) {
      ov.appendChild(box(z.rect, z.hit
        ? "border:2px dashed #ff0033;background:repeating-linear-gradient(45deg,rgba(255,0,51,.22) 0 6px,rgba(255,0,51,.08) 6px 12px)"
        : "border:2px dashed #0ea5e9;background:repeating-linear-gradient(45deg,rgba(14,165,233,.2) 0 6px,rgba(14,165,233,.06) 6px 12px)"));
    }
  }
  for (const m of res.marks) {
    ov.appendChild(box(m.rect, m.level === "hit"
      ? "outline:2px solid #ff0033;background:rgba(255,0,51,.15)"
      : "outline:2px solid #f59e0b;background:rgba(245,158,11,.15)"));
  }
  if (res.balance && opts.showBalance !== false) ov.appendChild(drawBalance(doc, res.balance, sx, sy));
  doc.body.appendChild(ov);
}
