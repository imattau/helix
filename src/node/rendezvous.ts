import { CID } from 'multiformats-v13/cid';
import { sha256 } from 'multiformats-v13/hashes/sha2';
import * as raw from 'multiformats-v13/codecs/raw';
import { multiaddr } from '@multiformats/multiaddr';
import type { PeerInfo } from '@libp2p/interface';
import { PUBLIC_IPFS_BOOTSTRAP_PEERS, type HelixNode } from './createNode.js';

/**
 * Fixed rendezvous point for finding other Helix peers over the public IPFS/libp2p
 * DHT (see createNode.ts's `dht` service) - the same pattern IPFS content discovery
 * uses, just with a well-known fixed "content" key instead of real file content.
 * Any Helix node can `announceRendezvous()` to tell the DHT it's reachable, and
 * `discoverRendezvousPeers()` to find everyone else who has, without needing a
 * shared bootstrap peer of its own.
 *
 * Imports from the `multiformats-v13` alias (see package.json), not the top-level
 * `multiformats` (v14, used by the Helia/v3 stack) - @libp2p/kad-dht is pinned to
 * the last @libp2p/interface-v2-compatible line (v15.x, see createNode.ts's DHT
 * comment) and expects multiformats v13's CID class specifically.
 */
async function rendezvousCid(): Promise<CID> {
  const bytes = new TextEncoder().encode('helix-v1-rendezvous');
  const hash = await sha256.digest(bytes);
  return CID.createV1(raw.code, hash);
}

/** Announces this node as a Helix peer on the public DHT. */
export async function announceRendezvous(node: HelixNode, signal?: AbortSignal): Promise<void> {
  const cid = await rendezvousCid();
  await node.contentRouting.provide(cid, { signal });
}

/** Finds other Helix peers that have called announceRendezvous(). */
export async function discoverRendezvousPeers(node: HelixNode, signal?: AbortSignal): Promise<PeerInfo[]> {
  const cid = await rendezvousCid();
  const found: PeerInfo[] = [];
  for await (const peer of node.contentRouting.findProviders(cid, { signal })) {
    found.push(peer);
  }
  return found;
}

/**
 * The full public-discovery flow: dial into the public DHT, announce, find other
 * Helix peers, and dial them. Registering the public bootstrap peers as a
 * `peerDiscovery` source (see createNode.ts) only makes libp2p aware they exist -
 * it does not connect to them, and kad-dht refuses to run a query
 * (`allowQueryWithZeroPeers` defaults to false) until its routing table has at
 * least one peer in it. So this dials them explicitly first, same as the existing
 * hardcoded-bootstrap dial callers already do.
 *
 * Best-effort throughout: any individual dial or the DHT query itself failing
 * (no internet access, the public swarm being unreachable, etc.) is swallowed -
 * callers get whatever peers were actually found, or none. Real Kademlia `provide`/
 * `findProviders` queries are genuinely slow (iterative multi-hop lookups against
 * a network you've just cold-connected to, sometimes minutes) - bounded to
 * `budgetMs` total so a caller that awaits this can't be blocked indefinitely by
 * public-network conditions outside anyone's control.
 */
export async function connectPublicDiscovery(node: HelixNode, budgetMs = 30_000): Promise<PeerInfo[]> {
  const signal = AbortSignal.timeout(budgetMs);

  await Promise.allSettled(PUBLIC_IPFS_BOOTSTRAP_PEERS.map((addr) => node.dial(multiaddr(addr), { signal })));

  try {
    await announceRendezvous(node, signal);
    const peers = await discoverRendezvousPeers(node, signal);
    const others = peers.filter((peer) => peer.id.toString() !== node.peerId.toString());
    await Promise.allSettled(others.map((peer) => node.dial(peer.id, { signal })));
    return others;
  } catch {
    return [];
  }
}
