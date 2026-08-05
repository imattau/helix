import { to_base4 } from '../math/base4.js';
import { computePostContentHash } from '../crypto/postHash.js';
import { ingestPost, PostRejectedError } from '../api/ingestPost.js';
import { acceptVerifiedGenome } from '../api/registerUser.js';
import { peerIdFromString } from '@libp2p/peer-id';
import type { HelixNode } from './createNode.js';
import type { HelixStore } from '../store/memoryStore.js';
import type { Genome, Helix } from '../types/index.js';
import type { Stream } from '@libp2p/interface';

/**
 * Directory sync: a way for a peer to learn about the rest of the network's users
 * beyond what happens to be broadcast live on gossipsub while it's connected.
 * Two complementary mechanisms share one payload shape:
 *
 *  1. Request-response over `/helix/directory/1.0.0` (libp2p stream protocol): a peer
 *     asks a connected peer "which genomes (and their recent posts) do you know?" and
 *     verifies every entry locally before saving it - the same "recompute, don't
 *     trust" posture as genesis ingest.
 *  2. Periodic `helix-directory` gossipsub broadcasts: capped snapshots so peers
 *     passively accumulate directory data without having to know whom to ask.
 *
 * Every entry is independently validated on receipt (PoW for genomes, the full
 * ingestPost invariant set for posts), so a malicious responder can only waste a
 * little local CPU, never inject unverified data. Payloads are capped on both the
 * responder side and the requester side.
 */

export const DIRECTORY_PROTOCOL = '/helix/directory/1.0.0';

/** Cap on genomes per directory response/broadcast. */
export const DIRECTORY_MAX_GENOMES = 500;
/** Cap on recent posts carried per genome. */
export const DIRECTORY_RECENT_POSTS_PER_GENOME = 20;
/** Broadcast snapshot size - smaller than a request response since it hits every mesh peer. */
export const DIRECTORY_BROADCAST_MAX_GENOMES = 100;
export const DIRECTORY_BROADCAST_POSTS_PER_GENOME = 5;
/** How often a peer re-announces its directory on the `helix-directory` topic. */
export const DIRECTORY_BROADCAST_INTERVAL_MS = 60_000;

export interface DirectoryRequest {
  limit?: number;
  recentPostsPerGenome?: number;
}

export interface DirectoryEntry {
  genome: Genome;
  recentPosts: Helix[];
  /** Self-reported dialable addresses for this genome's peerId (see
   *  TOPICS.PEER_ADDR/messages.ts's PeerAddrMessage) - `[]` when the server has none
   *  on file, not just for peers on old builds that predate this field. Only ever
   *  populated by a server that's actually tracking these (currently just the relay -
   *  see relay.ts); a regular peer's own buildDirectorySnapshot() call always emits
   *  `[]` here, and ingestDirectory() doesn't do anything with a nonempty one yet -
   *  there's no HelixStore slot for "other peers' addresses" (out of scope for this
   *  pass, which only needed the relay to serve them). */
  multiaddrs: string[];
}

export interface DirectorySnapshot {
  entries: DirectoryEntry[];
}

/** Wire form of a directory post omits `contentHashBase4` - recomputed on decode, like decodePost. */
type WirePost = Omit<Helix, 'contentHashBase4'>;

export function encodeDirectory(snapshot: DirectorySnapshot): Uint8Array {
  const wire = {
    entries: snapshot.entries.map((entry) => ({
      genome: entry.genome,
      recentPosts: entry.recentPosts.map((post) => {
        const { contentHashBase4: _contentHashBase4, ...rest } = post;
        return rest as WirePost;
      }),
      multiaddrs: entry.multiaddrs,
    })),
  };
  return new TextEncoder().encode(JSON.stringify(wire));
}

export function decodeDirectory(data: Uint8Array): DirectorySnapshot {
  const wire = JSON.parse(new TextDecoder().decode(data)) as {
    entries: { genome: Genome; recentPosts: WirePost[]; multiaddrs?: string[] }[];
  };
  return {
    entries: wire.entries.map((entry) => ({
      genome: entry.genome,
      recentPosts: entry.recentPosts.map((post) => ({
        ...post,
        contentHashBase4: to_base4(computePostContentHash(post.content, post.attachment)),
      })),
      // Optional on decode - a sender on a build older than this field omits it entirely.
      multiaddrs: entry.multiaddrs ?? [],
    })),
  };
}

function clampLimit(value: number | undefined, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), max));
}

/** Builds a directory snapshot from the local store: current-version posts only,
 *  in twist order so a receiver's ingest walks the same append-only TAD sequence.
 *  `getMultiaddrs`, if given, looks up self-reported dialable addresses per genome's
 *  peerId (see DirectoryEntry.multiaddrs's doc comment) - omitted entirely by callers
 *  that don't track any (i.e. everyone except the relay today), which is equivalent
 *  to every entry getting `[]`. */
