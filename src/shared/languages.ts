export const LANGUAGES = [
  { id: "plaintext", label: "Plain Text" },
  { id: "markdown", label: "Markdown" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "shell", label: "Shell" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "sql", label: "SQL" },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]["id"];

export function isLanguageId(value: string): value is LanguageId {
  return LANGUAGES.some((language) => language.id === value);
}
