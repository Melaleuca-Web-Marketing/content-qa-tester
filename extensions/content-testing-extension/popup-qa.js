// "QA Tests" tab: starts Content QA Tester runs for the open tab, using its page context
// (environment, culture, category, SKUs, what's on the page) to pick the targets.
import { DEFAULT_SERVER, resolveContext, TESTS, buildBody, probePage } from "./qa/context.js";
import { makeClient, findReport } from "./qa/client.js";

const $ = (id) => document.getElementById(id);
const ALL_WIDTHS = [320, 415, 576, 768, 992, 1210];
const USES_WIDTHS = new Set(["banner", "mixinad", "pslp", "page"]);
const STATE_LABEL = { queued: "Queued", running: "Running", completed: "Done", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted" };
const TOOL_NAME = Object.fromEntries(TESTS.map((t) => [t.id, t.name]));

let client = null;
let config = null;
let ctx = null;
let widths = [320, 768, 1210];
let pollTimer = null;
let loaded = false;

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null && k !== false));
  return e;
}
const store = {
  get: (defaults) => chrome.storage.local.get(defaults),
  set: (obj) => chrome.storage.local.set(obj),
};
const ago = (iso) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return new Date(iso).toLocaleDateString();
};

// ---- tabs (Tools / QA Tests) ----------------------------------------------------------------------
function showTab(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  $("tab-tools").hidden = name !== "tools";
  $("tab-qa").hidden = name !== "qa";
  store.set({ popupTab: name });
  if (name === "qa" && !loaded) loadQa();
  if (name !== "qa") stopPolling();
}
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));

// ---- load --------------------------------------------------------------------------------------------
async function loadQa() {
  loaded = true;
  const saved = await store.get({ qaServer: DEFAULT_SERVER, qaWidths: null, qaConfigCache: null });
  $("qaServer").value = saved.qaServer;
  client = makeClient(saved.qaServer);
  if (saved.qaWidths) widths = saved.qaWidths;

  // Connect: session (the same one the QA Tester web app uses) and config.
  const conn = $("qaConn");
  try {
    const [session, cfg] = await Promise.all([client.session(), client.config()]);
    config = cfg;
    store.set({ qaConfigCache: cfg });
    conn.textContent = "Connected";
    conn.className = "tag ok";
    conn.title = `${client.base} · session ${String(session.laneId || "").slice(5, 13)}`;
    if (!saved.qaWidths && cfg.banner && cfg.banner.defaults) widths = cfg.banner.defaults.widths;
  } catch (err) {
    config = saved.qaConfigCache;
    conn.textContent = "Can't reach";
    conn.className = "tag bad";
    conn.title = err.message;
    $("qaContext").textContent = `Couldn't reach the QA Tester at ${client.base} (${err.message}). Check you're on the Melaleuca network or VPN, or change the server below.`;
    renderJobs([]);
    return;
  }

  // Page context from the open tab.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let page = null;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: probePage });
    page = r && r.result;
  } catch {}
  ctx = resolveContext(tab && tab.url, page, config);
  renderContext();
  if (ctx.ok) renderTests();
  refreshJobs();
}

function renderContext() {
  const box = $("qaContext");
  box.textContent = "";
  if (!ctx.ok) { box.textContent = ctx.reason; return; }
  const envLabel = { production: "Production", stage: "Stage", uat: "UAT" }[ctx.env];
  const what = [
    ctx.category && ctx.category.label,
    ctx.has.categoryBanner && "category banner",
    ctx.has.mixins && `${ctx.has.mixins} mix-in ad${ctx.has.mixins > 1 ? "s" : ""}`,
    ctx.has.hero && "hero carousel",
    ctx.skus.length && `${ctx.skus.length} SKU${ctx.skus.length > 1 ? "s" : ""}`,
  ].filter(Boolean);
  box.append(
    el("div", { className: "ctxRow" }, el("span", { className: "pill env-" + ctx.env, textContent: envLabel }), el("span", { className: "pill", textContent: ctx.culture }), el("code", { textContent: ctx.path, title: ctx.url })),
    el("div", { className: "qaNote", textContent: what.length ? "On this page: " + what.join(" · ") : "No banners, ads or products found; the Page test still applies." }));
}

// ---- tests + options ---------------------------------------------------------------------------------
function whyNot(t) {
  if (["banner", "mixinad", "sortorder"].includes(t.id)) return ctx.category ? "This culture isn't set up for it in the QA Tester" : "This page isn't in the QA Tester's category list";
  if (["sku", "pdp"].includes(t.id)) return "No SKUs found on this page";
  if (t.id === "pslp") return "Only on the store home page";
  return "";
}

