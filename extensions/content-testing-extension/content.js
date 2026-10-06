(() => {
  // Culture codes that mean the same thing (UK site may use uk or gb).
  const ALIASES = { gb: "uk" };
  const norm = (c) => (c ? ALIASES[c] || c : null);

  // Production:  pl.melaleuca.com
  // Stage:       productstore2-pl-preview.melaleuca.com
  // US:          www.melaleuca.com
  function parseHost(host) {
    host = host.toLowerCase();
    if (host === "www.melaleuca.com" || host === "melaleuca.com") return { culture: "us", stage: false };
    let m = host.match(/^([a-z]{2})\.melaleuca\.com$/);
    if (m) return { culture: norm(m[1]), stage: false };
    m = host.match(/^[a-z0-9]+-([a-z]{2})-preview\.melaleuca\.com$/);
    if (m) return { culture: norm(m[1]), stage: true };
    return null; // unrelated hosts / non-culture subdomains -> ignored
  }

  const page = parseHost(location.hostname);
  if (!page) return;

  const IS_TOP = window.top === window;
  const FRAME_ID = Math.random().toString(36).slice(2);
  const OURS = "#clc-panel, #clc-tip";
  const CULT = page.culture.toUpperCase();

  // ---- ignore list (managed in the popup / right-click menu) -----------------
  let rules = [];
  let showIgnored = false;
  let enabled = true;

  const strip = (s) => s.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^\/\//, "");
  const escRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

  // A rule matches the START of the link (without https://). Plain rules must end
  // on a boundary (/ ? # :) so "pl.melaleuca.com" doesn't match "pl.melaleuca.company".
  // "*" is a wildcard.
  function ruleMatches(rule, href) {
    const r = strip(rule.trim());
    const h = strip(href);
    if (!r) return false;
    if (r.includes("*")) return new RegExp("^" + r.split("*").map(escRe).join(".*")).test(h);
    if (!h.startsWith(r)) return false;
    return h.length === r.length || r.endsWith("/") || "/?#:".includes(h[r.length]);
  }

  const ignoredBy = (href) => rules.find((r) => ruleMatches(r, href)) || null;

  function loadSettings(cb) {
    try {
      chrome.storage.sync.get({ ignoreRules: [], showIgnored: false, enabled: true }, (d) => {
        void chrome.runtime.lastError;
        rules = ((d && d.ignoreRules) || []).map((r) => (typeof r === "string" ? r : r.pattern)).filter(Boolean);
        showIgnored = !!(d && d.showIgnored);
        enabled = !(d && d.enabled === false);
        cb();
      });
    } catch { cb(); }
  }

  // ---- redirect resolution (done by background.js) -------------------------
  const resolved = new Map(); // href -> { result, waiters:Set<a> }

  function resolveRedirect(a, href) {
    let e = resolved.get(href);
    if (!e) {
      e = { result: null, waiters: new Set() };
      resolved.set(href, e);
      const done = (res) => {
        e.result = res && res.ok ? res : { ok: false };
        e.waiters.forEach(classify);
        e.waiters.clear();
        updatePanel();
      };
      try {
        chrome.runtime.sendMessage({ type: "clc-resolve", url: href }, (res) => {
          void chrome.runtime.lastError;
          done(res);
        });
      } catch { done(null); } // extension reloaded / context invalidated
    }
    if (!e.result) e.waiters.add(a);
    return e.result;
  }

  // ---- link classification -------------------------------------------------
  function mark(a, kind, label) {
    a.dataset.clc = kind;
    a.dataset.clcLabel = label;
  }

  function clear(a) {
    delete a.dataset.clc;
    delete a.dataset.clcLabel;
    delete a.dataset.clcHref;
    delete a.dataset.clcIgnored;
  }

  // Only for links whose href culture is wrong: decide red vs blue.
  function classify(a) {
    const href = a.dataset.clcHref;
    if (!href || !a.isConnected || a.dataset.clcIgnored) return;
    const target = parseHost(new URL(href).hostname);
    const base = `Expected ${CULT}, href goes to ${target.culture.toUpperCase()}`;
    const res = resolveRedirect(a, href);
    if (!res) return mark(a, "wrong", `${base} (checking redirect…)`);
    if (!res.ok) return mark(a, "wrong", `${base} (redirect could not be verified)`);

    let fin = null;
    try { fin = parseHost(new URL(res.finalUrl).hostname); } catch {}
    // A redirect only counts as OK if it lands on a working page.
    let path = "";
    try { path = new URL(res.finalUrl).pathname; } catch {}
    const broken = res.status >= 400 ||
      /(^|\/)(404|not-?found|page-?not-?found|error)(\/|\.|$)/i.test(path) ||
      /\b404\b|not found/i.test(res.title || "");

    if (fin && fin.culture === page.culture && broken) {
      mark(a, "wrong", `${base}; redirects to a ${CULT} error/404 page (HTTP ${res.status}) ${res.finalUrl}`);
    } else if (fin && fin.culture === page.culture) {
      mark(a, "redirect", `${base}, but redirects to ${CULT} (HTTP ${res.status})`);
    } else {
      mark(a, "wrong", `${base}; lands on ${res.finalUrl} (HTTP ${res.status})`);
    }
  }

  function check(a) {
    clear(a);
    if (!a.href) return;
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    const target = parseHost(url.hostname);
    if (!target) return;

    const wrongCulture = target.culture !== page.culture;
    const stageToProd = !wrongCulture && page.stage && !target.stage;
    if (!wrongCulture && !stageToProd) return;

    a.dataset.clcHref = url.href;

    // Would be flagged, but the user said it's expected.
    const rule = ignoredBy(url.href);
    if (rule) {
      a.dataset.clcIgnored = rule;
      if (showIgnored) mark(a, "ignored", `Ignored by rule: ${rule}`);
      return;
    }

    if (wrongCulture) classify(a);
    else mark(a, "env", "Stage page links to PRODUCTION");
  }

  const visible = (a) => a.getClientRects().length > 0;
  const all = (kind) => [...document.querySelectorAll(`a[data-clc="${kind}"]`)];

  // Toggled off: remove every highlight, the badge and the tooltip.
  function switchOff() {
    document.querySelectorAll("a[data-clc], a[data-clc-ignored]").forEach(clear);
    if (panel) { panel.remove(); panel = null; }
    frames.clear();
    tip.style.display = "none";
  }

  function scan() {
    if (!enabled) return switchOff();
    document.querySelectorAll("a[href]").forEach(check);
    updatePanel();
  }

  // ---- tooltip (never clipped by page overflow, never touches link attrs) --
  const tip = document.createElement("div");
  tip.id = "clc-tip";
  document.body.appendChild(tip);

  document.addEventListener("mouseover", (ev) => {
    const a = ev.target.closest && ev.target.closest("a[data-clc]");
    if (!a) return;
    tip.className = a.dataset.clc;
    tip.textContent = "";
    const b = document.createElement("b");
    b.textContent = a.dataset.clcLabel || "";
    tip.append(b, a.dataset.clcHref || a.href);
    tip.style.display = "block";
    const r = a.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let top = r.top - tr.height - 8;
    if (top < 4) top = r.bottom + 8;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - tr.width - 4));
    tip.style.top = top + "px";
    tip.style.left = left + "px";
  }, true);
  document.addEventListener("mouseout", (ev) => {
    if (ev.target.closest && ev.target.closest("a[data-clc]")) tip.style.display = "none";
  }, true);

  // ---- panel (top frame only) + iframe reporting ---------------------------
  const frames = new Map(); // frame id -> { win, wrong, visibleWrong, redirect, env }
  let panel = null;
  let jumpIdx = -1;

  function localCounts() {
    const wrong = all("wrong");
    return {
      wrong: wrong.length,
      visibleWrong: wrong.filter(visible).length,
      redirect: all("redirect").length,
      env: all("env").length,
      ignored: document.querySelectorAll("a[data-clc-ignored]").length
    };
  }

  function flash(a) {
    a.scrollIntoView({ block: "center", behavior: "smooth" });
    a.setAttribute("data-clc-flash", "");
    setTimeout(() => a.removeAttribute("data-clc-flash"), 2000);
  }

  function jumpLocal(i) {
    const a = all("wrong").filter(visible)[i];
    if (a) flash(a);
  }

  function ensurePanel() {
    if (panel && panel.isConnected) return panel;
    panel = document.createElement("div");
    panel.id = "clc-panel";
    panel.addEventListener("click", () => {
      const own = localCounts().visibleWrong;
      const items = [];
      for (let i = 0; i < own; i++) items.push({ win: null, i });
      frames.forEach((f) => { for (let i = 0; i < f.visibleWrong; i++) items.push({ win: f.win, i }); });
      if (!items.length) return;
      jumpIdx = (jumpIdx + 1) % items.length; // starts at -1, so first click = first link
      const it = items[jumpIdx];
      if (it.win) it.win.postMessage({ clc: "jump", i: it.i }, "*");
      else jumpLocal(it.i);
    });
    document.body.appendChild(panel);
    return panel;
  }

  function updatePanel() {
    if (!enabled) return;
    const c = localCounts();
    if (!IS_TOP) {
      try { window.top.postMessage({ clc: "report", id: FRAME_ID, ...c }, "*"); } catch {}
      return;
    }
    let wrong = c.wrong, redirect = c.redirect, env = c.env, vis = c.visibleWrong, ignored = c.ignored;
    frames.forEach((f) => { wrong += f.wrong; redirect += f.redirect; env += f.env; vis += f.visibleWrong; ignored += f.ignored || 0; });

    const p = ensurePanel();
    const label = CULT + (page.stage ? " (stage)" : "");
    const parts = [];
    if (redirect) parts.push(`${redirect} redirect OK`);
    if (env) parts.push(`${env} stage→prod`);
    if (wrong > vis) parts.push(`${wrong - vis} hidden`);
    if (ignored) parts.push(`${ignored} ignored`);
    const extra = parts.length ? ` · ${parts.join(", ")}` : "";
    const text = wrong
      ? `${label}: ${wrong} wrong-culture link(s)${extra} – click to jump`
      : `${label}: no wrong-culture links${extra}`;
    const cls = wrong ? "bad" : "";
    if (p.textContent !== text) p.textContent = text;
    if (p.className !== cls) p.className = cls;
  }

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || typeof d !== "object") return;
    if (IS_TOP && d.clc === "report" && ev.source) {
      frames.set(d.id, { win: ev.source, wrong: d.wrong, visibleWrong: d.visibleWrong, redirect: d.redirect, env: d.env, ignored: d.ignored });
      updatePanel();
    } else if (!IS_TOP && d.clc === "jump" && ev.source === window.top) {
      jumpLocal(d.i);
    }
  });

  // Popup asks the top frame what is flagged on this page.
  if (IS_TOP) {
    try {
      chrome.runtime.onMessage.addListener((msg, _s, send) => {
        if (!msg || msg.type !== "clc-list") return;
        const items = [...document.querySelectorAll("a[data-clc]")]
          .filter((a) => a.dataset.clc !== "ignored")
          .map((a) => ({
            kind: a.dataset.clc,
            label: a.dataset.clcLabel,
            href: a.dataset.clcHref || a.href,
            text: (a.innerText || a.getAttribute("aria-label") || (a.querySelector("img") || {}).alt || "").trim().slice(0, 60)
          }));
        send({ items, ignored: localCounts().ignored, enabled });
      });
    } catch {}
  }

  // ---- go ------------------------------------------------------------------
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "sync" && (ch.ignoreRules || ch.showIgnored || ch.enabled)) loadSettings(scan);
    });
  } catch {}
  loadSettings(scan);

  // Banners/links render late or change. Ignore our own DOM so we never
  // trigger ourselves.
  const ours = (n) => {
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(el && el.closest && el.closest(OURS));
  };
  let t;
  new MutationObserver((muts) => {
    if (!enabled) return;
    if (muts.every((m) => m.type !== "attributes" && ours(m.target) &&
        [...m.addedNodes, ...m.removedNodes].every(ours))) return;
    clearTimeout(t);
    t = setTimeout(scan, 300);
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["href"]
  });
})();
