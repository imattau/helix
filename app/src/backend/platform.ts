/** True when running inside a Tauri webview (desktop or mobile app), not a plain browser tab. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
