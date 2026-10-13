// Injected into a melaleuca.com tab with chrome.scripting.executeScript, so it must be fully
// self-contained (no imports, no closures). Returns every category banner / mix-in ad on the page.
export function extractBanners() {
  const abs = (u) => { try { return u ? new URL(u.trim(), location.href).href : ""; } catch { return ""; } };
  const first = (srcset) => (srcset || "").trim().split(/\s*,\s*/)[0].split(/\s+/)[0];
  const lang = document.documentElement.lang || "";
  const out = [];

  for (const b of document.querySelectorAll(".m-fwBanner")) {
    const rte = b.querySelector(".m-rte");
    if (!rte || b.closest(".slick-cloned")) continue; // Slick duplicates slides for looping
    const hero = !!b.closest(".o-heroCarousel") || b.classList.contains("-slide");
    const btn = b.querySelector(".m-fwBanner__cta .a-authorBtn");
    const wrap = btn && btn.closest(".m-fwBanner__cta");
    // Exact classes and inline styles, so extras added in Optimizely (e.g. margin nudges) carry over.
    const cta = btn ? {
      text: (btn.textContent || "").replace(/\s+/g, " ").trim(),
      color: [...btn.classList].find((c) => /^bg-/.test(c)) || "bg-green",
      href: b.getAttribute("href") || "",
      classes: btn.className.trim(),
      style: (btn.getAttribute("style") || "").trim(),
      wrapClasses: wrap ? wrap.className.trim() : "",
      wrapStyle: wrap ? (wrap.getAttribute("style") || "").trim() : "",
    } : null;
    const images = {};
    const pic = b.querySelector(".m-fwBanner__row.-media picture");
    if (pic) {
      for (const s of pic.querySelectorAll("source")) {
        const m = (s.media || "").replace(/\s+/g, "");
        const src = abs(first(s.getAttribute("srcset") || s.getAttribute("data-srcset")));
        if (!src) continue;
        if (/min-width:1024px/.test(m)) images.desktop ||= src;
        else if (/min-width:(768|576)px/.test(m)) images.medium ||= src;
        else if (/max-width:57[56]px/.test(m)) images.small ||= src;
      }
      const img = pic.querySelector("img");
      if (img && !images.desktop) images.desktop = abs(img.getAttribute("src") || img.getAttribute("data-src"));
    }
    const row = b.querySelector(".m-fwBanner__row.-columns");
    out.push({
      template: hero ? "hero" : "category",
      html: rte.innerHTML.trim(),
      cta,
      images,
      bannerClasses: b.className,
      rowClasses: row ? row.className : "",
      label: (rte.innerText || "").replace(/\s+/g, " ").trim().slice(0, 90),
      lang, url: location.href,
    });
  }

  for (const a of document.querySelectorAll(".m-mixinAd")) {
    const head = a.querySelector(".m-mixinAd__headline");
    if (!head) continue;
    const bg = a.querySelector(".m-mixinAd__bg");
    const m = bg && /url\(\s*["']?([^"')]+)/.exec(bg.getAttribute("style") || "");
    out.push({
      template: "mixin",
      html: head.innerHTML.trim(),
      images: m ? { desktop: abs(m[1]) } : {},
      bannerClasses: a.className, rowClasses: "",
      label: (head.innerText || "").replace(/\s+/g, " ").trim().slice(0, 90),
      lang, url: location.href,
    });
  }
  return out;
}
