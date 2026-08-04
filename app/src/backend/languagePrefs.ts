const STORAGE_KEY = "helix.ui.language";

export interface Language {
  code: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
];

/** Local preference only - the app UI isn't translated yet, matching this pass's scope. */
export function getLanguageCode(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.some((l) => l.code === stored) ? (stored as string) : "en-US";
}

export function setLanguageCode(code: string): void {
  localStorage.setItem(STORAGE_KEY, code);
}

export function getLanguageLabel(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label ?? "English (US)";
}
