const $ = (id) => document.getElementById(id);
const clean = (s) => s.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^\/\//, "");

async function getData() {
  return chrome.storage.sync.get({ ignoreRules: [], showIgnored: false, enabled: true });
}

async function addRules(patterns) {
  const { ignoreRules } = await getData();
  const have = new Set(ignoreRules.map((r) => r.pattern));
  const now = new Date().toISOString();
  for (const p of patterns.map(clean).filter(Boolean)) {
    if (!have.has(p)) { ignoreRules.push({ pattern: p, added: now }); have.add(p); }
  }
  await chrome.storage.sync.set({ ignoreRules });
}

async function removeRule(pattern) {
  const { ignoreRules } = await getData();
  await chrome.storage.sync.set({ ignoreRules: ignoreRules.filter((r) => r.pattern !== pattern) });
}

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

// ---- ignore list ------------------------------------------------------------
async function renderRules() {
  const { ignoreRules, showIgnored, enabled } = await getData();
  $("enabled").checked = enabled;
  $("enabledLabel").textContent = enabled ? "On" : "Off";
  document.body.classList.toggle("off", !enabled);
  $("count").textContent = ignoreRules.length;
  $("showIgnored").checked = showIgnored;
  const box = $("rules");
  box.textContent = "";
  if (!ignoreRules.length) {
    box.className = "list muted";
    box.textContent = "No ignored links yet.";
    return;
  }
  box.className = "list";
  for (const r of ignoreRules) {
    const when = r.added ? new Date(r.added).toLocaleDateString() : "";
    box.append(el("div", { className: "item" },
      el("div", { className: "main" },
        el("div", { className: "txt", textContent: r.pattern, title: r.pattern }),
        el("div", { className: "url", textContent: when ? "added " + when : "" })),
      el("button", { className: "small", textContent: "Remove", onclick: () => removeRule(r.pattern) })));
  }
}

// ---- flagged links on the current tab -------------------------------------
async function renderFlagged() {
  const box = $("flagged");
  let res = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    res = await chrome.tabs.sendMessage(tab.id, { type: "clc-list" }, { frameId: 0 });
  } catch {}
  box.textContent = "";
  if (res && res.enabled === false) {
    box.className = "list muted";
    box.textContent = "The extension is turned off.";
    return;
  }
  if (!res) {
    box.className = "list muted";
    box.textContent = "Open a melaleuca.com page (reload it if you just updated the extension).";
    return;
  }
  const byHref = new Map();
  for (const it of res.items) {
    const key = it.href + "|" + it.kind;
    if (!byHref.has(key)) byHref.set(key, { ...it, n: 0 });
    byHref.get(key).n++;
  }
  if (!byHref.size) {
    box.className = "list muted";
    box.textContent = "Nothing flagged" + (res.ignored ? ` (${res.ignored} ignored)` : "") + ".";
    return;
  }
  box.className = "list";
  for (const it of byHref.values()) {
    let u = null;
    try { u = new URL(it.href); } catch {}
    const item = el("div", { className: "item" },
      el("span", { className: "dot " + it.kind }),
      el("div", { className: "main" },
        el("div", { className: "txt", textContent: (it.text || "(no text)") + (it.n > 1 ? ` ×${it.n}` : "") }),
        el("div", { className: "url", textContent: it.href }),
        el("div", { className: "why", textContent: it.label || "" })));
    if (u) {
      item.append(el("div", { className: "btns" },
        el("button", { className: "small", textContent: "Ignore link", onclick: () => addRules([u.host + u.pathname]) }),
        el("button", { className: "small", textContent: "Ignore host", onclick: () => addRules([u.host]) })));
    }
    box.append(item);
  }
}

// ---- wiring -------------------------------------------------------------
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addRules([$("addInput").value]);
  $("addInput").value = "";
});
$("enabled").addEventListener("change", (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
$("showIgnored").addEventListener("change", (e) => chrome.storage.sync.set({ showIgnored: e.target.checked }));
$("exportBtn").addEventListener("click", async () => {
  const { ignoreRules } = await getData();
  $("io").value = ignoreRules.map((r) => r.pattern).join("\n");
});
$("importBtn").addEventListener("click", async () => {
  await addRules($("io").value.split(/\r?\n/));
});
$("clearBtn").addEventListener("click", async () => {
  if (confirm("Remove ALL ignore rules?")) await chrome.storage.sync.set({ ignoreRules: [] });
});

chrome.storage.onChanged.addListener(() => {
  renderRules();
  setTimeout(renderFlagged, 500); // let the page re-scan first
});

renderRules();
renderFlagged();
