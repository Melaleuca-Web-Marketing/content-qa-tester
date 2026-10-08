// Quick checks on the raw snippet text — the kind of mistakes that are easy to make while
// hand-editing banner HTML for several languages.

const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;

const lineAt = (src, i) => src.slice(0, i).split("\n").length;

/** Unclosed / unmatched tags, with source positions (from/to) so the editor can underline them. */
export function tagBalance(src) {
  const out = [];
  const stack = [];
  let m;
  TAG.lastIndex = 0;
  const unclosed = (s) => ({ level: "error", from: s.from, to: s.to, msg: `Line ${lineAt(src, s.from)}: <${s.name}> is never closed` });
  while ((m = TAG.exec(src))) {
    if (m[0].startsWith("<!--")) continue;
    const [, closing, rawName, , selfClose] = m;
    const name = rawName.toLowerCase();
    if (VOID.has(name)) continue;
    const pos = { name, from: m.index, to: m.index + m[0].length };
    if (!closing) { if (!selfClose) stack.push(pos); continue; }
    const at = stack.map((s) => s.name).lastIndexOf(name);
    if (at < 0) { out.push({ level: "error", from: pos.from, to: pos.to, msg: `Line ${lineAt(src, m.index)}: </${name}> has no matching opening tag` }); continue; }
    for (const s of stack.splice(at).slice(1)) out.push(unclosed(s));
  }
  for (const s of stack) out.push(unclosed(s));
  return out;
}

const text = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return (t.content.textContent || "").replace(/\s+/g, " ").trim();
};

/** lang: this tab's language code; source: the first (reference) language's snippet. */
export function lint(html, { lang, isSource, source }) {
  const out = [];
  if (!html.trim()) return out;
  out.push(...tagBalance(html));

  const t = document.createElement("template");
  t.innerHTML = html;
  for (const img of t.content.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (!img.hasAttribute("alt") || !img.getAttribute("alt").trim()) out.push({ level: "warn", msg: `Image has no alt text: ${src.split("/").pop()}` });
    if (/^http:\/\//i.test(src)) out.push({ level: "warn", msg: `Image uses http:// (will be blocked on the https site): ${src.split("/").pop()}` });
  }

  if (!isSource) {
    const primary = (lang || "").slice(0, 2).toLowerCase();
    if (primary && primary !== "en") {
      for (const el of t.content.querySelectorAll("[src],[srcset],[href]")) {
        const v = el.getAttribute("src") || el.getAttribute("srcset") || el.getAttribute("href") || "";
        if (/[-_]en-?us\b|--enus|\/en-us\//i.test(v)) out.push({ level: "warn", msg: `Still points at an English (en-US) asset: ${v.trim().split("/").pop()}` });
      }
    }
    if (source && text(source) && text(html) === text(source)) out.push({ level: "warn", msg: "Copy is identical to the first language — not translated yet?" });
  }
  return out;
}
