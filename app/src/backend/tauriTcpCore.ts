import { invoke } from "@tauri-apps/api/core";
import { bind, listen as listenTcp, unbind, type Payload } from "@kuyoonjo/tauri-plugin-tcp";
import { logger } from "@libp2p/logger";
import type { Uint8ArrayList } from "uint8arraylist";

const log = logger("helix:tauri-tcp-core");

/**
 * The @kuyoonjo/tauri-plugin-tcp primitives shared by *both* Tauri TCP transports in
 * this app - tauriTcpTransport.ts (the main Helix node, @libp2p/interface v2) and
 * heliaTcpTransport.ts (the Helia node, v3). Split out here rather than duplicated so
 * there's exactly one subscription to the plugin's single `plugin://tcp` event
 * channel (subscribing twice would work - each transport's own `id`s never collide,
 * generated via crypto.randomUUID() - but is pure waste), and exactly one
 * implementation of the OS-assigned-port workaround and local-IP lookup. Nothing here
 * touches @libp2p/interface types at all, so it's naturally version-agnostic.
 */

/** The plugin exposes exactly one event channel (`plugin://tcp`) for every socket -
 *  fanned out here to whichever dial/listen instance's `id` (and, for a listener's
 *  accepted peers, `addr`) matches. Subscribed once, lazily, so a browser build
 *  (which never constructs either transport - see isTauri() in platform.ts) never
 *  touches Tauri's event API. */
const handlers = new Set<(payload: Payload) => void>();
let subscribed = false;
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  void listenTcp((evt) => {
    for (const h of handlers) h(evt.payload);
  }).catch((err: unknown) => {
    subscribed = false;
    log.error("failed to subscribe to tauri-plugin-tcp events - %o", err);
  });
}

export function onTcpEvent(handler: (payload: Payload) => void): () => void {
  ensureSubscribed();
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Fetches the device's own non-loopback IPv4 addresses via the local_ipv4_addresses
 *  Tauri command (src-tauri/src/lib.rs) - needed to build real dialable multiaddrs for
 *  a TCP listener, since no installed plugin exposes the device's own IP. */
export async function localIpv4Addresses(): Promise<string[]> {
  return invoke<string[]>("local_ipv4_addresses");
}

export function toUint8Array(chunk: Uint8Array | Uint8ArrayList): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : chunk.subarray();
}

/**
 * Probes each candidate port in turn (bind, then immediately unbind) and returns the
 * first one that's free. Needed because bind()'s success event echoes back the
 * requested endpoint rather than an OS-resolved one, so there's no way to ask for "any
 * free port" and learn which one was picked - the caller must supply an explicit port
 * up front, and createLibp2p/createIpfsNode have no retry-across-ports mechanism of
 * their own once listening fails. Accepts a small bind-then-immediately-unbind race
 * (another process could take the port in between) as an acceptable tradeoff for how
 * rarely that actually happens in practice, rather than plumbing retry logic through
 * either node's own startup.
 */
export async function findAvailablePort(candidatePorts: number[]): Promise<number> {
  for (const port of candidatePorts) {
    const probeId = crypto.randomUUID();
    try {
      await bind(probeId, `0.0.0.0:${port}`);
      await unbind(probeId).catch(() => {});
      return port;
    } catch {
      // in use (or otherwise unavailable) - try the next candidate
    }
  }
  throw new Error(`tauri-tcp: no available port among candidates: ${candidatePorts.join(", ")}`);
}
