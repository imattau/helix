import { useEffect, useState } from "react";

const STORAGE_KEY = "helix.ui.theme";

export type Theme = "dark" | "light";

/** Persists the light/dark choice and applies it as data-theme on <html> (see index.css). */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}
