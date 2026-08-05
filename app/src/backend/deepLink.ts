import { isTauri } from "./platform";

/** helix://bootstrap?addr=<url-encoded-multiaddr> - lets someone tap a link (from the
 *  relay's own webpage - see src/cli/relay.ts's --web-port, or a QR scan) to jump
 *  straight to BootstrapServerScreen with the address pre-filled, instead of typing
 *  or pasting a raw multiaddr by hand. See app/src-tauri/tauri.conf.json's
 *  plugins.deep-link config for the scheme registration this depends on. */
export const BOOTSTRAP_DEEP_LINK_SCHEME = "helix";

/** Parses a helix://bootstrap?addr=... URL into the multiaddr string, or undefined if
 *  it isn't one (wrong scheme, missing addr, or not parseable as a URL at all - a
 *  deep link can originate from anywhere, so this never throws on malformed input). */
export function parseBootstrapDeepLink(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${BOOTSTRAP_DEEP_LINK_SCHEME}:`) return undefined;
  // WHATWG URL parsing treats whatever comes right after `scheme://` as `hostname`
  // for any scheme, not just http/https - so helix://bootstrap?... puts "bootstrap"
  // there. Also accept it as a path segment (helix:///bootstrap?... or similar) since
  // custom-scheme URL parsing isn't as consistently implemented across platforms.
  const isBootstrap = parsed.hostname === "bootstrap" || parsed.pathname.replace(/^\/+/, "") === "bootstrap";
  if (!isBootstrap) return undefined;
  return parsed.searchParams.get("addr") ?? undefined;
}

/**
 * Registers a listener for helix://bootstrap deep links - both the one that may have
 * launched the app fresh (getCurrent()) and any received while it's already running
 * (onOpenUrl(), which also covers Windows/Linux's relaunch-with-argv path via
 * tauri-plugin-single-instance's "deep-link" feature - see lib.rs). No-ops entirely
 * outside Tauri: a plain browser tab has no OS-level URL scheme registration at all,
 * and @tauri-apps/plugin-deep-link has nothing to import there.
 *
 * Deliberately never auto-saves the address itself - only hands it to `onAddr`, whose
 * caller (App.tsx) navigates to BootstrapServerScreen with it pre-filled, requiring
 * the user's own explicit Save tap. A deep link can come from anywhere (a malicious
 * page, a forwarded message), so silently repointing which relay this device trusts
 * without a confirming user action would be a real way to get MITM'd.
 */
export async function registerBootstrapDeepLinkHandler(onAddr: (addr: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};

  const handleUrls = (urls: string[]) => {
    for (const url of urls) {
      const addr = parseBootstrapDeepLink(url);
      if (addr) {
        onAddr(addr);
        return; // first match wins - an open/launch event should only ever carry one
      }
    }
  };

  try {
    const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
    const initial = await getCurrent().catch(() => null);
    if (initial) handleUrls(initial);
    const unlisten = await onOpenUrl(handleUrls);
    return unlisten;
  } catch (err) {
    console.warn("[helix] deep link handler unavailable", err instanceof Error ? err.message : err);
    return () => {};
  }
}
