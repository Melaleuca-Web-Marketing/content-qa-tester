// Page context → QA Tester test targets, and the request bodies the QA Tester's /api/<tool>/start expects.
// Pure functions (no chrome.* calls) so they can be tested outside the extension.
//
// The QA Tester has two code systems:
//   SKU-style (sku, pdp, pslp, page):          region us|ca|mx|uk|ie|de|lt|nl|pl, cultures like "en-US"
//   Banner-style (banner, mixinad, sortorder): region usca|mx|ukeu, cultures like "enus", "uk", "pl"

export const DEFAULT_SERVER = "https://usifhqpsagqat01.melaleuca.net";

/** Host → { env, region } for production, stage and UAT product store hosts. */
export function parseHost(host) {
  host = (host || "").toLowerCase();
  let m;
  if (host === "melaleuca.com") return { env: "production", region: "us" };
  if ((m = /^(www|ca|mx|uk|ie|de|lt|nl|pl)\.melaleuca\.com$/.exec(host))) return { env: "production", region: m[1] === "www" ? "us" : m[1] };
  if ((m = /^productstore2-([a-z]{2})-preview\.melaleuca\.com$/.exec(host))) return { env: "stage", region: m[1] };
  // UAT; the QA Tester's own config spells the Dutch host "uatl" in one place, so accept both.
  if ((m = /^productstore2-uat([a-z]{1,2})\.melaleuca\.com$/.exec(host))) return { env: "uat", region: m[1] === "l" ? "nl" : m[1] };
  return null;
}

const BANNER_REGION = { us: "usca", ca: "usca", mx: "mx", uk: "ukeu", ie: "ukeu", de: "ukeu", lt: "ukeu", nl: "ukeu", pl: "ukeu" };
const norm = (p) => { try { p = decodeURIComponent(p); } catch {} return p.toLowerCase().replace(/\/+$/, "") || "/"; };

/** The QA Tester category ("Main|Item") whose path is this page, from /api/config banner.regions. */
export function findCategory(config, bannerRegion, pathname, culture) {
  const region = config && config.banner && config.banner.regions && config.banner.regions[bannerRegion];
  if (!region) return null;
  const want = norm(pathname);
  for (const cat of region.categories || []) {
    for (const item of cat.items || []) {
      const paths = item.path ? [item.path] : Object.entries(item.paths || {})
        // Prefer this culture's path, but any listed path for the category counts.
        .sort(([a], [b]) => (b === culture) - (a === culture)).map(([, v]) => v);
      if (paths.some((p) => norm(p) === want)) return { value: `${cat.name}|${item.label}`, label: `${cat.name} › ${item.label}` };
    }
  }
  return null;
}

/**
 * Everything the QA tab needs about the open tab.
 * page: result of the in-page probe (see probePage); config: /api/config.
 */
export function resolveContext(url, page, config) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: "This tab isn't a web page." }; }
  const host = parseHost(u.hostname);
  if (!host) return { ok: false, reason: "Open a melaleuca.com product store page (production, stage or UAT) to test it." };
  const regionCfg = config && config.regions && config.regions[host.region];
  const cultures = (regionCfg && regionCfg.cultures) || [];
  const want = ((page && (page.scLang || page.lang)) || u.searchParams.get("sc_lang") || "").toLowerCase();
  const culture = cultures.find((c) => c.toLowerCase() === want)
    || cultures.find((c) => want && c.toLowerCase().startsWith(want.slice(0, 2)))
    || cultures[0] || "en-US";
  const bannerRegion = BANNER_REGION[host.region];
  const langMap = (config && config.banner && config.banner.cultureLangMap) || {};
  const bannerCulture = Object.keys(langMap).find((k) => langMap[k] === culture) || null;
  const category = findCategory(config, bannerRegion, u.pathname, culture);
  const pageUrl = u.origin + u.pathname + u.search; // no #hash
  return {
    ok: true, url: pageUrl, path: u.pathname, env: host.env, region: host.region, culture,
    bannerRegion, bannerCulture, category,
    skus: (page && page.skus) || [],
    has: {
      categoryBanner: !!(page && page.categoryBanner), mixins: (page && page.mixins) || 0,
      hero: !!(page && page.hero), productGrid: !!(page && page.productGrid),
      home: norm(u.pathname) === "/" || norm(u.pathname) === "/productstore",
    },
  };
}

/**
 * The tests the QA Tester can run, when each applies to the open page, whether it's suggested, and
 * whether it needs a site login ("required" | "optional" | "none").
 */
