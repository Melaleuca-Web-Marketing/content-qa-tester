// New Stamp audit logic: which SKUs have been on the web long enough that their "New" stamp should come off.
// Pure functions (no chrome.* / DOM) so they can be tested outside the extension.
//
// Data source: ProductService GlobalProductInformation. Its channelAvailability rows with salesChannel "Web"
// say when a SKU is sold on the site, per country (and warehouse), as start/end date windows.

export const DEFAULTS = {
  apiBase: "https://apincde.melaleuca.net/ProductService.API/v1",
  softwareSystem: "NorthAmerica",
  days: 90,
  batchSize: 10,
  parallel: 3,
};

export const COUNTRY_LABELS = { UnitedStates: "US", Canada: "CA", Mexico: "MX" };

// CountryID values in the New-stamp SQL results → the API's country names.
export const COUNTRY_IDS = { 1: "UnitedStates", 2: "Canada", 26: "Mexico" };

const SKU_HEADER = /^(product[\s_]?)?sku(s|[\s_]?(id|number|no))?$/i;
const COUNTRY_HEADER = /^country[\s_]?(id|iden)?$/i;

/**
 * What was pasted, as rows to audit. Supported shapes:
 *  - SQL results with a header containing SKU and CountryID → one row per SKU + country (the stamp is
 *    per country, so each row is checked against that country's Web availability only)
 *  - a header with just a SKU column → that column only (other number columns aren't mistaken for SKUs)
 *  - anything else → every 3–8 digit number is a SKU
 * Duplicate rows are skipped. Returns
 *   { rows: [{ sku, countryId?, country? }], skus (unique, for the API), dupes, source, column, countryColumn, unknownIds }
 */
