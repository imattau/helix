import { createHeliaLight, type Helia } from 'helia';
import { withHTTP } from '@helia/http';
import { withLibp2p, libp2pDefaults, type HeliaWithLibp2p, type DefaultLibp2pServices, type CreateLibp2pOptions } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import * as dagCbor from '@ipld/dag-cbor';
import * as dagJson from '@ipld/dag-json';
import * as json from 'multiformats/codecs/json';
import { sha512 } from 'multiformats/hashes/sha2';
import { MemoryBlockstore } from 'blockstore-core';
import { MemoryDatastore } from 'datastore-core';
import type { HeliaInit } from 'helia';

/** createHelia()'s declared return type doesn't reflect that it's always libp2p-backed internally - see @helia/libp2p's HeliaWithLibp2p. */
export type IpfsNode = Helia & HeliaWithLibp2p;

/**
 * A Helia (real IPFS) node, fully independent from the Helix gossipsub node in
 * src/node/createNode.ts. Helia requires @libp2p/interface v3; our Helix node is
 * pinned to v2 for gossipsub compatibility - the two can't share a libp2p instance
 * (see the project plan for the full explanation), so this is its own node with its
 * own identity. Only CIDs and raw bytes ever cross between the two subsystems, never
 * libp2p objects, so the version difference never needs reconciling.
 *
 * Storage is in-memory (MemoryBlockstore/MemoryDatastore), matching this project's
 * existing no-persistence philosophy - nothing survives process restart.
 *
 * IMPORTANT: this deliberately does NOT use the top-level `createHelia()` helper.
 * `createHelia()` hardcodes its own default libp2p config with no way to override
 * it (its internal `withLibp2p(builder)` call passes no options), and that default
 * enables ~8 public-network services (bootstrap peer discovery, a full Kademlia DHT
 * client, autoNAT, autoTLS, dcutr, UPnP, two delegated-routing HTTP clients, a
 * circuit relay server) - all aimed at joining the public IPFS network. This project
 * never does that: peers only ever `dial()` a specific multiaddr learned via the
 * `IPFS_ADDR` gossipsub signal (see src/cli/peer.ts), never DHT/bootstrap-based
 * discovery. Left at those defaults, the unused services spend the whole process
 * lifetime retrying unreachable public bootstrap/DHT/delegated-routing endpoints -
 * confirmed by isolating createHelia() in a standalone script with zero peers/
 * connections and watching RSS grow ~1GB/minute from that alone, which is what
 * actually caused `npm run peer:a` to OOM-crash after being left running. Instead,
 * this replicates createHelia()'s own composition recipe (createHeliaLight + withHTTP
 * + withLibp2p + withBitswap, same codecs/hashers - see helia's own src/index.js) but
 * starts from `libp2pDefaults()` (also re-exported by @helia/libp2p) and strips
 * `peerDiscovery` down to none and `services` down to just `identify` - reusing
 * Helia's own correctly version-matched transport/encrypter/muxer instances rather
 * than importing our own (this project's Helix node is pinned to @libp2p/interface
 * v2 for gossipsub compatibility while Helia needs v3 - see the class doc comment
 * above - so importing tcp()/webSockets()/etc. ourselves here would silently resolve
 * to the wrong major version and fail to typecheck against Helia's own types).
 */
export async function createIpfsNode(opts: {
  /** A stable Ed25519 keypair, so this node's PeerId survives restarts instead of a
   *  fresh random one every time - lets other peers recognize "the same IPFS peer"
   *  across sessions (matters once reseeding makes more than one peer worth
   *  recognizing - see app/src/backend/ipfsPersistence.ts). Cast past the structural
   *  mismatch with Helia's own nested @libp2p/interface v3 typing (same reasoning as
   *  the libp2pOptions cast below) - the underlying Ed25519PrivateKey shape is
   *  identical across both. Defaults to a fresh random key (this function's original
   *  behavior) when omitted, matching the CLI/test usage that has no need to persist
   *  one. */
  privateKey?: unknown;
  /** Durable block storage, so bytes this node has published or fetched (and reseeds -
   *  see fetchAndVerifyAttachmentFromIpfs) survive a restart instead of vanishing with
   *  the in-memory default. Typed `unknown` - our top-level interface-blockstore
   *  resolves to a different (structurally identical but nominally distinct,
   *  private-field-branded) copy than the one nested under
   *  @helia/libp2p/@ipshipyard/keychain, same class of cross-version mismatch as the
   *  libp2pOptions cast below. */
  blockstore?: unknown;
  /** Durable libp2p/keychain bookkeeping to match `blockstore` - otherwise unrelated to
   *  attachment bytes themselves. Typed `unknown` for the same reason as blockstore. */
  datastore?: unknown;
  /** Additional transport factories beyond Helia's own defaults (webSockets, etc.) -
   *  see app/src/backend/webrtcTransport.ts, which lets a Tauri app's Helia node
   *  actually accept inbound connections (a plain browser tab, and Helia's own
   *  defaults alone, never can). Typed `unknown[]` for the same cross-version reason
   *  as blockstore/datastore above. */
  extraTransports?: unknown[];
  /** Multiaddrs to listen on beyond Helia's defaults (none, by default - see the class
   *  doc comment) - paired with extraTransports, since a transport with nothing to
   *  listen on never gets its createListener() called at all. */
  listenAddresses?: string[];
} = {}): Promise<IpfsNode> {
  const base = createHeliaLight({
    blockstore: opts.blockstore ?? new MemoryBlockstore(),
    datastore: opts.datastore ?? new MemoryDatastore(),
    codecs: [dagCbor, dagJson, json],
    hashers: [sha512],
  } as unknown as HeliaInit);
  const defaults = libp2pDefaults();
  // Narrower than DefaultLibp2pServices by design (see doc comment above) - cast past
  // the structural mismatch rather than fabricate stub factories for services we
  // deliberately dropped.
  const libp2pOptions = {
    ...defaults,
    privateKey: opts.privateKey ?? defaults.privateKey,
    peerDiscovery: [],
    services: { identify: defaults.services.identify },
    transports: [...(defaults.transports ?? []), ...(opts.extraTransports ?? [])],
    // Explicit key present only when actually overriding - `addresses: undefined`
    // would otherwise stomp defaults.addresses entirely (object spread doesn't skip
    // an explicitly-assigned undefined value), silently dropping every default listen
    // address (including the CLI/test-only default loopback TCP one) for every
    // caller that didn't pass listenAddresses.
    ...(opts.listenAddresses ? { addresses: { listen: opts.listenAddresses } } : {}),
  } as unknown as CreateLibp2pOptions<DefaultLibp2pServices>;
  const withNetworking = withLibp2p(withHTTP(base), libp2pOptions);
  const helia = withBitswap(withNetworking as unknown as HeliaWithLibp2p<DefaultLibp2pServices>) as unknown as IpfsNode;
  await helia.start(); // createHelia() does not start the node itself - .libp2p is unusable until this runs
  return helia;
}
