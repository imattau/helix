// Node only made `CustomEvent` a global (no flag) starting in v19 - libp2p's internal
// event-target usage (main-event/TypedEventEmitter) needs it. Must run before any
// libp2p import below. Confirmed by actually running the built bundle under Node
// 18.19.1 (Ubuntu 24.04's default `nodejs` package, and this project's own
// `nodejs (>= 18)` .deb dependency) - it crashed with ReferenceError: CustomEvent is
// not defined on first use, despite `Event`/`EventTarget` already being global there.
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    detail: unknown;
    constructor(type: string, params: { detail?: unknown; bubbles?: boolean; cancelable?: boolean } = {}) {
      super(type, params);
      this.detail = params.detail ?? null;
    }
  } as typeof CustomEvent;
}

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import type { Ed25519PrivateKey } from '@libp2p/interface';
import { createHelixNode } from '../node/createNode.js';
import { announceAndVerifyRendezvous } from '../node/rendezvous.js';
import { startRelayPageServer } from './relayPage.js';

/**
 * A standalone circuit-relay-v2 + DHT-rendezvous anchor: the always-on, genuinely
 * publicly-reachable node that lets NAT'd Helix peers (see src/node/createNode.ts's
 * NAT traversal NOTE) get a `/p2p-circuit` reservation and be dialed by strangers, and
 * that other peers can find via the public DHT without needing a bootstrap peer of
 * their own. Deliberately not src/cli/peer.ts with extra flags: peer.ts is a two-party
 * demo (hardcoded alice/bob roles, a forged-genesis demonstration, a fixed posting
 * loop) - none of that applies to a long-lived piece of network infrastructure that
 * has no user, posts, or genome of its own. This only ever runs the libp2p node itself.
 *
 * Deployment: see packaging/relay/ for the systemd unit, config file, and install
 * script this is meant to run under.
 */

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const DEFAULT_PORT = 4001;
const DEFAULT_DATA_DIR = '/var/lib/helix-relay';
/** port+1 is already the WebSocket listener (see createNode.ts) - +2 keeps the web
 *  page on its own port with no risk of colliding with either. `--web-port 0`
 *  disables the page entirely. */
const DEFAULT_WEB_PORT_OFFSET = 2;

/**
 * The relay's own PeerId must survive restarts: every `/p2p-circuit/p2p/<relay-id>`
 * address it has ever handed out embeds it, and a changed PeerId would silently
 * strand every peer relying on this relay until they re-discover a new one.
 */
async function loadOrCreateIdentity(keyPath: string): Promise<Ed25519PrivateKey> {
  try {
    const bytes = await fs.readFile(keyPath);
    return privateKeyFromProtobuf(bytes) as Ed25519PrivateKey;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const privateKey = await generateKeyPair('Ed25519');
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, privateKeyToProtobuf(privateKey), { mode: 0o600 });
  return privateKey;
}

/** A bare hostname (the common case for --proxy) is assumed to be a reverse proxy
 *  terminating TLS on 443 and forwarding to this node's WebSocket listener - the
 *  standard shape for exposing a libp2p node through nginx/Caddy/etc. A value that's
 *  already a full multiaddr (starts with `/`) is used exactly as given, for anything
 *  more unusual (a different port, raw TCP passthrough instead of WS, ...). */
function toAnnounceMultiaddr(proxy: string): string {
  return proxy.startsWith('/') ? proxy : `/dns4/${proxy}/tcp/443/wss`;
}

/** Picks which of the relay's own multiaddrs is worth putting on the web page/QR -
 *  prefers the proxied announce address when one's configured (that's the actually-
 *  dialable-from-the-internet one), otherwise the first WebSocket-capable listen
 *  address, since a browser-mode Helix client (webSockets()+circuitRelayTransport()
 *  only - see createNode.ts) can never dial a raw tcp() address anyway. */
function pickBootstrapAddr(addrs: string[], proxy: string | undefined): string | undefined {
  if (proxy) {
    const prefix = toAnnounceMultiaddr(proxy);
    return addrs.find((a) => a.startsWith(prefix));
  }
  return addrs.find((a) => a.includes('/ws')) ?? addrs[0];
}

/** How often the relay re-announces its rendezvous key - provider records expire on
 *  the DHT (see src/node/rendezvous.ts). */
const DHT_REANNOUNCE_INTERVAL_MS = 30 * 60_000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port ?? process.env.HELIX_RELAY_PORT ?? DEFAULT_PORT);
  const dataDir = path.resolve(args['data-dir'] ?? process.env.HELIX_RELAY_DATA_DIR ?? DEFAULT_DATA_DIR);
  const proxy = args.proxy ?? process.env.HELIX_RELAY_PROXY;
  // Empty string (not just unset) must also fall through to the default - systemd's
  // EnvironmentFile sets a bare `HELIX_RELAY_WEB_PORT=` line to "", not undefined,
  // same reasoning as the existing `if (proxy)` truthiness check below rather than a
  // `?? ` chain for HELIX_RELAY_PROXY.
  const webPortRaw = args['web-port'] || process.env.HELIX_RELAY_WEB_PORT;
  const webPort = webPortRaw ? Number(webPortRaw) : port + DEFAULT_WEB_PORT_OFFSET;

  const privateKey = await loadOrCreateIdentity(path.join(dataDir, 'identity.key'));
  const node = await createHelixNode({
    port,
    privateKey,
    publicDiscovery: true,
    relayServer: true,
    ...(proxy ? { announceAddresses: [toAnnounceMultiaddr(proxy)] } : {}),
  });

  console.log(`[helix-relay] PeerId: ${node.peerId.toString()}`);
  for (const addr of node.getMultiaddrs()) {
    console.log(`[helix-relay] listening on: ${addr.toString()}`);
  }
  if (proxy) {
    console.log(`[helix-relay] announcing behind reverse proxy as: ${toAnnounceMultiaddr(proxy)}`);
  }

  let webServer: Server | undefined;
  if (webPort > 0) {
    const bootstrapAddr = pickBootstrapAddr(
      node.getMultiaddrs().map((a) => a.toString()),
      proxy,
    );
    if (bootstrapAddr) {
      webServer = startRelayPageServer(webPort, bootstrapAddr);
      console.log(`[helix-relay] web page (QR + bootstrap address) on: http://0.0.0.0:${webPort}`);
    } else {
      console.warn('[helix-relay] no dialable address found for the web page - skipping it');
    }
  }

  let shuttingDown = false;
  async function shutdown(exitCode: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[helix-relay] shutting down...');
    await new Promise<void>((resolve) => (webServer ? webServer.close(() => resolve()) : resolve()));
    await node.stop();
    process.exit(exitCode);
  }
  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));

  console.log('[helix-relay] joining the public DHT and announcing rendezvous...');
  const verified = await announceAndVerifyRendezvous(node, AbortSignal.timeout(180_000)).catch(() => false);
  console.log(`[helix-relay] rendezvous announce ${verified ? 'confirmed' : 'not yet confirmed (will keep retrying)'}`);

  setInterval(() => {
    announceAndVerifyRendezvous(node, AbortSignal.timeout(60_000))
      .then((ok) => console.log(`[helix-relay] rendezvous re-announce ${ok ? 'confirmed' : 'failed'}`))
      .catch((err) => console.warn(`[helix-relay] rendezvous re-announce error: ${err instanceof Error ? err.message : err}`));
  }, DHT_REANNOUNCE_INTERVAL_MS).unref();
}

process.on('unhandledRejection', (err) => {
  console.error('[helix-relay] [unhandledRejection]', err);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