export const TESTS = [
  {
    id: "banner", name: "Category banner", login: "optional",
    applies: (c) => !!c.category && !!c.bannerCulture,
    suggested: (c) => c.has.categoryBanner,
    target: (c) => c.category ? c.category.label : "Category page that's in the QA Tester's list",
  },
  {
    id: "mixinad", name: "Mix-in ads", login: "optional",
    applies: (c) => !!c.category && !!c.bannerCulture,
    suggested: (c) => c.has.mixins > 0,
    target: (c) => c.category ? `${c.category.label}${c.has.mixins ? ` · ${c.has.mixins} on page` : ""}` : "Category page that's in the QA Tester's list",
  },
  {
    id: "sortorder", name: "Sort order", login: "optional",
    applies: (c) => !!c.category && !!c.bannerCulture,
    suggested: () => false,
    target: (c) => c.category ? `${c.category.label} · product order at 1210px` : "Category page that's in the QA Tester's list",
  },
  {
    id: "sku", name: "SKU", login: "none",
    applies: (c) => c.skus.length > 0,
    suggested: (c) => c.skus.length > 0 && c.skus.length <= 3,
    target: (c) => c.skus.length ? `${c.skus.length} SKU${c.skus.length > 1 ? "s" : ""}: ${c.skus.slice(0, 4).join(", ")}${c.skus.length > 4 ? "…" : ""}` : "Product pages (SKUs on the page)",
  },
  {
    id: "pdp", name: "PDP (About This Product)", login: "required",
    applies: (c) => c.skus.length > 0,
    suggested: () => false,
    target: (c) => c.skus.length ? `${c.skus.length} SKU${c.skus.length > 1 ? "s" : ""}` : "Product pages (SKUs on the page)",
  },
  {
    id: "pslp", name: "Store home (PSLP)", login: "required",
    applies: (c) => c.has.home || c.has.hero,
    suggested: (c) => c.has.hero,
    target: () => "Hero carousel, windows, banners… on the store home page",
  },
  {
    id: "page", name: "Page", login: "optional",
    applies: () => true,
    suggested: (c) => !c.has.categoryBanner && !c.has.mixins && !c.skus.length && !c.has.hero,
    target: (c) => c.path,
  },
];

/**
 * Request body for /api/<id>/start, mirroring the QA Tester's own pages.
 * opts: { testName, widths, signIn, username, password, components }
 */
export function buildBody(id, c, opts) {
  const login = opts.signIn || TESTS.find((t) => t.id === id).login === "required";
  const creds = login ? { username: opts.username, password: opts.password } : {};
  const common = { testName: opts.testName, environment: c.env };
  switch (id) {
    case "banner":
    case "mixinad":
      return { ...common, region: c.bannerRegion, cultures: [c.bannerCulture], widths: opts.widths, categories: [c.category.value], loginEnabled: !!opts.signIn, ...creds };
    case "sortorder":
      return { ...common, sortValidationEnabled: true, region: c.bannerRegion, cultures: [c.bannerCulture], categories: [c.category.value], loginEnabled: !!opts.signIn, ...creds };
    case "sku":
      return { ...common, skus: c.skus, region: c.region, cultures: [c.culture], fullScreenshot: true, topScreenshot: false, addToCart: false, username: null, password: null };
    case "pdp":
      return { ...common, skus: c.skus, region: c.region, cultures: [c.culture], username: opts.username, password: opts.password };
    case "pslp":
      return { ...common, region: c.region, culture: c.culture, cultures: [c.culture], screenWidths: opts.widths, components: opts.components, username: opts.username, password: opts.password };
    case "page":
      return {
        ...common, pages: [c.url], region: c.region, cultures: [c.culture], widths: opts.widths, aiReview: false,
        authModes: opts.signIn ? ["signedOut", "signedIn"] : ["signedOut"],
        username: opts.signIn ? opts.username : null, password: opts.signIn ? opts.password : null,
      };
  }
  throw new Error("Unknown test " + id);
}

/**
 * Runs inside the open tab (chrome.scripting.executeScript), so it must be self-contained.
 * Finds the page's language and what the QA Tester could test on it.
 */
export function probePage() {
  const skus = new Set();
  const fromPath = /\/product\/(\d{3,8})(?:\/|$)/i.exec(location.pathname);
  if (fromPath) skus.add(fromPath[1]);
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      for (const it of [].concat(j && j["@graph"] ? j["@graph"] : j)) {
        if (it && /product/i.test(String(it["@type"])) && /^\d{3,8}$/.test(String(it.sku || ""))) skus.add(String(it.sku));
      }
    } catch {}
  }
  for (const el of document.querySelectorAll("[data-sku]")) {
    const v = (el.getAttribute("data-sku") || "").trim();
    if (/^\d{3,8}$/.test(v)) skus.add(v);
  }
  // Product pages show "Item: 60202 | Size: …" (the label is translated, so take the number before the "|").
  for (const el of document.querySelectorAll('[data-testid^="paragraph-productDetailsSkuSize"]')) {
    const m = /(\d{3,8})/.exec((el.textContent || "").split("|")[0]);
    if (m) skus.add(m[1]);
  }
  const banners = [...document.querySelectorAll(".m-fwBanner")].filter((b) => !b.closest(".slick-cloned"));
  return {
    lang: document.documentElement.lang || "",
    scLang: new URLSearchParams(location.search).get("sc_lang") || "",
    categoryBanner: banners.some((b) => !b.closest(".o-heroCarousel") && !b.classList.contains("-slide")),
    hero: !!document.querySelector(".o-heroCarousel"),
    mixins: document.querySelectorAll(".m-mixinAd").length,
    productGrid: !!document.querySelector(".p-catListing__grid"),
    skus: [...skus].slice(0, 100),
  };
}
