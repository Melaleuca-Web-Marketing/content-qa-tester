// New Stamp Audit page: looks up each pasted SKU's Web availability and flags the ones whose New stamp is due.
// Input is either SKU + CountryID rows from the SQL script (each row checked against its own country) or a
// plain SKU list (checked against the countries ticked under Rule).
import { DEFAULTS, COUNTRY_LABELS, STATUS, parseInput, evaluateRow, rowKey, batchUrl, toCsv, todayIso } from "./audit.js";

const $ = (id) => document.getElementById(id);
const ALL_COUNTRIES = ["UnitedStates", "Canada", "Mexico"];
const REQUEST_TIMEOUT_MS = 60000;
const RETRY_DELAY_MS = 2000;

// chrome.storage.local inside the extension; localStorage when the page is opened outside it (testing).
const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
const store = {
  get: async (key, fallback) => {
    if (hasChrome) return (await chrome.storage.local.get(key))[key] ?? fallback;
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set: (key, value) => (hasChrome ? chrome.storage.local.set({ [key]: value }) : localStorage.setItem(key, JSON.stringify(value))),
};

let audit = null; // { ranAt, asOf, days, countries, perCountry, results: [...] }
let filter = null; // status shown, or null for all
let sort = { key: "status", asc: true };
let running = null; // { stop: bool }

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null && k !== false));
  return e;
}
let toastTimer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3000);
}
const countryName = (c) => COUNTRY_LABELS[c] || c || "";

// ---- inputs -----------------------------------------------------------------------------------------
function readSettings() {
  return {
    days: Math.max(1, Math.round(Number($("days").value) || DEFAULTS.days)),
    asOf: $("asOf").value || todayIso(),
    countries: [...document.querySelectorAll("#countries input:checked")].map((c) => c.value),
    apiBase: $("apiBase").value.trim() || DEFAULTS.apiBase,
    softwareSystem: $("softwareSystem").value.trim() || DEFAULTS.softwareSystem,
  };
}

/** Shows what the paste was read as; returns the parse. */
function showParse() {
  const text = $("skuInput").value;
  const p = parseInput(text);
  const info = $("parseInfo");
  const perCountry = p.source === "sku+country";
  // With CountryID rows the countries come from the paste, so the checkboxes don't apply.
  $("countries").classList.toggle("off", perCountry);
  for (const c of document.querySelectorAll("#countries input")) c.disabled = perCountry;
  $("countriesNote").textContent = perCountry ? "Using the CountryID column: each row is checked against its own country." : "";

  const tableWithoutHeader = p.source === "numbers" && /\t/.test(text);
  info.className = "hint" + (tableWithoutHeader || p.unknownIds.length ? " warn" : "");
  if (!p.rows.length) { info.textContent = "No SKUs found yet."; return p; }
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  let msg = perCountry
    ? `${plural(p.rows.length, "row")} (${plural(p.skus.length, "SKU")}) from the "${p.column}" and "${p.countryColumn}" columns`
    : `${plural(p.skus.length, "SKU")} (${p.source === "column" ? `from the "${p.column}" column` : "every 3–8 digit number in the paste"})`;
  if (p.dupes) msg += `, ${plural(p.dupes, "duplicate")} skipped`;
  if (p.unknownIds.length) msg += `. Unknown CountryID ${p.unknownIds.join(", ")}: those rows will be marked, not checked (known: 1 US, 2 CA, 26 MX)`;
  if (tableWithoutHeader) msg += ". This looks like a table without a header: include the header row so other number columns aren't counted.";
  info.textContent = msg;
  return p;
}

