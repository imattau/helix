import { invoke } from "@tauri-apps/api/core";
import { bind, connect, disconnect, listen as listenTcp, send, unbind, type Payload } from "@kuyoonjo/tauri-plugin-tcp";
import { pushable, type Pushable } from "it-pushable";
import { TypedEventEmitter } from "main-event";
import { logger } from "@libp2p/logger";
import { multiaddr, type Multiaddr } from "@multiformats/multiaddr";
import { TCP as TCPMatcher } from "@multiformats/multiaddr-matcher";
import { ipPortToMultiaddr } from "@libp2p/utils/ip-port-to-multiaddr";
import { transportSymbol } from "@libp2p/interface";
import type {
  CreateListenerOptions,
  DialTransportOptions,
  Listener,
  ListenerEvents,
  Transport,
} from "@libp2p/interface";
import type { Connection, MultiaddrConnection } from "@libp2p/interface";
import type { Uint8ArrayList } from "uint8arraylist";

const log = logger("helix:tauri-tcp");

/**
 * A libp2p Transport backed by @kuyoonjo/tauri-plugin-tcp - a real TCP socket, unlike
 * webSockets()/circuitRelayTransport(), which are the only options available in a
 * literal browser tab (see the "browser" NOTE in src/node/createNode.ts). A Tauri
 * webview (desktop or Android; the plugin doesn't support iOS) has a native Rust host
 * process that CAN open raw sockets, even though the webview's own JS still can't -
 * this bridges that gap over Tauri's IPC.
 *
 * Only used when isTauri() (see platform.ts) - never constructed for a plain browser
 * tab, which has no IPC bridge to a native host at all.
 *
 * One real limitation carried over from the plugin itself: `bind()`'s success event
 * echoes back the endpoint string it was *asked* to bind, not the OS-resolved one, so
 * there's no way to learn an OS-assigned ephemeral port (`/tcp/0`) through this API.
 * Callers must pick (and retry across, on EADDRINUSE) an explicit port - see
 * client.ts's connect().
 */

/** The plugin exposes exactly one event channel (`plugin://tcp`) for every socket -
 *  fanned out here to whichever dial/listen instance's `id` (and, for a listener's
 *  accepted peers, `addr`) matches. Subscribed once, lazily, so a browser build
 *  (which never constructs this transport at all - see isTauri() in platform.ts)
 *  never touches Tauri's event API. */
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
function onTcpEvent(handler: (payload: Payload) => void): () => void {
  ensureSubscribed();
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Fetches the device's own non-loopback IPv4 addresses via the local_ipv4_addresses
 *  Tauri command (src-tauri/src/lib.rs) - needed to build real dialable multiaddrs for
 *  the TCP listener below, since no installed plugin exposes the device's own IP. */
async function localIpv4Addresses(): Promise<string[]> {
  return invoke<string[]>("local_ipv4_addresses");
}

function toUint8Array(chunk: Uint8Array | Uint8ArrayList): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : chunk.subarray();
}

/** Builds a MultiaddrConnection around a single (already-connected) socket `id` -
 *  shared by both the dialer and the listener's per-peer inbound connections, which
 *  differ only in how the underlying socket was established and how it's closed. */
function toMultiaddrConnection(opts: {
  id: string;
  /** The plugin's per-peer `addr` for a listener's accepted connection - `send()`
   *  needs this to route to the right accepted socket (see tauri-plugin-tcp's Rust
   *  side: a bound socket tracks accepted peers in a map keyed by this). Omitted for
   *  a dialed (client-mode) connection, which has exactly one peer. */
  addr?: string;
  remoteAddr: Multiaddr;
  direction: "inbound" | "outbound";
  onClose: () => void;
}): MultiaddrConnection {
  const source: Pushable<Uint8Array> = pushable<Uint8Array>();
  const unsubscribe = onTcpEvent((payload) => {
    if (payload.id !== opts.id) return;
    if (payload.event.message !== undefined) {
      if (opts.addr !== undefined && payload.event.message.addr !== opts.addr) return;
      source.push(new Uint8Array(payload.event.message.data));
    } else if (payload.event.disconnect !== undefined) {
      if (opts.addr !== undefined && payload.event.disconnect !== opts.addr) return;
      source.end();
    }
  });

  let closed = false;
  const maConn: MultiaddrConnection = {
    async sink(streamSource) {
      try {
        for await (const chunk of streamSource) {
          await send(opts.id, toUint8Array(chunk), opts.addr);
        }
      } finally {
        await maConn.close();
      }
    },
    source,
    remoteAddr: opts.remoteAddr,
    timeline: { open: Date.now() },
    async close() {
      if (closed) return;
      closed = true;
      maConn.timeline.close = Date.now();
      unsubscribe();
      source.end();
      opts.onClose();
    },
    abort(err) {
      source.end(err);
      void maConn.close();
    },
    log: logger(`helix:tauri-tcp:${opts.direction}`),
  };
  return maConn;
}

