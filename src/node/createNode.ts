import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { yamux } from '@chainsafe/libp2p-yamux';
import { noise } from '@chainsafe/libp2p-noise';
import { gossipsub, type GossipSub } from '@chainsafe/libp2p-gossipsub';
import { identify, type Identify } from '@libp2p/identify';
import { mdns } from '@libp2p/mdns';
import type { Ed25519PrivateKey } from '@libp2p/interface';

/**
 * NOTE on genome_exists / DHT: the pseudocode's `network.genome_exists()` was originally
 * planned to be backed by @libp2p/kad-dht. That package's only CVE-patched releases
 * require @libp2p/interface v3, which is incompatible with gossipsub (still on v2) as of
 * this writing - there is no version combination where both coexist without either a
 * known critical vulnerability or a broken build. Since the DHT was already "theatrical"
 * for a 2-peer local demo, genome uniqueness is instead tracked via observed
 * `helix-genesis` gossipsub broadcasts (see src/api/registerUser.ts) - still decentralized,
 * no central server, just backed by pubsub instead of a DHT for this prototype pass.
 *
 * NOTE on the WebSocket transport: added alongside (not instead of) TCP so this same
 * node can accept connections from a browser/webview peer later (raw TCP sockets aren't
 * available there) - see the project plan for the PWA/mobile/desktop UI work this is
 * laying the groundwork for. The CLI demo still dials over TCP; the WS listener is
 * additive and unused by it today.
 */
export async function createHelixNode(opts: { port: number; privateKey: Ed25519PrivateKey }) {
  // port 0 means "OS-assigned" (used throughout the test suite) - each listen address
  // gets its own independently OS-assigned port in that case, rather than colliding on
  // a fixed +1 offset that only makes sense for the CLI's explicit port numbers.
  const wsPort = opts.port === 0 ? 0 : opts.port + 1;
  return createLibp2p({
    privateKey: opts.privateKey,
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${opts.port}`, `/ip4/0.0.0.0/tcp/${wsPort}/ws`],
    },
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
export type { GossipSub, Identify };
