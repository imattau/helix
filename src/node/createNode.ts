import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { yamux } from '@chainsafe/libp2p-yamux';
import { noise } from '@chainsafe/libp2p-noise';
import { gossipsub, type GossipSub } from '@chainsafe/libp2p-gossipsub';
import { identify, type Identify } from '@libp2p/identify';
import { ping, type PingService } from '@libp2p/ping';
import { kadDHT, removePrivateAddressesMapper, type KadDHT, type KadDHTInit } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import type { Ed25519PrivateKey } from '@libp2p/interface';

/**
 * NOTE on genome_exists / DHT: the pseudocode's `network.genome_exists()` was originally
 * planned to be backed by @libp2p/kad-dht. That package's only CVE-patched releases
 * (>=16.2.6) require @libp2p/interface v3, which is incompatible with gossipsub (still on
 * v2) as of this writing - there is no version combination where both coexist on the
 * patched line. Genome uniqueness is instead tracked via observed `helix-genesis`
 * gossipsub broadcasts (see src/api/registerUser.ts) - still decentralized, no central
 * server, just backed by pubsub instead of a DHT for this prototype pass.
 *
 * NOTE on `publicDiscovery` / the DHT that IS wired in below: the vulnerable code path
 * (GHSA-32mq-hpph-xfvr / CVE-2026-45783, unbounded disk-exhaustion via unvalidated
 * PUT_VALUE records) only exists in DHT *server* mode - it's the inbound RPC stream
 * handler that's unsafe, and `clientMode: true` never registers one at all
 * (`registrar.handle()` is only called from kad-dht's server-mode branch). A client-mode
 * node can still walk the DHT, `provide()`/`findProviders()` a rendezvous key, etc. - it
 * just never accepts inbound DHT queries from other peers, which is what the exploit
 * needs. So @libp2p/kad-dht's last interface-v2-compatible line (v15.x, unpatched) is
 * safe to use here specifically because `clientMode: true` is hardcoded below, never
 * left to the library's own "auto-switch to server mode for publicly dialable nodes"
 * default (see kad-dht's own docs) - if that default were ever allowed to kick in on the
 * CLI peer (which does have public-looking tcp listen addresses), this would be exploitable.
 *
 * This DHT/bootstrap wiring is opt-in (`publicDiscovery`), not part of every node's
 * default config, so the test suite - which creates many nodes per run - doesn't start
 * depending on real internet access to the public IPFS/libp2p network. See
 * src/node/rendezvous.ts for the actual peer-discovery use of it.
 *
 * NOTE on the WebSocket transport: added alongside (not instead of) TCP so this same
 * node can accept connections from a browser/webview peer later (raw TCP sockets aren't
 * available there) - see the project plan for the PWA/mobile/desktop UI work this is
 * laying the groundwork for. The CLI demo still dials over TCP; the WS listener is
 * additive and unused by it today.
 *
 * NOTE on `browser`: a browser tab can dial out over WebSocket but can never accept an
 * inbound connection (no raw sockets, no listen capability at all), so the in-browser
 * Helix client (app/src/backend/client.ts) needs a node with no listen addresses and no
 * tcp()/mdns() (both Node-only - mdns needs UDP multicast, tcp needs net.Socket) - it
 * only ever dials a bootstrap peer over webSockets(). tcp()/mdns() are imported
 * dynamically, only on the non-browser path, so a browser bundle never even pulls in
 * their Node-only dependencies (dgram, net) - a static top-level import would otherwise
 * get bundled (as dead code) into every browser build.
 */

/**
 * The public libp2p/IPFS bootstrap swarm (bootstrap.libp2p.io) - resolved ahead of time
 * to their secure-WebSocket addresses (`/tcp/443/wss/...`) rather than the `/dnsaddr/...`
 * form, since that's the one transport both a browser tab and this Node CLI peer can
 * actually dial (browsers have no raw TCP/QUIC; runtime dnsaddr TXT-record resolution
 * isn't wired up here). These are entry points into the wider public DHT, not Helix
 * peers themselves - see src/node/rendezvous.ts for how actual Helix peers find each
 * other once connected to it.
 */
export const PUBLIC_IPFS_BOOTSTRAP_PEERS = [
  '/dns/sv15.bootstrap.libp2p.io/tcp/443/wss/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dns/ny5.bootstrap.libp2p.io/tcp/443/wss/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dns/am6.bootstrap.libp2p.io/tcp/443/wss/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dns/sg1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

/** Always client-mode - see the CVE note above. Never pass `clientMode: false`/omit it. */
const PUBLIC_DHT_INIT: KadDHTInit = {
  protocol: '/ipfs/kad/1.0.0',
  clientMode: true,
  peerInfoMapper: removePrivateAddressesMapper,
};

export async function createHelixNode(opts: {
  port: number;
  privateKey: Ed25519PrivateKey;
  browser?: boolean;
  /** Dial the public IPFS/libp2p bootstrap swarm and join its DHT (client-mode only -
   *  see the NOTE above) to find Helix peers beyond a single hardcoded bootstrap - see
   *  src/node/rendezvous.ts. Opt-in; off by default (and for every test in this repo). */
  publicDiscovery?: boolean;
}) {
  // Split into two full calls (rather than one config with conditionally-spread
  // service keys) because kad-dht declares `ping` as a *required* component
  // dependency - an optional `ping?:` key (which a conditional spread produces)
  // doesn't satisfy that, even when publicDiscovery is true at runtime.
  if (opts.browser) {
    if (opts.publicDiscovery) {
      return createLibp2p({
        privateKey: opts.privateKey,
        transports: [webSockets()],
        streamMuxers: [yamux()],
        connectionEncrypters: [noise()],
        peerDiscovery: [bootstrap({ list: PUBLIC_IPFS_BOOTSTRAP_PEERS })],
        services: {
          pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
          identify: identify(),
          ping: ping(),
          dht: kadDHT(PUBLIC_DHT_INIT),
        },
      });
    }
    return createLibp2p({
      privateKey: opts.privateKey,
      transports: [webSockets()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      services: {
        pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
        identify: identify(),
      },
    });
  }

  const [{ tcp }, { mdns }] = await Promise.all([import('@libp2p/tcp'), import('@libp2p/mdns')]);

  // port 0 means "OS-assigned" (used throughout the test suite) - each listen address
  // gets its own independently OS-assigned port in that case, rather than colliding on
  // a fixed +1 offset that only makes sense for the CLI's explicit port numbers.
  const wsPort = opts.port === 0 ? 0 : opts.port + 1;
  const addresses = { listen: [`/ip4/0.0.0.0/tcp/${opts.port}`, `/ip4/0.0.0.0/tcp/${wsPort}/ws`] };
  if (opts.publicDiscovery) {
    return createLibp2p({
      privateKey: opts.privateKey,
      addresses,
      transports: [tcp(), webSockets()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      peerDiscovery: [mdns(), bootstrap({ list: PUBLIC_IPFS_BOOTSTRAP_PEERS })],
      services: {
        pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
        identify: identify(),
        ping: ping(),
        dht: kadDHT(PUBLIC_DHT_INIT),
      },
    });
  }
  return createLibp2p({
    privateKey: opts.privateKey,
    addresses,
    transports: [tcp(), webSockets()],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    peerDiscovery: [mdns()],
    services: {
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
      identify: identify(),
    },
  });
}

export type HelixNode = Awaited<ReturnType<typeof createHelixNode>>;
export type { GossipSub, Identify, PingService, KadDHT };
