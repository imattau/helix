import { CID } from 'multiformats-v13/cid';
import { sha256 } from 'multiformats-v13/hashes/sha2';
import * as raw from 'multiformats-v13/codecs/raw';
import { multiaddr } from '@multiformats/multiaddr';
import type { PeerId, PeerInfo } from '@libp2p/interface';
import { PUBLIC_IPFS_BOOTSTRAP_PEERS, type HelixNode } from './createNode.js';
import { DIRECTORY_PROTOCOL } from './directory.js';

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

/** How many times announceAndVerifyRendezvous re-provides if the record doesn't come
 *  back on self-query - a cold routing table's iterative closest-peers lookup can
 *  converge on a different (wrong) peer set than a later query does, so a single
 *  provide() landing nowhere useful is expected often enough to need this. */
const ANNOUNCE_VERIFY_ATTEMPTS = 3;

/** Cap on a single provide() attempt within announceAndVerifyRendezvous. provide()'s
 *  own network propagation (sending ADD_PROVIDER to the k-closest peers) is the slow,
 *  frequently-stalling part of a provide() call and is genuinely best-effort here - but
 *  what verification actually depends on is the *local* provider-record write, which
 *  kad-dht performs synchronously as the very first step of provide(), before any
 *  network I/O. Traced directly against the public DHT: that local write lands
 *  immediately, while the subsequent network phase can run for 60s+ without
 *  completing. Capping each attempt short means a single stalled network phase can't
 *  consume the whole verify budget and starve every retry (and the self-query below,
 *  which checks the local write first) of a chance to run at all. */
const ANNOUNCE_ATTEMPT_MS = 20_000;

/**
 * Announces and then confirms the record actually reached a peer that will hand it
 * back - `provide()` resolving isn't proof of anything: it succeeds even when the
 * ADD_PROVIDER it sent landed on a peer store that will never be asked (out of the
 * true k-closest, unreachable, at capacity, etc.), which as observed in practice is
 * common enough to be the main reason two nodes starting discovery around the same
 * time fail to find each other while a query for pre-existing unrelated providers
 * still succeeds. Self-querying immediately after `provide()` and re-providing on a
 * miss catches that silently-lost case instead of assuming success.
 */
export async function announceAndVerifyRendezvous(node: HelixNode, signal?: AbortSignal): Promise<boolean> {
  for (let attempt = 0; attempt < ANNOUNCE_VERIFY_ATTEMPTS && !signal?.aborted; attempt++) {
    const attemptSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(ANNOUNCE_ATTEMPT_MS)])
      : AbortSignal.timeout(ANNOUNCE_ATTEMPT_MS);
    await announceRendezvous(node, attemptSignal).catch(() => {});
    if (signal?.aborted) return false;
    if (await selfIsProvider(node, signal)) return true;
  }
  return false;
}

/** Queries for the rendezvous CID and checks whether this node's own record came back. */
async function selfIsProvider(node: HelixNode, signal?: AbortSignal): Promise<boolean> {
  const cid = await rendezvousCid();
  const selfId = node.peerId.toString();
  const attemptSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(RENDEZVOUS_QUERY_ATTEMPT_MS)])
    : AbortSignal.timeout(RENDEZVOUS_QUERY_ATTEMPT_MS);
  try {
    for await (const peer of node.contentRouting.findProviders(cid, { signal: attemptSignal })) {
      if (peer.id.toString() === selfId) return true;
    }
  } catch {
    // aborted/timed out - treated as not-yet-verified, caller may retry
  }
  return false;
}

/** How long a single findProviders attempt may run before the query is retried. */
const RENDEZVOUS_QUERY_ATTEMPT_MS = 30_000;
/** How many findProviders attempts before a discovery pass gives up (bounded by the caller's signal). */
const RENDEZVOUS_QUERY_ATTEMPTS = 3;

/**
 * Finds other Helix peers that have called announceRendezvous(). A cold kad-dht
 * `findProviders` query in client mode frequently stalls - aborting after its timeout
 * without yielding anything - while a retry of the same query succeeds in seconds
 * (observed repeatedly against the public DHT). So each attempt is bounded and the
 * query is retried a few times, stopping as soon as anything was found; the caller's
 * signal still bounds the whole pass. Providers are de-duplicated across attempts.
 *
 * Note this returns *anyone* providing the rendezvous CID, not necessarily a real
 * Helix peer - the CID is just a hash of a public string, so anything else that
 * happens to provide it on the public DHT (another provider of the same fixed key,
 * a crawler that provides many CIDs indiscriminately) shows up here too. Callers that
 * intend to dial and trust these as Helix peers should filter through
 * `filterHelixPeers` first rather than treating this list as verified.
 */
