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

// ---- scales: classes that set the same thing at the same breakpoint ---------------------------------
// e.g. pl-20 → every class that only sets padding-left (pl-0 … pl-150, pl-1_4 …), text-2xl → every
// font-size class, md:pl-20 → the md: padding-left classes. Used for the editor's right-click menu and
// Ctrl+Alt+↑/↓ nudging.
const declProps = (decl) => decl.split(";").map((s) => s.trim()).filter(Boolean)
  .map((s) => { const i = s.indexOf(":"); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; });

const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };

/** Sort key: px/rem first by size, then %, then keywords (auto, normal, …). */
function valueKey(v) {
  const m = /^(-?[\d.]+)(px|rem|em|%)?$/.exec(v);
  if (!m) return [2, WEIGHTS[v] ?? 0, v];
  let n = parseFloat(m[1]);
  if (m[2] === "rem" || m[2] === "em") n *= 16;
  return [m[2] === "%" ? 1 : 0, n, v];
}
const compareKeys = (a, b) => a[0] - b[0] || a[1] - b[1] || String(a[2]).localeCompare(String(b[2]));

let familyIndex = null;
let families = null;
let familyByName = null;

function buildFamilies(index) {
  families = new Map();
  familyByName = new Map();
  for (const e of index.values()) {
    if (e.kind === "comp") continue;
    const rule = e.rules.find((r) => !r.pseudo);
    const props = rule && declProps(rule.decl);
    if (!props || !props.length) continue;
    const prefix = /^((?:[\w-]+:)*)/.exec(e.name)[1];
    const key = prefix + "\n" + props.map((p) => p[0]).sort().join(";");
    if (!families.has(key)) families.set(key, []);
    families.get(key).push({ name: e.name, value: props[0][1], label: props.map((p) => p[0]).join(", "), swatch: e.swatch, key: valueKey(props[0][1]) });
    familyByName.set(e.name, key);
  }
  for (const list of families.values()) list.sort((a, b) => compareKeys(a.key, b.key) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  familyIndex = index;
}

/** The scale a class belongs to: { prop, members: [{name, value, swatch}], at } or null if it has no siblings. */
export function familyOf(index, name) {
  if (!index) return null;
  if (familyIndex !== index) buildFamilies(index);
  const list = families.get(familyByName.get(name));
  if (!list || list.length < 2) return null;
  const at = list.findIndex((m) => m.name === name);
  return { prop: list[at].label, members: list, at };
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
