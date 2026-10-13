// The Copy editor: CodeMirror 6 (bundled in vendor/codemirror.js; MV3 can't load code from a CDN) plus
// knowledge of the brand stylesheet: class autocomplete with breakpoint prefixes and color swatches,
// hover info, unknown-class warnings with "did you mean" fixes, tag-balance errors and formatting.
import {
  EditorState, Compartment, EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, hoverTooltip, placeholder,
  defaultKeymap, history, historyKeymap, indentWithTab, html, syntaxHighlighting, HighlightStyle, indentOnInput,
  bracketMatching, foldGutter, foldKeymap, autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
  startCompletion, linter, lintGutter, forceLinting, searchKeymap, highlightSelectionMatches, tags, Transaction,
} from "./vendor/codemirror.js";
import { tagBalance } from "./lint.js";
import { formatHtml } from "./format.js";
import { RUNTIME_CLASSES, KIND_LABELS, prefixInfo, familyOf } from "./classes.js";

// ---- class index ------------------------------------------------------------------
let classIndex = null;
let prefixes = new Map();
let baseOptions = null;
const prefixCache = new Map();
const views = new Set();

export function setClassIndex(index) {
  classIndex = index;
  prefixes = prefixInfo(index);
  baseOptions = null;
  prefixCache.clear();
  for (const v of views) forceLinting(v);
}

const BOOST = { color: 3, type: 3, space: 3, size: 2, layout: 2, other: 1, comp: -3 };

function ruleInfo(e) {
  const box = document.createElement("div");
  box.className = "cm-bp-info";
  const head = document.createElement("div");
  head.className = "cm-bp-infoHead";
  if (e.swatch) head.append(swatch(e.swatch));
  head.append(`${e.name}  ·  ${KIND_LABELS[e.kind] || ""}`);
  box.append(head);
  if (!e.rules.length) box.append(Object.assign(document.createElement("div"), { textContent: "Only used inside component styles (no standalone rule)." }));
  for (const r of e.rules) {
    const pre = document.createElement("pre");
    const at = [r.media && `@media ${r.media}`, r.pseudo && `state ${r.pseudo}`].filter(Boolean).join("  ");
    pre.textContent = (at ? at + "\n" : "") + r.decl.replace(/;\s*/g, ";\n").trim();
    box.append(pre);
  }
  if (familyOf(classIndex, e.name)) {
    box.append(Object.assign(document.createElement("div"), { className: "cm-bp-tip", textContent: "Right-click for larger / smaller values · Ctrl+Alt+↑/↓ to step" }));
  }
  return box;
}

// ---- scale menu (right-click a class) and Ctrl+Alt+↑/↓ stepping ---------------------------------
const tokenAt = (state, pos) => {
  for (const t of classTokens(state.doc.toString())) if (pos >= t.from && pos <= t.to) return t;
  return null;
};

/** Swaps the class under the cursor for the next larger (dir 1) or smaller (dir -1) one in its scale. */
function stepClass(view, dir) {
  const pos = view.state.selection.main.head;
  const t = classIndex && tokenAt(view.state, pos);
  const fam = t && familyOf(classIndex, t.name);
  const next = fam && fam.members[fam.at + dir];
  if (!next) return !!fam; // at the end of the scale: swallow the key, nothing to do
  view.dispatch({ changes: { from: t.from, to: t.to, insert: next.name }, selection: { anchor: t.from + Math.min(pos - t.from, next.name.length) } });
  return true;
}

let scaleMenu = null;

function closeScaleMenu() {
  if (scaleMenu) scaleMenu.close();
}

/**
 * Lists every value in the class's scale. Hovering previews the class (outside undo history) so the
 * viewports update live; click keeps it as one undo step; Esc or clicking away restores the original.
 */
