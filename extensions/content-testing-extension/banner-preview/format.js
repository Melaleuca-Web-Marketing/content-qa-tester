// HTML formatter for banner snippets.
// Block elements go on their own indented lines. Runs of text and inline elements stay together on one
// line with whitespace collapsed to single spaces, which renders identically, so formatting never
// changes the banner's appearance (e.g. "<span>Approach </span>to" keeps its space, "Shop<b>Now</b>" stays joined).

const BLOCK = new Set(("address article aside blockquote body details dialog dd div dl dt fieldset figcaption figure footer form " +
  "h1 h2 h3 h4 h5 h6 head header hgroup hr html li link main meta nav ol p picture pre section source style script " +
  "noscript table tbody td tfoot th thead title tr ul video audio iframe template svg").split(" "));
const RAW = new Set(["pre", "textarea", "script", "style"]);
const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));

const isBlock = (el) => BLOCK.has(el.localName) || [...el.children].some(isBlock);

// Whitespace inside these values is insignificant, so tidy line breaks left over from copy/paste.
const TIDY = new Set(["class", "srcset", "sizes"]);

function attrs(el) {
  return [...el.attributes].map((a) => {
    if (a.value === "" && !/^(alt|href|src|value|target|aria-label)$/.test(a.name)) return " " + a.name;
    const value = TIDY.has(a.name) ? a.value.replace(/\s+/g, " ").trim() : a.value;
    const q = value.includes('"') && !value.includes("'") ? "'" : '"';
    const v = value.replace(/&/g, "&amp;").replace(q === '"' ? /"/g : /'/g, q === '"' ? "&quot;" : "&#39;");
    return ` ${a.name}=${q}${v}${q}`;
  }).join("");
}

const open = (el) => `<${el.localName}${attrs(el)}>`;
const close = (el) => (VOID.has(el.localName) ? "" : `</${el.localName}>`);
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");

/** Inline content as a single line (whitespace collapsed). */
function inline(nodes) {
  let out = "";
  for (const n of nodes) {
    if (n.nodeType === 3) out += escText(n.data.replace(/[\t\n\r ]+/g, " "));
    else if (n.nodeType === 8) out += `<!--${n.data}-->`;
    else if (n.nodeType === 1) out += RAW.has(n.localName) ? n.outerHTML : open(n) + inline(n.childNodes) + close(n);
  }
  return out;
}

function block(nodes, depth, unit, lines) {
  const pad = unit.repeat(depth);
  let run = [];
  const flush = () => {
    const text = inline(run).trim();
    // <br> ends a visual line, so start a new source line after it (leading whitespace there doesn't render).
    if (text) for (const part of text.split(/(?<=<br>)\s*/)) lines.push(pad + part);
    run = [];
  };
  for (const n of nodes) {
    if (n.nodeType === 1 && isBlock(n)) {
      flush();
      if (RAW.has(n.localName) || n.localName === "svg") { lines.push(pad + n.outerHTML.trim()); continue; }
      const kids = [...n.childNodes];
      const hasBlockKid = kids.some((k) => k.nodeType === 1 && isBlock(k));
      if (VOID.has(n.localName)) lines.push(pad + open(n));
      else if (!hasBlockKid) {
        const text = inline(kids).trim();
        const one = pad + open(n) + text + close(n);
        if (!text.includes("<br>")) lines.push(one);
        else { lines.push(pad + open(n)); block(kids, depth + 1, unit, lines); lines.push(pad + close(n)); }
      } else {
        lines.push(pad + open(n));
        block(kids, depth + 1, unit, lines);
        lines.push(pad + close(n));
      }
    } else if (n.nodeType === 8 && !run.length) {
      lines.push(pad + `<!--${n.data}-->`);
    } else {
      run.push(n);
    }
  }
  flush();
}

/** Formats a snippet. Throws if it can't be parsed safely (callers check tag balance first). */
export function formatHtml(src, unit = "  ") {
  const t = document.createElement("template");
  t.innerHTML = src;
  const lines = [];
  block([...t.content.childNodes], 0, unit, lines);
  return lines.join("\n") + "\n";
}
