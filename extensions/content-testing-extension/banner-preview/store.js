// Persistence for Banner Preview.
// JSON (banners, settings) lives in chrome.storage.local; uploaded image files live as Blobs in
// IndexedDB so large PNG/JPGs don't get rewritten on every keystroke. When the page is opened
// outside the extension (e.g. served from localhost while developing) localStorage stands in.

const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

export async function getJSON(key, fallback) {
  if (hasChrome) {
    const r = await chrome.storage.local.get(key);
    return r[key] ?? fallback;
  }
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

export async function setJSON(key, value) {
  if (hasChrome) return chrome.storage.local.set({ [key]: value });
  localStorage.setItem(key, JSON.stringify(value));
}

async function removeKey(key) {
  if (hasChrome) return chrome.storage.local.remove(key);
  localStorage.removeItem(key);
}

// ---- IndexedDB blob store ---------------------------------------------------
let dbPromise;
function db() {
  return (dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open("banner-preview", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("blobs");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("blobs", mode);
    const req = fn(t.objectStore("blobs"));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export const putBlob = (key, blob) => tx("readwrite", (s) => s.put(blob, key));
export const getBlob = (key) => tx("readonly", (s) => s.get(key));
export const delBlob = (key) => tx("readwrite", (s) => s.delete(key));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- tool namespace -------------------------------------------------------------
// Category Banner Preview ("bp"), Mix-In Ad Preview ("mp") and Hero Slide Preview ("hp") share this code but keep separate
// saved items and settings, so a mix-in never shows up in the banner list or vice versa.
let NS = "bp";
let TOOL = "banner";
export function setNamespace(ns, tool) { NS = ns; TOOL = tool; }
export const nsKey = (name, ns = NS) => `${ns}.${name}`;

// ---- settings ---------------------------------------------------------------
const settingsKey = () => nsKey("settings");

// Widths match the Tailwind breakpoints in the live app.css (xs 415, sm 576, md 768, lg 992, xl 1210).
export const DEFAULT_SETTINGS = {
  devices: [
    { name: "XXS", width: 320 },
    { name: "XS", width: 415 },
    { name: "SM", width: 576 },
    { name: "MD", width: 768 },
    { name: "LG", width: 992 },
    { name: "XL", width: 1210 },
  ],
  edges: false,
  stylesheets: [
    "https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap",
    "https://fonts.googleapis.com/css?family=Material+Icons&display=swap",
    "https://use.typekit.net/wjp1ony.css",
    "https://use.typekit.net/evb6qcz.css",
    "https://use.typekit.net/kwr5xtp.css",
    "https://use.typekit.net/rft8kwo.css",
    "https://www.melaleuca.com/assets/productstore/css/app.css",
  ],
  baseHref: "https://www.melaleuca.com/",
  customTemplates: [], // [{ id, name, html }]
  zoom: 100,
  fit: true,
  view: "viewports", // viewports | compare
  compareWidth: 415,
  expansion: "off", // off | smart | 15 | 30 | 50 | 100
  accents: false,
  showZones: true,
  showDesign: true,
  designOpacity: 50,
  designBlend: "normal",
  designMode: "overlay", // overlay | swipe | below
  designMove: false,
  balanceTolerance: 6, // px the copy may sit off-center before the balance check warns
  // Layout grid overlay: columns per screen size (<768 / 768–1023 / ≥1024), gutter and outer margin in px,
  // fitted to the whole banner or its content area; rows = baseline spacing in px (0 = off).
  grid: { on: false, cols: [4, 8, 12], gutter: 20, margin: 0, fit: "content", rows: 0 },
  sweep: true,
  sweepWidth: 700,
  sideWidth: 420,
};

// The first release's default viewport list. Saved lists that still match it exactly were never
// customized, so they move to the current default; edited lists are left alone.
const OLD_DEFAULT_WIDTHS = "320,415,576,768,992,1024,1210,1440";

/** Defaults for the current tool. A mix-in ad is always a ~230px card, so its grid is 4 narrow columns at every size. */
export function defaultSettings() {
  const d = { ...DEFAULT_SETTINGS };
  if (TOOL === "mixin") d.grid = { ...d.grid, cols: [4, 4, 4], gutter: 10 };
  return d;
}

export async function loadSettings() {
  const s = await getJSON(settingsKey(), {});
  if (Array.isArray(s.devices) && s.devices.map((d) => d.width).join(",") === OLD_DEFAULT_WIDTHS) delete s.devices;
  const d = defaultSettings();
  return { ...d, ...s, grid: { ...d.grid, ...(s.grid || {}) } };
}

export const saveSettings = (s) => setJSON(settingsKey(), s);

// ---- banners / ads (projects) -----------------------------------------------------
const indexKey = () => nsKey("projects");
const lastKey = () => nsKey("lastProject");
const pKey = (id) => nsKey("project." + id);

export function newProject(name = "Untitled", tool = TOOL) {
  return {
    id: uid(),
    name,
    tool,
    updated: new Date().toISOString(),
    template: { mixin: "mixin", hero: "hero" }[tool] || "category",
    layout: { height: tool === "hero" ? "-h-lg" : "-h-sm", width: "-w-sm", align: "-left", valign: "", extra: "" },
    mixin: { neighbors: true }, // mix-in only: show product cards beside the ad
    cta: { color: "bg-green", href: "" }, // hero only: the slide's button color class and link (text is per language)
    langs: [{ code: "en-US", html: "", cta: tool === "hero" ? "LEARN MORE" : "" }],
    activeLang: "en-US",
    images: {}, // slot -> { url } | { blob, name }
    zones: {}, // slot -> [{ x, y, w, h }] as fractions of the image
    balance: {}, // slot -> "h" | "v" | "hv": check the copy is centered in its space
    copyAreas: {}, // slot -> { x, y, w, h }: explicit space to center the copy in
    designs: [], // [{ id, blob, name, width }]
  };
}

export const listProjects = () => getJSON(indexKey(), []);
export const loadProject = (id) => getJSON(pKey(id), null);
export const getLastProjectId = () => getJSON(lastKey(), null);
export const setLastProjectId = (id) => setJSON(lastKey(), id);

export async function saveProject(p) {
  p.updated = new Date().toISOString();
  await setJSON(pKey(p.id), p);
  const index = await listProjects();
  const i = index.findIndex((x) => x.id === p.id);
  const row = { id: p.id, name: p.name, updated: p.updated };
  if (i >= 0) index[i] = row; else index.unshift(row);
  await setJSON(indexKey(), index);
}

function blobKeys(p) {
  const keys = Object.values(p.images || {}).map((i) => i && i.blob);
  for (const d of p.designs || []) keys.push(d.blob);
  return keys.filter(Boolean);
}

export async function deleteProject(p) {
  for (const k of blobKeys(p)) await delBlob(k).catch(() => {});
  await removeKey(pKey(p.id));
  const index = (await listProjects()).filter((x) => x.id !== p.id);
  await setJSON(indexKey(), index);
}

// Copies a banner including its image blobs (each copy owns its own blobs).
export async function duplicateProject(p, name) {
  const copy = JSON.parse(JSON.stringify(p));
  copy.id = uid();
  copy.name = name;
  for (const img of Object.values(copy.images)) {
    if (img && img.blob) img.blob = await copyBlob(img.blob, copy.id);
  }
  for (const d of copy.designs) d.blob = await copyBlob(d.blob, copy.id);
  await saveProject(copy);
  return copy;
}

async function copyBlob(key, projectId) {
  const b = await getBlob(key);
  const k = projectId + ":" + uid();
  if (b) await putBlob(k, b);
  return k;
}

// ---- export / import (blobs travel as data: URLs) ---------------------------
const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export async function exportProject(p) {
  const out = JSON.parse(JSON.stringify(p));
  for (const img of Object.values(out.images)) {
    if (img && img.blob) {
      const b = await getBlob(img.blob);
      img.data = b ? await toDataUrl(b) : null;
      delete img.blob;
    }
  }
  for (const d of out.designs) {
    const b = await getBlob(d.blob);
    d.data = b ? await toDataUrl(b) : null;
    delete d.blob;
  }
  return { format: "melaleuca-banner-preview", version: 1, tool: out.tool || TOOL, project: out };
}

export const TOOL_NAMES = { banner: "Category Banner Preview", mixin: "Mix-In Ad Preview", hero: "Hero Slide Preview" };

export async function importProject(json) {
  const p = json && json.format === "melaleuca-banner-preview" ? json.project : null;
  if (!p || !Array.isArray(p.langs)) throw new Error("Not a Banner Preview export file.");
  const tool = json.tool || p.tool || "banner"; // files from before Mix-In Ad Preview existed are banners
  if (tool !== TOOL) throw new Error(`This file is from ${TOOL_NAMES[tool]}; import it there instead.`);
  p.tool = tool;
  p.id = uid();
  for (const [slot, img] of Object.entries(p.images || {})) {
    if (img && img.data) {
      const k = p.id + ":" + uid();
      await putBlob(k, await (await fetch(img.data)).blob());
      p.images[slot] = { blob: k, name: img.name || slot };
    }
  }
  for (const d of p.designs || []) {
    if (d.data) {
      d.blob = p.id + ":" + uid();
      await putBlob(d.blob, await (await fetch(d.data)).blob());
      delete d.data;
    }
  }
  await saveProject(p);
  return p;
}