export async function discoverRendezvousPeers(node: HelixNode, signal?: AbortSignal): Promise<PeerInfo[]> {
  const cid = await rendezvousCid();
  const found: PeerInfo[] = [];
  const seen = new Set<string>();

  for (let attempt = 0; attempt < RENDEZVOUS_QUERY_ATTEMPTS && !signal?.aborted; attempt++) {
    const attemptSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(RENDEZVOUS_QUERY_ATTEMPT_MS)])
      : AbortSignal.timeout(RENDEZVOUS_QUERY_ATTEMPT_MS);
    try {
      for await (const peer of node.contentRouting.findProviders(cid, { signal: attemptSignal })) {
        if (seen.has(peer.id.toString())) continue;
        seen.add(peer.id.toString());
        found.push(peer);
      }
    } catch {
      // attempt aborted/timed out - retry unless the caller budget is spent
    }
    if (found.length > 0) break;
  }

  return found;
}

/** How long to wait for identify to hand back a freshly-dialed peer's protocol list
 *  before giving up on verifying it as a real Helix peer. */
const HELIX_PEER_VERIFY_TIMEOUT_MS = 5_000;
const HELIX_PEER_VERIFY_POLL_MS = 250;

/** Whether a connected peer advertises the Helix directory protocol - the cheapest
 *  signal available that it's a real Helix node rather than an unrelated provider of
 *  the same fixed rendezvous CID (see discoverRendezvousPeers). identify runs
 *  automatically right after a connection is established, so the peerStore entry may
 *  not be populated yet the instant dial() resolves - poll briefly rather than
 *  checking once. */
async function isHelixPeer(node: HelixNode, peerId: PeerId, budgetMs = HELIX_PEER_VERIFY_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  do {
    try {
      const peer = await node.peerStore.get(peerId);
      if (peer.protocols.includes(DIRECTORY_PROTOCOL)) return true;
    } catch {
      // not yet in the peer store - fall through to the poll delay and retry
    }
    await new Promise((resolve) => setTimeout(resolve, HELIX_PEER_VERIFY_POLL_MS));
  } while (Date.now() < deadline);
  return false;
}

/**
 * Narrows a list of rendezvous-CID providers down to ones that actually speak Helix's
 * directory protocol, dialing each first if not already connected. Providers of a
 * fixed, guessable CID aren't otherwise verified in any way (see discoverRendezvousPeers)
 * - without this, the public swarm's ambient DHT crawlers and any other provider of the
 * same key would be dialed and treated as real Helix peers.
 */
export async function filterHelixPeers(node: HelixNode, peers: PeerInfo[], signal?: AbortSignal): Promise<PeerInfo[]> {
  const dialed = await Promise.allSettled(peers.map((peer) => node.dial(peer.id, { signal })));
  const verified: PeerInfo[] = [];
  for (let i = 0; i < peers.length; i++) {
    if (dialed[i].status !== 'fulfilled') continue;
    if (await isHelixPeer(node, peers[i].id)) verified.push(peers[i]);
  }
  return verified;
}

/**
 * The full public-discovery flow: dial into the public DHT, wait for the routing
 * table to warm, announce, find other Helix peers, and dial them. Registering the
 * public bootstrap peers as a `peerDiscovery` source (see createNode.ts) only makes
 * libp2p aware they exist - it does not connect to them, and kad-dht refuses to run
 * a query (`allowQueryWithZeroPeers` defaults to false) until its routing table has
 * at least one peer in it. So this dials them explicitly first, same as the existing
 * hardcoded-bootstrap dial callers already do.
 *
 * The routing-table wait before `announceRendezvous` matters: a `provide()` issued
 * against a genuinely empty table has no closest peers to send ADD_PROVIDER to, so it
 * silently no-ops. Empirically the table fills (via identify/peer exchange) tens of
 * seconds after the bootstrap dials connect, so the announce is gated on having at
 * least one peer rather than fired into the void. Because bootstrap dials themselves
 * are flaky (observed in practice), the warm-up is retried in rounds with a fresh dial
 * each round. A small-but-non-empty table is good enough to announce against - a
 * provide() then lands somewhere and becomes findable as records propagate and the
 * caller's periodic rediscovery re-announces - so the warm-up prefers a well-populated
 * table but never skips announcing entirely once any peer exists.
 *
 * Best-effort throughout: any individual dial or the DHT query itself failing
 * (no internet access, the public swarm being unreachable, etc.) is swallowed -
 * callers get whatever peers were actually found, or none. Real Kademlia `provide`/
 * `findProviders` queries are genuinely slow (iterative multi-hop lookups against
 * a network you've just cold-connected to, sometimes minutes) - bounded to
 * `budgetMs` total so a caller that awaits this can't be blocked indefinitely by
 * public-network conditions outside anyone's control.
 */