function openScaleMenu(view, token, x, y) {
  const fam = familyOf(classIndex, token.name);
  if (!fam) return false;
  closeScaleMenu();
  const original = token.name;
  let span = { from: token.from, to: token.to };
  let shown = original;
  const put = (name, history) => {
    if (name === shown && !history) return;
    view.dispatch({ changes: { from: span.from, to: span.to, insert: name }, annotations: history ? [] : [Transaction.addToHistory.of(false)] });
    span = { from: span.from, to: span.from + name.length };
    shown = name;
  };

  const menu = document.createElement("div");
  menu.className = "bp-scaleMenu";
  menu.tabIndex = -1;
  const head = document.createElement("div");
  head.className = "bp-scaleHead";
  head.innerHTML = `<b></b><span>Hover to preview · click to use · Esc to cancel</span>`;
  head.firstChild.textContent = fam.prop;
  const list = document.createElement("div");
  list.className = "bp-scaleList";
  menu.append(head, list);

  let active = fam.at;
  const rows = fam.members.map((m, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bp-scaleRow" + (i === fam.at ? " current" : "");
    if (m.swatch) row.append(swatch(m.swatch));
    const name = document.createElement("code");
    name.textContent = m.name;
    const val = document.createElement("span");
    val.textContent = m.value;
    row.append(name, val);
    row.addEventListener("mouseenter", () => highlight(i));
    row.addEventListener("click", () => finish(m.name));
    list.append(row);
    return row;
  });

  function highlight(i) {
    active = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, j) => r.classList.toggle("active", j === active));
    rows[active].scrollIntoView({ block: "nearest" });
    put(fam.members[active].name, false);
  }
  function finish(name) {
    put(original, false);
    if (name && name !== original) put(name, true);
    cleanup();
    view.focus();
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); finish(null); }
    else if (e.key === "ArrowDown") { e.preventDefault(); highlight(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); finish(fam.members[active].name); }
  }
  const onOutside = (e) => { if (!menu.contains(e.target)) finish(null); };
  list.addEventListener("mouseleave", () => put(original, false)); // leaving the list shows the original again
  menu.addEventListener("keydown", onKey);
  function cleanup() {
    document.removeEventListener("mousedown", onOutside, true);
    menu.remove();
    scaleMenu = null;
  }
  scaleMenu = { close: () => finish(null) };

  document.body.append(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
  rows[fam.at].classList.add("active");
  // Show the current value in the middle of the list.
  list.scrollTop = rows[fam.at].offsetTop - list.clientHeight / 2 + rows[fam.at].offsetHeight / 2;
  menu.focus();
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  return true;
}

const scaleHandlers = EditorView.domEventHandlers({
  contextmenu(e, view) {
    if (!classIndex) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const t = pos != null && tokenAt(view.state, pos);
    if (!t || !openScaleMenu(view, t, e.clientX, e.clientY)) return false; // normal browser menu elsewhere
    e.preventDefault();
    return true;
  },
});

function swatch(color) {
  const s = document.createElement("span");
  s.className = "cm-bp-swatch";
  s.style.background = color;
  return s;
}

const toOption = (e) => ({ label: e.name, detail: e.summary, type: "bp-" + e.kind, boost: BOOST[e.kind] ?? 0, swatch: e.swatch, info: () => ruleInfo(e) });

function optionsFor(prefix) {
  if (!prefix) return (baseOptions ||= [...classIndex.values()].filter((e) => !e.name.includes(":")).map(toOption));
  if (!prefixCache.has(prefix)) {
    prefixCache.set(prefix, [...classIndex.values()]
      .filter((e) => e.name.startsWith(prefix) && !e.name.slice(prefix.length).includes(":")).map(toOption));
  }
  return prefixCache.get(prefix);
}

function prefixOptions() {
  return [...prefixes].map(([p, info]) => ({
    label: p + ":", detail: info, type: "bp-prefix", boost: -1,
    apply: (view, c, from, to) => {
      view.dispatch({ changes: { from, to, insert: c.label }, selection: { anchor: from + c.label.length } });
      startCompletion(view); // straight on to the classes that exist at that breakpoint
    },
  }));
}

