import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { yamux } from '@chainsafe/libp2p-yamux';
import { noise } from '@chainsafe/libp2p-noise';
import { gossipsub, type GossipSub } from '@chainsafe/libp2p-gossipsub';
import { identify, type Identify } from '@libp2p/identify';
import { ping, type PingService } from '@libp2p/ping';
import { kadDHT, removePrivateAddressesMapper, type KadDHT, type KadDHTInit } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { autoNAT } from '@libp2p/autonat';
import { dcutr } from '@libp2p/dcutr';
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
 *
 * NOTE on circuit-relay-v2 / autoNAT / dcutr (NAT traversal): a social network's whole
 * point is connecting to people you don't control the network of, and most residential/
 * office connections are NAT'd with nothing forwarded - confirmed hands-on running this
 * project's own DHT rendezvous from a NAT'd dev machine (see the project notes): the
 * node's own listen addresses were private-only, so nothing on the public internet could
 * ever have dialed it back even if discovery had gone perfectly. Client-mode DHT
 * discovery alone can find a NAT'd peer's *record*; it can't make that peer reachable.
 * `circuitRelayTransport()` gives a NAT'd node a `/p2p-circuit` address other peers can
 * dial (by hopping through a relay it has a reservation with), `autoNAT()` tells a node
 * whether it's actually publicly dialable or needs that fallback, and `dcutr()` opportunistically
 * upgrades an established relayed connection to a direct one via hole-punching once both
 * sides know about each other. Same @libp2p/interface v2 pin as kad-dht (see the CVE
 * note above) - all three are on their last v2-compatible major (circuit-relay-v2 3.x,
 * autonat/dcutr 2.x), not their newest, for exactly the same interface-compatibility
 * reason. Bundled with `publicDiscovery` rather than as its own flag: relaying/hole-
 * punching only matters once a node is reachable to strangers on the public internet in
 * the first place, which is what publicDiscovery opts into.
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
   *  src/node/rendezvous.ts. Also enables circuit-relay-v2/autoNAT/dcutr (see the NAT
   *  traversal NOTE above), since they're only useful once a node is dialable by
   *  strangers at all. Opt-in; off by default (and for every test in this repo). */
  publicDiscovery?: boolean;
  /** Also run the circuit-relay-v2 SERVER role, so other (NAT'd) Helix peers can get a
   *  reservation on this node and be dialed via a `/p2p-circuit` address through it.
   *  Only meaningful - and only worth enabling - on a node that's itself genuinely
   *  publicly reachable (a real public IP with the listen port actually forwarded); a
   *  NAT'd node offering to relay for others is pointless, since nothing could dial
   *  *it* either. Ignored unless `publicDiscovery` is also set. Opt-in; off by default. */
  relayServer?: boolean;
  /** Public-facing multiaddrs to announce instead of relying on auto-detected/observed
   *  ones - for a relayServer node running behind a reverse proxy (see src/cli/relay.ts's
   *  `--proxy`), where the address peers must actually dial (the proxy's public
   *  hostname) is never the same as this process's own listen address, so there's
   *  nothing for libp2p to correctly auto-detect here. Merged into libp2p's own
   *  `addresses.announce`, additive to (not replacing) the real listen addresses. */
  announceAddresses?: string[];
}) {
  // Split into two full calls (rather than one config with conditionally-spread
  // service keys) because kad-dht declares `ping` as a *required* component
  // dependency - an optional `ping?:` key (which a conditional spread produces)
  // doesn't satisfy that, even when publicDiscovery is true at runtime.
  if (opts.browser) {
    if (opts.publicDiscovery) {
      return createLibp2p({
        privateKey: opts.privateKey,
        // The bare `/p2p-circuit` address is circuit-relay-v2's "search" form - it's
        // what actually triggers the reservation flow (see the NAT traversal NOTE
        // above). Without an explicit listen address matching it, circuitRelayTransport
        // never calls reserveRelay() at all: confirmed by tracing this directly against
        // the public network - 40 of 52 connected peers advertised full HOP-relay
        // support, yet zero reservations were attempted, because nothing had ever asked
        // the transport to listen. Adding just the transport to `transports` wires in
        // the capability to use a reservation once made; it doesn't request one.
        addresses: { listen: ['/p2p-circuit'] },
        transports: [webSockets(), circuitRelayTransport()],
        streamMuxers: [yamux()],
        connectionEncrypters: [noise()],
        peerDiscovery: [bootstrap({ list: PUBLIC_IPFS_BOOTSTRAP_PEERS })],
        services: {
          pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
          identify: identify(),
          ping: ping(),
          dht: kadDHT(PUBLIC_DHT_INIT),
          autoNAT: autoNAT(),
          dcutr: dcutr(),
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
  const announce = opts.announceAddresses !== undefined ? { announce: opts.announceAddresses } : {};
  const addresses = { listen: [`/ip4/0.0.0.0/tcp/${opts.port}`, `/ip4/0.0.0.0/tcp/${wsPort}/ws`], ...announce };
  if (opts.publicDiscovery) {
    // Split on relayServer for the same reason the browser/publicDiscovery split above
    // exists (see the comment on createHelixNode's call site history): a conditionally-
    // spread `relay?:` key would still type-check here since nothing declares `relay` as
    // a *required* service dependency, but a full literal keeps this consistent with the
    // rest of the file rather than mixing both styles.
    if (opts.relayServer) {
      // No `/p2p-circuit` listen address here: a relayServer node is meant to be the
      // reachable anchor (see the NAT traversal NOTE above) - it already has a real
      // listen address, so it has no reason to go find a *different* relay to hop
      // through itself.
      return createLibp2p({
        privateKey: opts.privateKey,
        addresses,
        transports: [tcp(), webSockets(), circuitRelayTransport()],
        streamMuxers: [yamux()],
        connectionEncrypters: [noise()],
        peerDiscovery: [mdns(), bootstrap({ list: PUBLIC_IPFS_BOOTSTRAP_PEERS })],
        services: {
          pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
          identify: identify(),
          ping: ping(),
          dht: kadDHT(PUBLIC_DHT_INIT),
          autoNAT: autoNAT(),
          dcutr: dcutr(),
          relay: circuitRelayServer(),
        },
      });
    }
    // The bare `/p2p-circuit` address is what actually triggers circuitRelayTransport's
    // reservation flow - see the identical comment on the browser+publicDiscovery
    // branch above, where this was confirmed against the live public network.
    return createLibp2p({
      privateKey: opts.privateKey,
      addresses: { ...addresses, listen: [...addresses.listen, '/p2p-circuit'] },
      transports: [tcp(), webSockets(), circuitRelayTransport()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      peerDiscovery: [mdns(), bootstrap({ list: PUBLIC_IPFS_BOOTSTRAP_PEERS })],
      services: {
        pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
        identify: identify(),
        ping: ping(),
        dht: kadDHT(PUBLIC_DHT_INIT),
        autoNAT: autoNAT(),
        dcutr: dcutr(),
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
