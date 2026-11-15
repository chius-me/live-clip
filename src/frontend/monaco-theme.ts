import type { editor } from "monaco-editor";

const light: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#fdfcfb",
    "editor.foreground": "#292c30",
    "editorLineNumber.foreground": "#6b7076",
    "editorLineNumber.activeForeground": "#292c30",
    "editorCursor.foreground": "#b24c37",
    "editor.selectionBackground": "#b24c3733",
    "editor.inactiveSelectionBackground": "#b24c371f",
    "editor.lineHighlightBackground": "#f2f1ee",
    "editorWidget.background": "#f2f1ee",
    "editorWidget.border": "#e5e4e1",
    "editorGutter.background": "#fdfcfb",
    "scrollbarSlider.background": "#e5e4e188",
  },
};

const dark: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#202530",
    "editor.foreground": "#e1e5ed",
    "editorLineNumber.foreground": "#a4adbb",
    "editorLineNumber.activeForeground": "#e1e5ed",
    "editorCursor.foreground": "#eab38b",
    "editor.selectionBackground": "#eab38b44",
    "editor.inactiveSelectionBackground": "#eab38b22",
    "editor.lineHighlightBackground": "#252c38",
    "editorWidget.background": "#252c38",
    "editorWidget.border": "#3c4350",
    "editorGutter.background": "#202530",
    "scrollbarSlider.background": "#3c435088",
  },
};

export function registerClipThemes(monaco: typeof import("monaco-editor")): void {
  monaco.editor.defineTheme("liveclip-light", light);
  monaco.editor.defineTheme("liveclip-dark", dark);
}

export function monacoThemeName(theme: "light" | "dark"): "liveclip-light" | "liveclip-dark" {
  return theme === "dark" ? "liveclip-dark" : "liveclip-light";
}