class TauriTcpListener extends TypedEventEmitter<ListenerEvents> implements Listener {
  private readonly id = crypto.randomUUID();
  private boundPort: number | undefined;
  private localIps: string[] = [];
  private readonly peers = new Map<string, MultiaddrConnection>();
  private unsubscribe?: () => void;

  constructor(private readonly options: CreateListenerOptions) {
    super();
  }

  async listen(ma: Multiaddr): Promise<void> {
    const { port, host } = ma.toOptions();
    this.boundPort = port;
    this.localIps = await localIpv4Addresses();

    this.unsubscribe = onTcpEvent((payload) => {
      if (payload.id !== this.id) return;
      if (payload.event.connect !== undefined) {
        this.onPeerConnected(payload.event.connect);
      }
    });

    await bind(this.id, `${host ?? "0.0.0.0"}:${port}`);
    this.safeDispatchEvent("listening");
  }

  private onPeerConnected(addr: string): void {
    if (this.peers.has(addr)) return;
    const remoteAddr = tcpAddrStringToMultiaddr(addr);
    const maConn = toMultiaddrConnection({
      id: this.id,
      addr,
      remoteAddr,
      direction: "inbound",
      onClose: () => this.peers.delete(addr),
    });
    this.peers.set(addr, maConn);
    this.options.upgrader.upgradeInbound(maConn).catch((err: unknown) => {
      maConn.abort(err instanceof Error ? err : new Error(String(err)));
    });
  }

  getAddrs(): Multiaddr[] {
    if (this.boundPort === undefined) return [];
    return this.localIps.map((ip) => ipPortToMultiaddr(ip, this.boundPort as number));
  }

  updateAnnounceAddrs(): void {}

  async close(): Promise<void> {
    this.unsubscribe?.();
    for (const conn of this.peers.values()) await conn.close();
    this.peers.clear();
    await unbind(this.id).catch(() => {});
    this.safeDispatchEvent("close");
  }
}

function tcpAddrStringToMultiaddr(addr: string): Multiaddr {
  const lastColon = addr.lastIndexOf(":");
  const ip = addr.slice(0, lastColon);
  const port = addr.slice(lastColon + 1);
  return ipPortToMultiaddr(ip, port);
}

export function tauriTcp(): () => Transport {
  return () => ({
    [transportSymbol]: true,
    [Symbol.toStringTag]: "@helix/tauri-tcp",

    async dial(ma: Multiaddr, options: DialTransportOptions): Promise<Connection> {
      const { port, host } = ma.toOptions();
      const id = crypto.randomUUID();
      const endpoint = `${host}:${port}`;

      const connected = new Promise<void>((resolve, reject) => {
        const unsubscribe = onTcpEvent((payload) => {
          if (payload.id !== id) return;
          if (payload.event.connect !== undefined) {
            unsubscribe();
            resolve();
          } else if (payload.event.disconnect !== undefined) {
            unsubscribe();
            reject(new Error(`tauri-tcp: ${endpoint} disconnected before connecting`));
          }
        });
        options.signal.addEventListener("abort", () => {
          unsubscribe();
          reject(new Error("tauri-tcp: dial aborted"));
        });
      });

      await connect(id, endpoint);
      await connected;

      const maConn = toMultiaddrConnection({
        id,
        remoteAddr: ma,
        direction: "outbound",
        onClose: () => {
          void disconnect(id).catch(() => {});
        },
      });

      try {
        return await options.upgrader.upgradeOutbound(maConn, options);
      } catch (err) {
        maConn.abort(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },

    createListener(options: CreateListenerOptions): Listener {
      return new TauriTcpListener(options);
    },

    listenFilter(multiaddrs: Multiaddr[]): Multiaddr[] {
      return multiaddrs.filter((ma) => TCPMatcher.exactMatch(ma));
    },

    dialFilter(multiaddrs: Multiaddr[]): Multiaddr[] {
      return multiaddrs.filter((ma) => TCPMatcher.exactMatch(ma));
    },
  });
}

/**
 * Probes each candidate port in turn (bind, then immediately unbind) and returns the
 * first one that's free. Needed because bind()'s success event echoes back the
 * requested endpoint rather than an OS-resolved one (see the class doc above), so
 * there's no way to ask for "any free port" and learn which one was picked - the
 * caller (client.ts) must supply an explicit port up front, and createLibp2p itself
 * has no retry-across-ports mechanism of its own once listening fails. Accepts a
 * small bind-then-immediately-unbind race (another process could take the port in
 * between) as an acceptable tradeoff for how rarely that actually happens in
 * practice, rather than plumbing retry logic through createLibp2p's own startup.
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

/** Re-exported for client.ts's getOwnConnectAddrs() and multiaddr construction. */
export { multiaddr };