function renderTests() {
  $("qaTestsCard").hidden = false;
  const box = $("qaTests");
  box.textContent = "";
  for (const t of TESTS) {
    const ok = t.applies(ctx);
    const cb = el("input", { type: "checkbox", checked: ok && t.suggested(ctx), disabled: !ok });
    cb.dataset.test = t.id;
    cb.addEventListener("change", updateOptions);
    const badge = t.login === "required" ? el("span", { className: "pill warn", textContent: "needs sign-in" }) : null;
    box.append(el("label", { className: "qaTest" + (ok ? "" : " off") }, cb,
      el("div", {}, el("div", { className: "qaTestName" }, t.name, badge), el("div", { className: "qaNote", textContent: ok ? t.target(ctx) : whyNot(t) }))));
  }
  renderWidths();
  const label = ctx.category ? ctx.category.label : ctx.path;
  if (!$("qaName").value) $("qaName").value = `${label} · ${ctx.culture} · ${ctx.env}`.slice(0, 120);
  updateOptions();
}

function renderWidths() {
  const wbox = $("qaWidths");
  wbox.textContent = "";
  for (const w of ALL_WIDTHS) {
    const b = el("button", { type: "button", className: "chip" + (widths.includes(w) ? " on" : ""), textContent: w });
    b.addEventListener("click", () => {
      widths = widths.includes(w) ? widths.filter((x) => x !== w) : [...widths, w].sort((a, c) => a - c);
      if (!widths.length) widths = [w]; // keep at least one
      store.set({ qaWidths: widths });
      renderWidths();
    });
    wbox.append(b);
  }
}

const selected = () => [...document.querySelectorAll("#qaTests input:checked")].map((c) => c.dataset.test);

async function updateOptions() {
  const ids = selected();
  const tests = ids.map((id) => TESTS.find((t) => t.id === id));
  $("qaWidthsField").hidden = !ids.some((id) => USES_WIDTHS.has(id));
  const required = tests.filter((t) => t.login === "required");
  const optional = tests.filter((t) => t.login === "optional");
  $("qaSignInRow").hidden = !optional.length;
  const needCreds = required.length > 0 || (optional.length && $("qaSignIn").checked);
  $("qaCreds").hidden = !needCreds;
  $("qaCredsNote").textContent = required.length ? `${required.map((t) => t.name).join(" and ")} sign${required.length > 1 ? "" : "s"} in to the site.` : "Signs in to the site for the selected tests.";
  if (needCreds && !$("qaUser").value) {
    const { qaUsernames = {} } = await store.get({ qaUsernames: {} });
    $("qaUser").value = qaUsernames[`${ctx.env}|${ctx.culture}`] || "";
  }
  $("qaStart").disabled = !ids.length;
  $("qaCount").textContent = ids.length ? `${ids.length} test${ids.length > 1 ? "s" : ""}` : "Pick a test";
}
$("qaSignIn").addEventListener("change", updateOptions);

// ---- start ---------------------------------------------------------------------------------------------
$("qaStart").addEventListener("click", async () => {
  const ids = selected();
  if (!ids.length) return;
  const signIn = $("qaSignIn").checked;
  const username = $("qaUser").value.trim(), password = $("qaPass").value;
  const needCreds = ids.some((id) => TESTS.find((t) => t.id === id).login === "required") || signIn;
  const out = $("qaResult");
  out.hidden = false;
  out.textContent = "";
  if (needCreds && (!username || !password)) {
    out.append(el("div", { className: "item bad", textContent: "Enter the site username and password for the selected tests." }));
    return;
  }
  if (needCreds) {
    const { qaUsernames = {} } = await store.get({ qaUsernames: {} });
    qaUsernames[`${ctx.env}|${ctx.culture}`] = username; // username only; the password is never stored
    store.set({ qaUsernames });
  }
  const testName = $("qaName").value.trim().slice(0, 120) || undefined;
  const opts = { testName, widths, signIn, username, password, components: config.pslp && config.pslp.defaults && config.pslp.defaults.components };
  $("qaStart").disabled = true;
  const { qaStarted = {} } = await store.get({ qaStarted: {} });
  for (const id of ids) {
    const row = el("div", { className: "item" }, el("b", { textContent: TOOL_NAME[id] }), el("span", { className: "muted", textContent: " starting…" }));
    out.append(row);
    try {
      const res = await client.start(id, buildBody(id, ctx, opts));
      row.lastChild.textContent = res.queued ? ` queued (#${res.position})${res.alreadyQueued ? ", already in the queue" : ""}` : " started";
      row.classList.add("ok");
      if (res.jobId) qaStarted[res.jobId] = { tool: id, testName, at: new Date().toISOString() };
    } catch (err) {
      row.lastChild.textContent = " " + (err.status === 409 ? "you already have one running; wait for it to finish" : err.message);
      row.classList.add("bad");
    }
  }
  $("qaPass").value = "";
  // Keep the last 50 jobs started from here, to match their reports later.
  const keep = Object.entries(qaStarted).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 50);
  store.set({ qaStarted: Object.fromEntries(keep) });
  $("qaStart").disabled = false;
  refreshJobs();
});