export function parseInput(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  const split = (l) => l.split(/\t|,|;|\|/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
  const headerAt = lines.findIndex((l) => split(l).some((c) => SKU_HEADER.test(c)));
  let raw;
  let source = "numbers";
  let column, countryColumn;
  if (headerAt >= 0) {
    const cells = split(lines[headerAt]);
    const col = cells.findIndex((c) => SKU_HEADER.test(c));
    const ccol = cells.findIndex((c) => COUNTRY_HEADER.test(c));
    column = cells[col];
    source = "column";
    if (ccol >= 0) { countryColumn = cells[ccol]; source = "sku+country"; }
    raw = lines.slice(headerAt + 1).map(split).filter((r) => /^\d{3,8}$/.test(r[col] || ""))
      .map((r) => (ccol >= 0 ? { sku: r[col], countryId: (r[ccol] || "").trim() } : { sku: r[col] }));
  } else {
    raw = (String(text || "").match(/\b\d{3,8}\b/g) || []).map((sku) => ({ sku }));
  }
  const seen = new Set();
  const rows = [];
  const unknownIds = new Set();
  let dupes = 0;
  for (const r of raw) {
    const key = r.sku + "|" + (r.countryId ?? "");
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    if (r.countryId !== undefined) {
      r.country = COUNTRY_IDS[r.countryId] || null;
      if (!r.country) unknownIds.add(r.countryId || "(blank)");
    }
    rows.push(r);
  }
  const skus = [...new Set(rows.map((r) => r.sku))];
  return { rows, skus, dupes, source, column, countryColumn, unknownIds: [...unknownIds] };
}

/** SKU-only view of parseInput (kept for callers that just need the unique SKUs). */
export function parseSkus(text) {
  const p = parseInput(text);
  return { skus: p.skus, dupes: p.dupes, source: p.source === "sku+country" ? "column" : p.source, column: p.column };
}

// API dates are local calendar dates ("2025-06-30T00:00:00"); compare them as whole days.
const toDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const DAY = 86400000;
export const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * The web window that counts for one country: the one live on asOf, else the most recent one that has
 * started (so a relaunched SKU counts from its relaunch), else the next upcoming one.
 */
function countryWindow(rows, asOf) {
  const wins = rows.map((r) => ({ start: toDay(r.startDate), end: r.endDate ? toDay(r.endDate) : null, available: r.available })).filter((w) => w.start != null);
  if (!wins.length) return null;
  const live = wins.filter((w) => w.start <= asOf && (w.end == null || w.end >= asOf)).sort((a, b) => a.start - b.start);
  if (live.length) return { ...live[0], live: true };
  const started = wins.filter((w) => w.start <= asOf).sort((a, b) => b.start - a.start);
  if (started.length) return { ...started[0], live: false };
  const upcoming = wins.sort((a, b) => a.start - b.start)[0];
  return { ...upcoming, live: false, future: true };
}

/**
 * Evaluates one SKU.
 * product: one item of the API response (or undefined if the API didn't return it)
 * opts: { asOf: "YYYY-MM-DD", days: 90, countries: ["UnitedStates", …] | null (all) }
 * Returns { sku, name, status, countries: [{country, start, end, live, future, days, due}], earliestWeb, note }
 * status: "remove" | "keep" | "upcoming" | "noweb" | "notfound"
 */
export function evaluate(sku, product, opts) {
  const asOf = toDay(opts.asOf);
  const limit = opts.days;
  if (!product) return { sku, name: "", status: "notfound", countries: [], note: "Not returned by the product service" };
  const info = product.productInformation || {};
  const desc = (info.descriptions || []).find((d) => d.language === "English" && d.country === "UnitedStates")
    || (info.descriptions || []).find((d) => d.language === "English") || (info.descriptions || [])[0];
  const name = desc ? String(desc.productName || "").trim() : "";

  const web = (info.channelAvailability || []).filter((c) => c.salesChannel === "Web" && (!opts.countries || opts.countries.includes(c.country)));
  if (!web.length) return { sku, name, status: "noweb", countries: [], note: opts.countries ? "No Web availability in the selected countries" : "No Web availability" };

  const byCountry = {};
  for (const r of web) (byCountry[r.country] ||= []).push(r);
  const countries = Object.entries(byCountry).map(([country, rows]) => {
    const w = countryWindow(rows, asOf);
    const days = w.future ? null : Math.floor((asOf - w.start) / DAY);
    return {
      country, start: isoDay(w.start), end: w.end != null ? isoDay(w.end) : null, live: w.live, future: !!w.future,
      days, due: isoDay(w.start + limit * DAY), over: days != null && days > limit,
    };
  }).sort((a, b) => a.country.localeCompare(b.country));

  const earliest = Math.min(...web.map((r) => toDay(r.startDate)).filter((t) => t != null));
  const started = countries.filter((c) => !c.future);
  let status;
  if (countries.some((c) => c.over)) status = "remove";
  else if (started.length) status = "keep";
  else status = "upcoming";

  let note = "";
  if (status === "remove" && !countries.some((c) => c.live)) note = "No longer on the web";
  else if (status === "keep") {
    const next = started.map((c) => c.due).sort()[0];
    const left = Math.ceil((toDay(next) - asOf) / DAY);
    note = left > 0 ? `${limit} days on ${next} (in ${left} day${left === 1 ? "" : "s"})` : `${limit} days today (${next})`;
  } else if (status === "upcoming") note = "Web start " + countries.map((c) => c.start).sort()[0];

  return { sku, name, status, countries, earliestWeb: isoDay(earliest), note, maxDays: Math.max(-1, ...started.map((c) => c.days)) };
}

/**
 * Evaluates one pasted row. With a CountryID the row is checked against that country only (the stamp is
 * per country); without one, against the selected countries (opts.countries).
 */
export function evaluateRow(row, product, opts) {
  const base = { countryId: row.countryId, country: row.country };
  if (row.countryId !== undefined && !row.country) {
    return { sku: row.sku, ...base, name: "", status: "badcountry", countries: [], note: `CountryID ${row.countryId || "(blank)"} isn't mapped to a country` };
  }
  const r = evaluate(row.sku, product, row.country ? { ...opts, countries: [row.country] } : opts);
  if (row.country && r.status === "noweb") r.note = `No Web availability in ${COUNTRY_LABELS[row.country] || row.country}`;
  return { ...r, ...base };
}

/** Stable key for a result row (a SKU can appear once per country). */
export const rowKey = (r) => r.sku + "|" + (r.countryId ?? "");

/** URL for one batch: repeated skus= parameters (a comma list isn't supported by the API). */
export function batchUrl(apiBase, skus) {
  return `${String(apiBase).replace(/\/+$/, "")}/Products/GlobalProductInformation?${skus.map((s) => "skus=" + encodeURIComponent(s)).join("&")}`;
}

export const STATUS = {
  remove: { label: "Remove stamp", rank: 0 },
  keep: { label: "Keep", rank: 2 },
  upcoming: { label: "Not on the web yet", rank: 3 },
  noweb: { label: "No Web channel", rank: 1 },
  notfound: { label: "Not found", rank: 1 },
  error: { label: "Error", rank: 1 },
  badcountry: { label: "Unknown country", rank: 1 },
};

/**
 * CSV of the results. SKU + CountryID input: one row per SKU and country. SKU-only input: one row per SKU
 * with a web start / days column pair per country.
 */
export function toCsv(results, countries) {
  const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  if (results.some((r) => r.countryId !== undefined)) {
    const head = ["SKU", "CountryID", "Country", "Product", "Status", "Web start", "Web end", "Days on web", "Note"];
    const rows = results.map((r) => {
      const x = (r.countries || [])[0];
      return [r.sku, r.countryId, COUNTRY_LABELS[r.country] || r.country || "", r.name, (STATUS[r.status] || {}).label || r.status,
        x ? x.start : "", x ? x.end || "" : "", x && x.days != null ? x.days : "", r.note || r.error || ""];
    });
    return [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  }
  const head = ["SKU", "Product", "Status", "Note", ...countries.flatMap((c) => [`${COUNTRY_LABELS[c] || c} web start`, `${COUNTRY_LABELS[c] || c} days on web`])];
  const rows = results.map((r) => [r.sku, r.name, (STATUS[r.status] || {}).label || r.status, r.note || r.error || "",
    ...countries.flatMap((c) => { const x = (r.countries || []).find((y) => y.country === c); return x ? [x.start, x.days ?? ""] : ["", ""]; })]);
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
