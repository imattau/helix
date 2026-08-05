/** True when running inside a Tauri webview (desktop or mobile app), not a plain browser tab.
 *  Reads `globalThis` rather than the bare `window` identifier - this file is also
 *  type-checked under the root tsconfig (no DOM lib) via test/backend/*.test.ts files
 *  that import app/src/backend modules, where `window` isn't declared at all. */
export function isTauri(): boolean {
  const global = globalThis as unknown as { window?: Record<string, unknown> };
  return global.window !== undefined && "__TAURI_INTERNALS__" in global.window;
}
