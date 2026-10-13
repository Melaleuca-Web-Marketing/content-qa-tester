// Everything banner-preview/editor.js needs from CodeMirror, bundled into one ES module.
export { EditorState, Compartment, StateEffect, Transaction } from "@codemirror/state";
export {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, hoverTooltip, placeholder,
} from "@codemirror/view";
export { defaultKeymap, history, historyKeymap, indentWithTab, selectAll } from "@codemirror/commands";
export { html, autoCloseTags } from "@codemirror/lang-html";
export {
  syntaxTree, indentOnInput, bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting,
} from "@codemirror/language";
export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, startCompletion } from "@codemirror/autocomplete";
export { linter, lintGutter, forceLinting } from "@codemirror/lint";
export { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
export { tags } from "@lezer/highlight";
