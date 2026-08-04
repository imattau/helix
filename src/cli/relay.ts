import path from 'node:path';
import fs from 'node:fs/promises';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import type { Ed25519PrivateKey } from '@libp2p/interface';
import { createHelixNode } from '../node/createNode.js';
import { announceAndVerifyRendezvous } from '../node/rendezvous.js';

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

/** How often the relay re-announces its rendezvous key - provider records expire on
 *  the DHT (see src/node/rendezvous.ts). */
const DHT_REANNOUNCE_INTERVAL_MS = 30 * 60_000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port ?? process.env.HELIX_RELAY_PORT ?? DEFAULT_PORT);
  const dataDir = path.resolve(args['data-dir'] ?? process.env.HELIX_RELAY_DATA_DIR ?? DEFAULT_DATA_DIR);
  const proxy = args.proxy ?? process.env.HELIX_RELAY_PROXY;

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

  let shuttingDown = false;
  async function shutdown(exitCode: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[helix-relay] shutting down...');
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
