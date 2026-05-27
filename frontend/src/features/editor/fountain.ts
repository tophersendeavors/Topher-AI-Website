import type { editor, languages } from "monaco-editor";

// Minimal Monarch tokenizer for Fountain. Highlights scene headings,
// characters, dialogue, parentheticals, transitions, sections, and notes.
export const FOUNTAIN_LANG_ID = "fountain";

export function fountainLanguageDef(): languages.IMonarchLanguage {
  return {
    defaultToken: "",
    tokenizer: {
      root: [
        // Scene headings
        [/^(?:\.|INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E\.?)\b.*$/i, "keyword.scene"],
        // Transitions
        [/^(?:[A-Z' ]+ TO:|FADE OUT\.?|CUT TO BLACK\.?)$/, "keyword.transition"],
        // Sections
        [/^#+ .*$/, "type.section"],
        // Synopsis
        [/^=.*$/, "comment.synopsis"],
        // Notes
        [/\[\[.*\]\]/, "comment.note"],
        // Character cue (line of all-caps)
        [/^[A-Z][A-Z0-9 .'_-]+(?:\s*\([^)]+\))?$/, "string.character"],
        // Parenthetical
        [/^\(.*\)$/, "comment.parenthetical"],
        // Boneyard
        [/\/\*[\s\S]*?\*\//, "comment.boneyard"],
        // Emphasis
        [/\*\*\*.+?\*\*\*/, "emphasis.bolditalic"],
        [/\*\*.+?\*\*/, "emphasis.bold"],
        [/\*.+?\*/, "emphasis.italic"],
      ],
    },
  };
}

export const FOUNTAIN_THEME: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword.scene", foreground: "ff9a6a", fontStyle: "bold" },
    { token: "keyword.transition", foreground: "f3501a" },
    { token: "type.section", foreground: "caa572", fontStyle: "bold" },
    { token: "string.character", foreground: "e9e3d6", fontStyle: "bold" },
    { token: "comment.parenthetical", foreground: "8b94a8", fontStyle: "italic" },
    { token: "comment.synopsis", foreground: "5d6b82", fontStyle: "italic" },
    { token: "comment.note", foreground: "5d6b82" },
    { token: "comment.boneyard", foreground: "3a4256", fontStyle: "italic" },
    { token: "emphasis.bold", foreground: "ffe5d2", fontStyle: "bold" },
    { token: "emphasis.italic", foreground: "ffe5d2", fontStyle: "italic" },
    { token: "emphasis.bolditalic", foreground: "ffe5d2", fontStyle: "bold italic" },
  ],
  colors: {
    "editor.background": "#0a0c12",
    "editor.foreground": "#dfd9c9",
    "editorCursor.foreground": "#ff6f3a",
    "editor.lineHighlightBackground": "#11141d",
    "editorLineNumber.foreground": "#3a4256",
    "editorLineNumber.activeForeground": "#caa572",
    "editorGutter.background": "#0a0c12",
  },
};
