import { bind, connect, disconnect, send, unbind } from "@kuyoonjo/tauri-plugin-tcp";
import { onTcpEvent, localIpv4Addresses, toUint8Array, findAvailablePort } from "./tauriTcpCore";
import { pushable, type Pushable } from "it-pushable";
import { TypedEventEmitter } from "main-event";
import { logger } from "@libp2p/logger";
// v13, not the top-level (v12) @multiformats/multiaddr - Helia's own nested libp2p
// stack (@libp2p/interface v3) expects v13-compatible Multiaddr instances, same
// reasoning as webrtcTransport.ts's own v13 import.
import { multiaddr, type Multiaddr } from "@multiformats/multiaddr-v13";
import { TCP as TCPMatcher } from "@multiformats/multiaddr-matcher";
import { ipPortToMultiaddr } from "@libp2p/utils/ip-port-to-multiaddr";
import { transportSymbol } from "@libp2p/interface";
import type { Uint8ArrayList } from "uint8arraylist";

/**
 * A real-TCP libp2p Transport for Helia, reusing the exact same
 * @kuyoonjo/tauri-plugin-tcp bridge (via tauriTcpCore.ts) already built for the main
 * Helix node's tauriTcpTransport.ts. On a Tauri desktop/Android build, Helia doesn't
 * need WebRTC's NAT-traversal machinery at all: the webview's native Rust host process
 * can already open raw sockets, same as the main node - see tauriTcpTransport.ts's own
 * doc comment. WebRTC (webrtcTransport.ts) remains the only option for a literal
 * browser tab or iOS, neither of which has this IPC bridge to a native host.
 *
 * Every signature here that crosses into Helia's own v3-pinned @libp2p/interface
 * transport machinery is typed loosely (`any`/`unknown`/local Loose* interfaces)
 * rather than against this project's top-level (v2-pinned, for gossipsub
 * compatibility) copies of Transport/Listener/MultiaddrConnection - same reasoning and
 * pattern as webrtcTransport.ts. The object shapes still fully satisfy the real
 * interface-transport spec at runtime.
 */

interface LooseMultiaddrConnection {
  sink: (source: AsyncIterable<Uint8Array | Uint8ArrayList>) => Promise<void>;
  source: AsyncIterable<Uint8Array>;
  remoteAddr: Multiaddr;
  timeline: { open: number; close?: number };
  close: () => Promise<void>;
  abort: (err: Error) => void;
  log: unknown;
}

/** Builds a MultiaddrConnection around a single (already-connected) socket `id` -
 *  shared by both the dialer and the listener's per-peer inbound connections, same
 *  structure as tauriTcpTransport.ts's toMultiaddrConnection(). */
function toMultiaddrConnection(opts: {
  id: string;
  addr?: string;
  remoteAddr: Multiaddr;
  onClose: () => void;
}): LooseMultiaddrConnection {
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
  const maConn: LooseMultiaddrConnection = {
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
    log: logger("helix:helia-tcp"),
  };
  return maConn;
}

function tcpAddrStringToMultiaddr(addr: string): Multiaddr {
  const lastColon = addr.lastIndexOf(":");
  const ip = addr.slice(0, lastColon);
  const port = addr.slice(lastColon + 1);
  return ipPortToMultiaddr(ip, port) as unknown as Multiaddr;
}

/** v13's Multiaddr dropped toOptions() (present on v12, used by tauriTcpTransport.ts) -
 *  extract the same {host, port} shape from getComponents() instead. */
function toHostPort(ma: Multiaddr): { host: string; port: number } {
  const components = ma.getComponents();
  const host = components.find((c) => c.name === "ip4" || c.name === "ip6")?.value;
  const port = components.find((c) => c.name === "tcp")?.value;
  if (host === undefined || port === undefined) {
    throw new Error(`helia-tcp: cannot extract host/port from ${ma.toString()}`);
  }
  return { host, port: Number(port) };
}

class HeliaTcpListener extends TypedEventEmitter<Record<"listening" | "close" | "error", CustomEvent>> {
  private readonly id = crypto.randomUUID();
  private boundPort: number | undefined;
  private localIps: string[] = [];
  private readonly peers = new Map<string, LooseMultiaddrConnection>();
  private unsubscribe?: () => void;

  constructor(private readonly options: { upgrader: { upgradeInbound: (maConn: unknown) => Promise<unknown> } }) {
    super();
  }

  async listen(ma: Multiaddr): Promise<void> {
    const { port, host } = toHostPort(ma);
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
      onClose: () => this.peers.delete(addr),
    });
    this.peers.set(addr, maConn);
    this.options.upgrader.upgradeInbound(maConn).catch((err: unknown) => {
      maConn.abort(err instanceof Error ? err : new Error(String(err)));
    });
  }

  getAddrs(): Multiaddr[] {
    if (this.boundPort === undefined) return [];
    return this.localIps.map((ip) => ipPortToMultiaddr(ip, this.boundPort as number) as unknown as Multiaddr);
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

interface LooseDialOptions {
  signal: AbortSignal;
  upgrader: { upgradeOutbound: (maConn: unknown, options: unknown) => Promise<unknown> };
}

export function heliaTauriTcp(): () => unknown {
  return () => ({
    [transportSymbol]: true,
    [Symbol.toStringTag]: "@helix/helia-tcp",

    async dial(ma: Multiaddr, options: LooseDialOptions): Promise<unknown> {
      const { port, host } = toHostPort(ma);
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
            reject(new Error(`helia-tcp: ${endpoint} disconnected before connecting`));
          }
        });
        options.signal.addEventListener("abort", () => {
          unsubscribe();
          reject(new Error("helia-tcp: dial aborted"));
        });
      });

      await connect(id, endpoint);
      await connected;

      const maConn = toMultiaddrConnection({
        id,
        remoteAddr: ma,
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

    createListener(options: { upgrader: { upgradeInbound: (maConn: unknown) => Promise<unknown> } }): HeliaTcpListener {
      return new HeliaTcpListener(options);
    },

    listenFilter(multiaddrs: Multiaddr[]): Multiaddr[] {
      return multiaddrs.filter((ma) => TCPMatcher.exactMatch(ma as unknown as Parameters<typeof TCPMatcher.exactMatch>[0]));
    },

    dialFilter(multiaddrs: Multiaddr[]): Multiaddr[] {
      return multiaddrs.filter((ma) => TCPMatcher.exactMatch(ma as unknown as Parameters<typeof TCPMatcher.exactMatch>[0]));
    },
  });
}

/** Re-exported for client.ts's getIpfsNode()/multiaddr construction. */
export { multiaddr, findAvailablePort };
