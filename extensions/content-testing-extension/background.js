// Follows a link and reports where it finally lands. Runs here (not in the
// page) so cross-culture fetches aren't blocked by CORS.
const MAX_PARALLEL = 4;
const TIMEOUT_MS = 12000;
const cache = new Map();
const queue = [];
let active = 0;

function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "melaleuca.com" || u.hostname.endsWith(".melaleuca.com"));
  } catch { return false; }
}

function enqueue(url) {
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve) => { queue.push({ url, resolve }); pump(); });
  cache.set(url, p);
  p.then((r) => { if (!r.ok) cache.delete(url); }); // retry failures next time
  return p;
}

function pump() {
  while (active < MAX_PARALLEL && queue.length) run(queue.shift());
}

// Reads at most ~64KB of an HTML response to get its <title>, so "soft 404"
// pages (HTTP 200 but the content says not found) can be spotted.
async function readTitle(r) {
  try {
    if (!/html/i.test(r.headers.get("content-type") || "") || !r.body) return "";
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    while (text.length < 65536) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) return m[1].replace(/\s+/g, " ").trim();
    }
  } catch {}
  return "";
}

async function run({ url, resolve }) {
  active++;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { redirect: "follow", credentials: "include", cache: "no-store", signal: ctl.signal });
    const title = await readTitle(r);
    resolve({ ok: true, finalUrl: r.url, status: r.status, redirected: r.redirected, title });
    ctl.abort(); // don't download the rest of the body
  } catch (e) {
    resolve({ ok: false, error: String(e) });
  } finally {
    clearTimeout(timer);
    active--;
    pump();
  }
}

// ---- on/off state shown on the toolbar icon ---------------------------------
function syncBadge() {
  chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
    chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#777" });
  });
}
chrome.runtime.onStartup.addListener(syncBadge);
chrome.runtime.onInstalled.addListener(syncBadge);
chrome.storage.onChanged.addListener((ch, area) => { if (area === "sync" && ch.enabled) syncBadge(); });

// ---- right-click "ignore" menu ---------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const base = { contexts: ["link"], documentUrlPatterns: ["https://*.melaleuca.com/*"] };
    chrome.contextMenus.create({ ...base, id: "clc-ignore-link", title: "Ignore this link" });
    chrome.contextMenus.create({ ...base, id: "clc-ignore-host", title: "Ignore this whole host" });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (!info.linkUrl) return;
  let u;
  try { u = new URL(info.linkUrl); } catch { return; }
  const pattern = (info.menuItemId === "clc-ignore-host" ? u.host : u.host + u.pathname).toLowerCase();
  const { ignoreRules = [] } = await chrome.storage.sync.get({ ignoreRules: [] });
  if (ignoreRules.some((r) => r.pattern === pattern)) return;
  ignoreRules.push({ pattern, added: new Date().toISOString() });
  await chrome.storage.sync.set({ ignoreRules });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "clc-resolve") return;
  if (!allowed(msg.url)) { sendResponse({ ok: false, error: "blocked" }); return; }
  enqueue(msg.url).then(sendResponse);
  return true; // async response
});