export async function connectPublicDiscovery(node: HelixNode, budgetMs = 180_000): Promise<PeerInfo[]> {
  const deadline = Date.now() + budgetMs;
  const remaining = (): number => Math.max(0, deadline - Date.now());

  // Dial the public bootstrap swarm to seed the DHT routing table. kad-dht refuses to
  // run queries with an empty table, so these dials are the prerequisite for everything.
  // The bootstrap dials are flaky in practice, so: if a round connects nothing, back off
  // briefly and re-dial rather than burning the warm budget polling a table that can't
  // grow; once any peer is connected the table fills quickly (via identify/peer
  // exchange), so then wait for it to reach MIN. Reserve the final 15s for the announce
  // + discovery query.
  while (remaining() > 15_000) {
    await Promise.allSettled(
      PUBLIC_IPFS_BOOTSTRAP_PEERS.map((addr) =>
        node.dial(multiaddr(addr), { signal: AbortSignal.timeout(Math.min(15_000, remaining())) }),
      ),
    );
    if (node.getPeers().length > 0) {
      if (await waitForRoutingTable(node, Math.min(15_000, remaining()))) break;
    } else {
      await new Promise((resolve) => setTimeout(resolve, Math.min(3_000, remaining())));
    }
  }

  // A provide() needs at least one peer to send ADD_PROVIDER to; without any, skip the
  // announce (it would no-op). Anything above zero is worth announcing against. Give the
  // announce its own bounded slice so a slow provide can't starve the discovery query.
  const tablePeers = routingTableSize(node);
  if (tablePeers === 0 || remaining() <= 0) return [];

  // Verified, not fire-and-forget: a provide() that resolves without error is not proof
  // it reached a peer that will actually be queried later (see announceAndVerifyRendezvous) -
  // that gap is the main reason two nodes starting discovery close together have been
  // observed finding pre-existing unrelated providers but not each other.
  await announceAndVerifyRendezvous(node, AbortSignal.timeout(Math.min(60_000, remaining()))).catch(() => false);
  if (remaining() <= 0) return [];

  const signal = AbortSignal.timeout(remaining());
  try {
    const peers = await discoverRendezvousPeers(node, signal);
    const others = peers.filter((peer) => peer.id.toString() !== node.peerId.toString());
    return await filterHelixPeers(node, others, signal);
  } catch {
    return [];
  }
}

/**
 * Preferred routing-table size before announcing. Not a hard gate - we announce with
 * any non-empty table if the budget runs out while warming - but when the network
 * cooperates this is the size at which a fresh client-mode node's Kademlia closest-
 * peers lookup converges, so the ADD_PROVIDER reaches peers authoritative for the key.
 */
const MIN_ROUTING_TABLE_PEERS = 16;
const ROUTING_TABLE_POLL_MS = 2_000;

function routingTableSize(node: HelixNode): number {
  try {
    const dht = (node.services as { dht?: { routingTable?: { size: number } } }).dht;
    if (dht?.routingTable !== undefined) return dht.routingTable.size;
  } catch {
    // fall through to the connected-peers proxy below
  }
  return node.getPeers().length;
}

/** Polls until the DHT routing table has enough peers or the budget runs out.
 *  Returns whether the threshold was reached. */
async function waitForRoutingTable(node: HelixNode, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (routingTableSize(node) >= MIN_ROUTING_TABLE_PEERS) return true;
    await new Promise((resolve) => setTimeout(resolve, ROUTING_TABLE_POLL_MS));
  }
  return false;
}