// ---- recent jobs ------------------------------------------------------------------------------------
async function refreshJobs() {
  if (!client) return;
  try {
    const res = await client.jobs(8);
    renderJobs((res && res.jobs) || []);
  } catch (err) {
    $("qaJobs").className = "list muted";
    $("qaJobs").textContent = "Couldn't load jobs: " + err.message;
  }
}

async function renderJobs(jobs) {
  const box = $("qaJobs");
  box.textContent = "";
  if (!jobs.length) { box.className = "list muted"; box.textContent = "No jobs yet."; stopPolling(); return; }
  box.className = "list";
  const { qaStarted = {} } = await store.get({ qaStarted: {} });
  let history = null;
  for (const job of jobs) {
    const mine = qaStarted[job.id];
    const name = (mine && mine.testName) || (job.optionsSummary && job.optionsSummary.testName) || "";
    const state = el("span", { className: "pill st-" + job.state, textContent: STATE_LABEL[job.state] || job.state });
    const row = el("div", { className: "item" },
      el("div", { className: "main" },
        el("div", { className: "txt" }, TOOL_NAME[job.tool] || job.tool, " ", state),
        el("div", { className: "url", textContent: [name, ago(job.finishedAt || job.startedAt || job.createdAt)].filter(Boolean).join(" · ") })));
    if (job.state === "completed") {
      history ||= await client.history().catch(() => ({ history: [] }));
      const report = findReport(history, job, name || null);
      if (report) {
        const open = el("button", { className: "small", textContent: "Open report" });
        open.addEventListener("click", () => chrome.tabs.create({ url: client.reportUrl(report.filename) }));
        row.append(open);
      }
    } else if (job.state === "failed" && job.error) {
      row.querySelector(".url").textContent += " · " + job.error;
    }
    box.append(row);
  }
  // While anything is queued or running, refresh every few seconds (the popup is short-lived anyway).
  if (jobs.some((j) => j.state === "queued" || j.state === "running")) startPolling(); else stopPolling();
}

function startPolling() { if (!pollTimer) pollTimer = setInterval(refreshJobs, 4000); }
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

$("qaRefresh").addEventListener("click", refreshJobs);
$("qaOpenTool").addEventListener("click", () => chrome.tabs.create({ url: (client || makeClient(DEFAULT_SERVER)).appUrl() }));

// ---- server setting -------------------------------------------------------------------------------
async function saveServer(value) {
  let url;
  try { url = new URL(value.trim()); } catch { return alertRow("That isn't a valid URL."); }
  const origin = url.origin;
  // Production is covered by the manifest; other servers need the user's OK (optional host permission).
  const granted = await chrome.permissions.contains({ origins: [origin + "/*"] }) || await chrome.permissions.request({ origins: [origin + "/*"] }).catch(() => false);
  if (!granted) return alertRow(`The extension needs permission to reach ${origin}.`);
  await store.set({ qaServer: origin + url.pathname.replace(/\/+$/, ""), qaConfigCache: null });
  loaded = false;
  $("qaName").value = "";
  $("qaResult").hidden = true;
  loadQa();
}
function alertRow(msg) {
  $("qaContext").textContent = msg;
}
$("qaServerSave").addEventListener("click", () => saveServer($("qaServer").value));
$("qaServerReset").addEventListener("click", () => { $("qaServer").value = DEFAULT_SERVER; saveServer(DEFAULT_SERVER); });

// Open on the last tab used.
store.get({ popupTab: "tools" }).then(({ popupTab }) => showTab(popupTab));