export function buildDirectorySnapshot(
  store: HelixStore,
  req: DirectoryRequest = {},
  getMultiaddrs?: (peerId: string) => string[] | undefined,
): DirectorySnapshot {
  const limit = clampLimit(req.limit, DIRECTORY_MAX_GENOMES, DIRECTORY_MAX_GENOMES);
  const perGenome = clampLimit(req.recentPostsPerGenome, DIRECTORY_RECENT_POSTS_PER_GENOME, DIRECTORY_RECENT_POSTS_PER_GENOME);

  const entries: DirectoryEntry[] = [];
  for (const genome of store.getKnownGenomes()) {
    if (entries.length >= limit) break;
    const currentPosts = store
      .getPostsByGenome(genome.genome)
      .filter((post) => !store.isSuperseded(post.postId))
      .sort((a, b) => a.twist - b.twist);
    entries.push({
      genome,
      recentPosts: currentPosts.slice(-perGenome),
      multiaddrs: getMultiaddrs?.(genome.peerId) ?? [],
    });
  }
  return { entries };
}

/**
 * Verifies and persists every genome and post in a snapshot. Genomes that fail PoW
 * are skipped entirely (their posts can't be validated against a known author
 * anyway); individual posts that fail ingest validation are dropped without
 * aborting the rest - a partial directory is still useful.
 */
export function ingestDirectory(
  store: HelixStore,
  snapshot: DirectorySnapshot,
): { genomesAccepted: number; postsAccepted: number } {
  let genomesAccepted = 0;
  let postsAccepted = 0;

  for (const entry of snapshot.entries) {
    if (!acceptVerifiedGenome(store, entry.genome)) continue;
    genomesAccepted += 1;
    for (const post of entry.recentPosts) {
      if (store.getPost(post.postId)) {
        postsAccepted += 1;
        continue;
      }
      try {
        ingestPost(store, post);
        postsAccepted += 1;
      } catch (err) {
        if (err instanceof PostRejectedError) continue;
        throw err;
      }
    }
  }

  return { genomesAccepted, postsAccepted };
}

async function readAll(stream: Stream, maxBytes = 1 << 20): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream.source) {
    const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray();
    total += bytes.length;
    if (total > maxBytes) throw new Error(`directory stream exceeded ${maxBytes} bytes`);
    chunks.push(bytes);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Serves directory requests over `/helix/directory/1.0.0`. `getMultiaddrs` is
 *  forwarded to buildDirectorySnapshot() - see its doc comment. */
export function registerDirectoryHandler(
  node: HelixNode,
  store: HelixStore,
  getMultiaddrs?: (peerId: string) => string[] | undefined,
): void {
  node
    .handle(DIRECTORY_PROTOCOL, async ({ stream }) => {
      try {
        let req: DirectoryRequest = {};
        try {
          req = JSON.parse(new TextDecoder().decode(await readAll(stream, 1 << 16)));
        } catch {
          // unparseable/empty request - fall back to defaults
        }
        const snapshot = buildDirectorySnapshot(store, req, getMultiaddrs);
        await stream.sink([encodeDirectory(snapshot)]);
      } catch (err) {
        console.warn('[helix] directory handler failed', err instanceof Error ? err.message : err);
      } finally {
        await stream.close().catch(() => {});
      }
    })
    .catch((err) => {
      console.warn('[helix] failed to register directory handler', err instanceof Error ? err.message : err);
    });
}

type DialablePeer = Parameters<HelixNode['dialProtocol']>[0];

/** dialProtocol's param type doesn't include plain strings, but callers naturally have
 *  one (peerId.toString() from a peer:connect event) - normalize via peerIdFromString. */
export type DirectoryPeer = DialablePeer | string;

function toDialable(peer: DirectoryPeer): DialablePeer {
  return typeof peer === 'string' ? peerIdFromString(peer) : peer;
}

/** Requests a connected peer's directory. Best-effort at the call site. */
export async function requestDirectory(
  node: HelixNode,
  peer: DirectoryPeer,
  opts: DirectoryRequest = {},
  signal?: AbortSignal,
): Promise<DirectorySnapshot> {
  const stream = await node.dialProtocol(toDialable(peer), DIRECTORY_PROTOCOL, { signal });
  await stream.sink([new TextEncoder().encode(JSON.stringify(opts))]);
  await stream.closeWrite().catch(() => {});
  const bytes = await readAll(stream, 32 << 20);
  await stream.close().catch(() => {});
  return decodeDirectory(bytes);
}
