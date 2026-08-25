import type { editor } from "monaco-editor";

const light: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#d8d5ce",
    "editor.foreground": "#161615",
    "editorLineNumber.foreground": "#6a6862",
    "editorLineNumber.activeForeground": "#3a3936",
    "editorCursor.foreground": "#8d5a2b",
    "editor.selectionBackground": "#8d5a2b55",
    "editor.inactiveSelectionBackground": "#8d5a2b33",
    "editor.lineHighlightBackground": "#ccc9c166",
    "editorWidget.background": "#e8e6df",
    "editorWidget.border": "#9e9a90",
    "editorGutter.background": "#d8d5ce",
    "scrollbarSlider.background": "#9e9a9044",
  },
};

const dark: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#121211",
    "editor.foreground": "#e8e6df",
    "editorLineNumber.foreground": "#7a776f",
    "editorLineNumber.activeForeground": "#b8b5ac",
    "editorCursor.foreground": "#c4a574",
    "editor.selectionBackground": "#8d5a2b66",
    "editor.inactiveSelectionBackground": "#8d5a2b33",
    "editor.lineHighlightBackground": "#1c1c1a",
    "editorWidget.background": "#1c1c1a",
    "editorWidget.border": "#3f3e39",
    "editorGutter.background": "#121211",
    "scrollbarSlider.background": "#3f3e3966",
  },
};

export function registerClipThemes(monaco: typeof import("monaco-editor")): void {
  monaco.editor.defineTheme("liveclip-light", light);
  monaco.editor.defineTheme("liveclip-dark", dark);
}

export function monacoThemeName(theme: "light" | "dark"): "liveclip-light" | "liveclip-dark" {
  return theme === "dark" ? "liveclip-dark" : "liveclip-light";
}
