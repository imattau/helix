import { useEffect, useState } from "react";

/** Persists a collapsed/expanded boolean to localStorage, same pattern as identity persistence. */
export function useCollapsed(key: string, defaultValue = false): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored !== null ? stored === "1" : defaultValue;
  });

  useEffect(() => {
    localStorage.setItem(key, collapsed ? "1" : "0");
  }, [collapsed, key]);

  return [collapsed, setCollapsed];
}