/** Is the cursor inside a class="…" value? */
function inClassAttr(state, pos) {
  const before = state.sliceDoc(Math.max(0, pos - 3000), pos);
  return /\bclass\s*=\s*(["'])[^"'<>]*$/i.test(before);
}

function classCompletion(ctx) {
  if (!classIndex || !inClassAttr(ctx.state, ctx.pos)) return null;
  const word = ctx.matchBefore(/[^\s"'<>]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const prefix = /^((?:[\w-]+:)*)/.exec(word.text)[1];
  const options = prefix ? optionsFor(prefix) : optionsFor("").concat(prefixOptions());
  const rest = /^[\w\-/.%]*$/;
  return {
    from: word.from, options,
    validFor: (text) => text.startsWith(prefix) && rest.test(text.slice(prefix.length)),
  };
}

/** Every class token inside class="…" attributes, with positions. */
function* classTokens(doc) {
  const re = /\bclass\s*=\s*(["'])([\s\S]*?)\1/gi;
  let m;
  while ((m = re.exec(doc))) {
    const base = m.index + m[0].indexOf(m[1]) + 1;
    const tok = /\S+/g;
    let t;
    while ((t = tok.exec(m[2]))) yield { name: t[0], from: base + t.index, to: base + t.index + t[0].length };
  }
}

function distance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** Closest existing classes, e.g. "pl-65" -> pl-64, pl-60, pl-70 (numbers by value, the rest by spelling). */
function suggestions(name) {
  const stem = name.replace(/[^-:]*$/, "");
  const pool = [];
  for (const k of classIndex.keys()) {
    if (stem ? k.startsWith(stem) && !k.slice(stem.length).includes(":") : !k.includes(":")) pool.push(k);
  }
  const num = /^(.*-)(\d+)$/.exec(name);
  if (num) {
    const scale = pool.filter((k) => /^\d+$/.test(k.slice(num[1].length)));
    if (scale.length) {
      const v = Number(num[2]);
      return scale.sort((a, b) => Math.abs(a.slice(num[1].length) - v) - Math.abs(b.slice(num[1].length) - v)).slice(0, 3);
    }
  }
  return pool.map((k) => [k, distance(name, k)]).sort((a, b) => a[1] - b[1]).slice(0, 3).filter(([, d]) => d <= Math.max(3, name.length / 2)).map(([k]) => k);
}

function diagnostics(view) {
  const doc = view.state.doc.toString();
  const out = tagBalance(doc).map((i) => ({ from: i.from, to: i.to, severity: "error", message: i.msg.replace(/^Line \d+: /, "") }));
  if (classIndex && classIndex.size) {
    for (const t of classTokens(doc)) {
      if (classIndex.has(t.name) || RUNTIME_CLASSES.has(t.name) || /^\{.*\}$/.test(t.name)) continue;
      const near = suggestions(t.name);
      out.push({
        from: t.from, to: t.to, severity: "warning",
        message: `“${t.name}” isn't in app.css, so it won't do anything.` + (near.length ? " Did you mean:" : ""),
        actions: near.map((n) => ({ name: n, apply: (v, from, to) => v.dispatch({ changes: { from, to, insert: n } }) })),
      });
    }
  }
  return out;
}

const classHover = hoverTooltip((view, pos) => {
  if (!classIndex) return null;
  for (const t of classTokens(view.state.doc.toString())) {
    if (pos < t.from || pos > t.to) continue;
    const e = classIndex.get(t.name);
    if (!e) return null;
    return { pos: t.from, end: t.to, above: true, create: () => ({ dom: ruleInfo(e) }) };
  }
  return null;
});

// ---- look ---------------------------------------------------------------------------
const highlight = HighlightStyle.define([
  { tag: [tags.tagName], color: "var(--syn-tag)" },
  { tag: [tags.attributeName], color: "var(--syn-attr)" },
  { tag: [tags.attributeValue, tags.string], color: "var(--syn-val)" },
  { tag: [tags.comment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [tags.angleBracket, tags.punctuation], color: "var(--syn-punc)" },
  { tag: [tags.character], color: "var(--syn-entity)" },
  { tag: [tags.invalid], color: "var(--danger)" },
  { tag: [tags.propertyName], color: "var(--syn-attr)" },
  { tag: [tags.number, tags.unit], color: "var(--syn-entity)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", color: "var(--text)", backgroundColor: "var(--input)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "Consolas, 'Cascadia Mono', monospace", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--sky)" },
  ".cm-cursor": { borderLeftColor: "var(--sky)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(56,189,248,.06)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(56,189,248,.28) !important" },
  ".cm-matchingBracket": { backgroundColor: "rgba(34,197,94,.25)", outline: "none" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-tooltip": { backgroundColor: "var(--bg-end)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "8px", boxShadow: "0 10px 30px rgba(0,0,0,.35)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "Consolas, 'Cascadia Mono', monospace", maxHeight: "18em", minWidth: "340px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 8px", display: "flex", alignItems: "center", gap: "6px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "rgba(56,189,248,.28)", color: "var(--text)" },
  ".cm-completionDetail": { color: "var(--text-2)", fontStyle: "normal", marginLeft: "auto", paddingLeft: "12px", fontSize: "11px" },
  ".cm-completionMatchedText": { color: "var(--sky)", textDecoration: "none", fontWeight: "700" },
  ".cm-completionInfo": { padding: "8px 10px", maxWidth: "360px" },
  ".cm-diagnostic": { padding: "4px 8px" },
  ".cm-diagnosticAction": { backgroundColor: "rgba(56,189,248,.2)", color: "var(--sky)", border: "1px solid var(--sky)", borderRadius: "6px", padding: "0 6px", marginLeft: "6px", font: "inherit" },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--text)" },
  ".cm-panels input, .cm-panels button": { font: "inherit" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--item)", border: "1px solid var(--border)", color: "var(--text-2)" },
});

// ---- editor -------------------------------------------------------------------------
export function createEditor(parent, { onChange, onSave, placeholderText }) {
  const readOnly = new Compartment();
  const htmlLang = html({ autoCloseTags: true });
  let view;

  function format() {
    const doc = view.state.doc.toString();
    if (tagBalance(doc).length) return "Fix the unclosed tags first (underlined in red).";
    const out = formatHtml(doc);
    if (out !== doc) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out }, selection: { anchor: Math.min(view.state.selection.main.head, out.length) } });
    return "";
  }

  const extensions = [
    lineNumbers(), highlightActiveLineGutter(), foldGutter(), lintGutter(),
    highlightSpecialChars(), history(), drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
    indentOnInput(), syntaxHighlighting(highlight), bracketMatching(), closeBrackets(),
    rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
    EditorView.lineWrapping, EditorState.tabSize.of(2),
    htmlLang, htmlLang.language.data.of({ autocomplete: classCompletion }),
    autocompletion({
      maxRenderedOptions: 150,
      addToOptions: [{ render: (c) => (c.swatch ? swatch(c.swatch) : null), position: 20 }],
    }),
    classHover,
    scaleHandlers,
    linter(diagnostics, { delay: 300 }),
    keymap.of([
      { key: "Mod-s", run: () => { onSave(); return true; } },
      { key: "Ctrl-Alt-ArrowUp", run: (v) => stepClass(v, 1) },
      { key: "Ctrl-Alt-ArrowDown", run: (v) => stepClass(v, -1) },
      { key: "Shift-Alt-f", run: () => { const err = format(); if (err) onSave(err); return true; } },
      indentWithTab,
      ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap,
    ]),
    placeholder(placeholderText || ""),
    theme,
    readOnly.of(EditorState.readOnly.of(false)),
    EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
  ];

  view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions }) });
  views.add(view);

  // One undo history per language/banner: switching tabs swaps in that tab's saved editor state.
  const states = new Map();
  let key = null;

  return {
    view,
    format,
    getValue: () => view.state.doc.toString(),
    setValue(text, nextKey) {
      closeScaleMenu(); // restores any previewed class before the document is swapped out
      if (key) states.set(key, view.state);
      const cached = nextKey && states.get(nextKey);
      view.setState(cached && cached.doc.toString() === text ? cached : EditorState.create({ doc: text, extensions }));
      key = nextKey;
    },
    setReadOnly(on) { view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(on)) }); },
    focus: () => view.focus(),
    /** Adds a class at the cursor if it's inside class="…"; returns false otherwise. */
    insertClass(name) {
      const { state } = view;
      let pos = state.selection.main.head;
      if (!inClassAttr(state, pos)) return false;
      // Never split a class name: move to the end of the one the cursor is in.
      while (pos < state.doc.length && !/[\s"'<>]/.test(state.sliceDoc(pos, pos + 1))) pos++;
      const prev = state.sliceDoc(pos - 1, pos), next = state.sliceDoc(pos, pos + 1);
      const text = (/[\s"']/.test(prev) ? "" : " ") + name + (/[\s"']/.test(next) ? "" : " ");
      view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
      view.focus();
      return true;
    },
  };
}
