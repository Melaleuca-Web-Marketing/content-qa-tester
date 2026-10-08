// Index of every class in the brand stylesheets (app.css), used by the editor for autocomplete,
// hover info, "unknown class" warnings and the class reference. Built from the live CSS listed under
// Settings → Stylesheets, so it always matches what the preview renders with.

const KIND_PROPS = [
  ["color", /^(color|background-color|border(-\w+)?-color|fill|stroke)$/],
  ["type", /^(font-size|font-weight|font-family|font-style|line-height|letter-spacing|text-transform|text-align|text-decoration|white-space|word-break)$/],
  ["space", /^(padding|margin)(-\w+)?$|^gap$|^(row|column)-gap$/],
  ["size", /^(min-|max-)?(width|height)$/],
  ["layout", /^(display|flex|flex-\w+|grid|grid-\w+|justify-\w+|align-\w+|place-\w+|order|position|top|right|bottom|left|inset|z-index|float|clear|overflow(-\w)?|object-\w+)$/],
];

export const KIND_LABELS = { color: "Colors", type: "Typography", space: "Spacing", size: "Sizing", layout: "Layout", other: "Other", comp: "Components" };

// Classes that scripts add at runtime (lazy-loading etc.); fine to have even though app.css doesn't style them.
export const RUNTIME_CLASSES = new Set(["loaded", "lazy", "lazyload", "lazyloaded", "lazyloading", "initial", "entered", "error"]);

// The CSSOM reports colors as rgb(); show hex like XD and the stylesheet source do.
const hex2 = (n) => Number(n).toString(16).padStart(2, "0");
const toHex = (s) => s.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g, (m, r, g, b) => "#" + hex2(r) + hex2(g) + hex2(b));

const unescapeCss =(s) => s.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (m, c) => (/^[0-9a-fA-F]/.test(c) && c.trim().length > 1 ? String.fromCodePoint(parseInt(c, 16)) : c));
const splitSelectors = (text) => text.split(/,(?![^(]*\))/).map((s) => s.trim());
const SIMPLE = /^\.((?:\\.|[\w-])+)((?::{1,2}[\w-]+(?:\([^)]*\))?)*)$/;
const CLASS_TOKEN = /\.((?:\\.|[\w-])+)/g;

function walk(rules, media, index) {
  for (const r of rules) {
    if (r.cssRules && (r.type === CSSRule.MEDIA_RULE || r.type === CSSRule.SUPPORTS_RULE)) {
      walk(r.cssRules, r.conditionText || (r.media && r.media.mediaText) || media, index);
      continue;
    }
    if (r.type !== CSSRule.STYLE_RULE) continue;
    for (const sel of splitSelectors(r.selectorText)) {
      const m = SIMPLE.exec(sel);
      if (m) {
        const name = unescapeCss(m[1]);
        const e = entry(index, name);
        if (e.rules.length < 6) e.rules.push({ media, pseudo: m[2] || "", decl: toHex(r.style.cssText) });
      } else {
        let t;
        CLASS_TOKEN.lastIndex = 0;
        while ((t = CLASS_TOKEN.exec(sel))) entry(index, unescapeCss(t[1]));
      }
    }
  }
}

function entry(index, name) {
  let e = index.get(name);
  if (!e) index.set(name, (e = { name, rules: [] }));
  return e;
}

function classify(e) {
  const base = e.rules.find((r) => !r.pseudo) || e.rules[0];
  const plainName = e.name.replace(/^([\w-]+:)+/, "");
  if (!base || /^(a|m|o|p|t|u|s|jw|slick)-[a-zA-Z]/.test(plainName) || plainName.includes("__")) {
    e.kind = "comp";
  } else {
    const props = base.decl.split(";").map((d) => d.split(":")[0].trim()).filter(Boolean);
    e.kind = (KIND_PROPS.find(([, re]) => props.some((p) => re.test(p))) || ["other"])[0];
    const c = /(?:^|;)\s*(?:color|background-color|border(?:-\w+)?-color)\s*:\s*([^;!]+)/.exec(base.decl);
    if (c && !/inherit|initial|currentcolor|transparent|var\(/i.test(c[1])) e.swatch = c[1].trim();
  }
  e.summary = base ? base.decl.replace(/;\s*$/, "").replace(/;\s*/g, "; ") : "used in component styles";
  if (e.summary.length > 70) e.summary = e.summary.slice(0, 68) + "…";
}

/** Fetches and indexes the stylesheets. Returns Map<className, {name, kind, summary, swatch?, rules[]}>. */
export async function loadClassIndex(urls) {
  const index = new Map();
  let loaded = 0;
  for (const url of urls) {
    if (/fonts\.googleapis|typekit/.test(url)) continue; // font kits define no classes
    let text;
    try {
      const r = await fetch(url, { cache: "force-cache", credentials: "omit" });
      if (!r.ok) continue;
      text = await r.text();
    } catch { continue; }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text.replace(/@import[^;]+;/g, ""));
    walk(sheet.cssRules, "", index);
    loaded++;
  }
  for (const e of index.values()) classify(e);
  index.loadedSheets = loaded;
  return index;
}

/** "md:" -> "≥768px" etc., read from the media queries the prefixed classes live in. */
export function prefixInfo(index) {
  const out = new Map();
  for (const e of index.values()) {
    const m = /^([\w-]+):/.exec(e.name);
    if (!m || out.has(m[1])) continue;
    const r = e.rules[0];
    const w = r && /min-width:\s*(\d+)px/.exec(r.media || "");
    out.set(m[1], w ? `≥ ${w[1]}px` : r && r.pseudo ? r.pseudo.replace(/^:+/, "on ") : "variant");
  }
  return out;
}