// ---- running the audit ------------------------------------------------------------------------------
async function fetchOnce(skus, s) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(batchUrl(s.apiBase, skus), {
      headers: { accept: "text/plain", SoftwareSystem: s.softwareSystem, CorrelationId: crypto.randomUUID() },
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error("Unexpected response");
    return Object.fromEntries(data.map((p) => [String(p.sku), p]));
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `no response in ${REQUEST_TIMEOUT_MS / 1000}s` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

/** One chunk of SKUs, with a single automatic retry for timeouts, network errors and 5xx/429. */
async function fetchBatch(skus, s) {
  try {
    return await fetchOnce(skus, s);
  } catch (e) {
    if (/^HTTP 4(?!29)/.test(e.message)) throw e; // a 4xx (other than 429) won't fix itself
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fetchOnce(skus, s);
  }
}

/**
 * Looks up the SKUs (each once, in chunks, a few chunks at a time) and evaluates every pasted row.
 * retryKeys: re-run only these result rows (Retry failed).
 */
async function runAudit(retryKeys) {
  const s = readSettings();
  const parsed = showParse();
  let rows;
  if (retryKeys) {
    rows = audit.results.filter((r) => retryKeys.includes(rowKey(r))).map((r) => ({ sku: r.sku, countryId: r.countryId, country: r.country }));
  } else {
    rows = parsed.rows;
    if (!rows.length) return toast("Paste some SKUs first.");
    if (parsed.source !== "sku+country" && !s.countries.length) return toast("Pick at least one country.");
  }
  await store.set("nsSettings", { days: s.days, countries: s.countries, apiBase: s.apiBase, softwareSystem: s.softwareSystem });
  await store.set("nsInput", $("skuInput").value);

  const opts = { asOf: s.asOf, days: s.days, countries: s.countries.length === ALL_COUNTRIES.length ? null : s.countries };
  if (!retryKeys) {
    audit = { ranAt: new Date().toISOString(), asOf: s.asOf, days: s.days, countries: s.countries, perCountry: parsed.source === "sku+country", results: [] };
  }
  const byKey = new Map(audit.results.map((r) => [rowKey(r), r]));
  const order = retryKeys ? audit.results.map(rowKey) : rows.map(rowKey); // a retry keeps the list in place

  // Each SKU is fetched once, however many country rows it has.
  const rowsBySku = new Map();
  for (const r of rows) (rowsBySku.get(r.sku) || rowsBySku.set(r.sku, []).get(r.sku)).push(r);
  const skus = [...rowsBySku.keys()];
  const batches = [];
  for (let i = 0; i < skus.length; i += DEFAULTS.batchSize) batches.push(skus.slice(i, i + DEFAULTS.batchSize));

  running = { stop: false };
  $("run").disabled = true;
  $("stop").hidden = false;
  $("progress").hidden = false;
  let done = 0;
  const tick = () => {
    $("bar").style.width = Math.round((done / skus.length) * 100) + "%";
    $("progressText").textContent = `${done} / ${skus.length} SKUs`;
  };
  tick();

  // A few chunks at a time: the service takes several seconds per chunk.
  let next = 0;
  async function worker() {
    while (next < batches.length && !running.stop) {
      const batch = batches[next++];
      let found = null, error = null;
      try { found = await fetchBatch(batch, s); } catch (e) { error = e.message; }
      for (const sku of batch) {
        for (const row of rowsBySku.get(sku)) {
          const result = error
            ? { sku, countryId: row.countryId, country: row.country, name: "", status: "error", countries: [], error: `Lookup failed: ${error}` }
            : evaluateRow(row, found[sku], opts);
          byKey.set(rowKey(result), result);
        }
      }
      done += batch.length;
      audit.results = order.map((k) => byKey.get(k)).filter(Boolean);
      tick();
      render();
    }
  }
  await Promise.all(Array.from({ length: DEFAULTS.parallel }, worker));

  const stopped = running.stop;
  running = null;
  $("run").disabled = false;
  $("stop").hidden = true;
  $("progressText").textContent = stopped ? `Stopped at ${done} / ${skus.length} SKUs` : `Done: ${skus.length} SKUs`;
  await store.set("nsAudit", audit);
  render();
  renderLastRun();
}

// ---- results ------------------------------------------------------------------------------------------
function counts() {
  const c = {};
  for (const r of audit.results) c[r.status] = (c[r.status] || 0) + 1;
  return c;
}

function columns() {
  if (audit.perCountry) {
    return [
      { key: "sku", label: "SKU" },
      { key: "country", label: "Country" },
      { key: "name", label: "Product" },
      { key: "status", label: "Status" },
      { key: "web", label: "Web start" },
      { key: "note", label: "Note" },
    ];
  }
  const countries = audit.countries.filter((c) => audit.results.some((r) => (r.countries || []).some((x) => x.country === c)));
  return [
    { key: "sku", label: "SKU" },
    { key: "name", label: "Product" },
    { key: "status", label: "Status" },
    ...countries.map((c) => ({ key: "c:" + c, label: `${countryName(c)} web start`, country: c })),
    { key: "note", label: "Note" },
  ];
}

function sortValue(r, key) {
  if (key === "status") return [(STATUS[r.status] || {}).rank ?? 9, -(r.maxDays ?? -1)];
  if (key === "web") { const x = (r.countries || [])[0]; return [x && x.days != null ? -x.days : 1e9]; }
  if (key.startsWith("c:")) { const x = (r.countries || []).find((y) => y.country === key.slice(2)); return [x && x.days != null ? -x.days : 1e9]; }
  if (key === "sku") return [Number(r.sku), Number(r.countryId) || 0];
  if (key === "country") return [countryName(r.country) || String(r.countryId || "")];
  return [String(r[key] || r.error || "").toLowerCase()];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };

function webCell(x, days) {
  const td = el("td", { className: "country" });
  if (!x) return td;
  td.append(x.start, " ", x.future ? el("span", { className: "ended", textContent: "(upcoming)" })
    : el("span", { className: x.over ? "over" : "", textContent: `· ${x.days}d` }));
  if (!x.live && !x.future) td.append(el("div", { className: "ended", textContent: `ended ${x.end}` }));
  td.title = `Web ${x.start} → ${x.end || "no end date"}${x.live ? " (live)" : ""}. ${days} days on ${x.due}.`;
  return td;
}

function render() {
  const has = audit && audit.results.length;
  $("empty").hidden = !!has;
  $("summary").hidden = $("actions").hidden = $("tableWrap").hidden = !has;
  if (!has) return;

  // Summary chips double as filters.
  const c = counts();
  const sum = $("summary");
  sum.textContent = "";
  for (const key of ["remove", "keep", "upcoming", "noweb", "notfound", "badcountry", "error"]) {
    if (!c[key]) continue;
    const chip = el("div", { className: `stat ${key}${filter === key ? " on" : ""}`, title: "Show only these" }, el("b", { textContent: c[key] }), STATUS[key].label);
    chip.addEventListener("click", () => { filter = filter === key ? null : key; render(); });
    sum.append(chip);
  }
  $("copyLines").textContent = audit.perCountry ? "Copy SKU + CountryID to remove" : "Copy SKUs to remove";
  $("copyLines").disabled = $("copyComma").disabled = !c.remove;
  $("retry").hidden = !c.error || !!running;

  const cols = columns();
  const head = $("headRow");
  head.textContent = "";
  for (const col of cols) {
    const th = el("th", { textContent: col.label, className: sort.key === col.key ? "sorted" + (sort.asc ? " asc" : "") : "" });
    th.addEventListener("click", () => { sort = { key: col.key, asc: sort.key === col.key ? !sort.asc : true }; render(); });
    head.append(th);
  }

  const q = $("search").value.trim().toLowerCase();
  const rows = audit.results
    .filter((r) => !filter || r.status === filter)
    .filter((r) => !q || r.sku.includes(q) || (r.name || "").toLowerCase().includes(q))
    .sort((a, b) => cmp(sortValue(a, sort.key), sortValue(b, sort.key)) * (sort.asc ? 1 : -1));
  const body = $("rows");
  body.textContent = "";
  for (const r of rows) {
    const tr = el("tr", { className: r.status });
    for (const col of cols) {
      if (col.key === "sku") tr.append(el("td", { className: "sku", textContent: r.sku }));
      else if (col.key === "country") tr.append(el("td", { className: "country", textContent: countryName(r.country) || `ID ${r.countryId}`, title: `CountryID ${r.countryId}` }));
      else if (col.key === "name") tr.append(el("td", { textContent: r.name || "" }));
      else if (col.key === "status") tr.append(el("td", {}, el("span", { className: "pill " + r.status, textContent: STATUS[r.status].label })));
      else if (col.key === "web") tr.append(webCell((r.countries || [])[0], audit.days));
      else if (col.country) tr.append(webCell((r.countries || []).find((y) => y.country === col.country), audit.days));
      else tr.append(el("td", { className: "note", textContent: r.note || r.error || "" }));
    }
    body.append(tr);
  }
}

function renderLastRun() {
  $("lastRun").textContent = audit ? `Last audit ${new Date(audit.ranAt).toLocaleString()} · as of ${audit.asOf} · ${audit.days} days` : "";
}

// ---- actions ------------------------------------------------------------------------------------------
const removeRows = () => audit.results.filter((r) => r.status === "remove");
$("copyLines").addEventListener("click", async () => {
  // SKU + CountryID input: tab-separated pairs (pastes into Excel / a SQL editor as two columns).
  const rows = removeRows();
  const text = audit.perCountry ? ["SKU\tCountryID", ...rows.map((r) => `${r.sku}\t${r.countryId}`)].join("\n") : rows.map((r) => r.sku).join("\n");
  await navigator.clipboard.writeText(text);
  toast(`Copied ${rows.length} ${audit.perCountry ? "SKU + CountryID rows" : "SKUs"} (one per line).`);
});
$("copyComma").addEventListener("click", async () => {
  const skus = [...new Set(removeRows().map((r) => r.sku))];
  await navigator.clipboard.writeText(skus.join(", "));
  toast(`Copied ${skus.length} SKU${skus.length === 1 ? "" : "s"} (comma list).`);
});
$("exportCsv").addEventListener("click", () => {
  const blob = new Blob(["﻿" + toCsv(audit.results, audit.countries)], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `new-stamp-audit-${audit.asOf}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("retry").addEventListener("click", () => runAudit(audit.results.filter((r) => r.status === "error").map(rowKey)));
$("run").addEventListener("click", () => runAudit());
$("stop").addEventListener("click", () => { if (running) running.stop = true; });
$("search").addEventListener("input", render);
$("skuInput").addEventListener("input", showParse);

// ---- start ----------------------------------------------------------------------------------------------
(async () => {
  const saved = await store.get("nsSettings", {});
  $("days").value = saved.days || DEFAULTS.days;
  $("asOf").value = todayIso();
  const countries = saved.countries || ALL_COUNTRIES;
  for (const c of document.querySelectorAll("#countries input")) c.checked = countries.includes(c.value);
  $("apiBase").value = saved.apiBase || DEFAULTS.apiBase;
  $("softwareSystem").value = saved.softwareSystem || DEFAULTS.softwareSystem;
  $("skuInput").value = await store.get("nsInput", "");
  showParse();
  audit = await store.get("nsAudit", null);
  render();
  renderLastRun();
})();
