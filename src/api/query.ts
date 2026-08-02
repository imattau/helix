import { to_base4, from_base4 } from '../math/base4.js';
import { computePostContentHash } from '../crypto/postHash.js';
import { fromHex } from '../crypto/hex.js';
import { computeMerkleProof, verifyMerkleProof, type MerkleProofStep } from '../store/merkle.js';
import { MerkleMountainRange, type MMRPeak, type MMRProof, type MMRSyncState } from '../store/mmr.js';
import { TAD_SIZE } from './createPost.js';
import type { HelixStore } from '../store/memoryStore.js';
import type { Helix } from '../types/index.js';

/** GET /post/{index} equivalent: looks up a post by its global (TAD-spanning) index. */
export function getPostByIndex(store: HelixStore, genome: string, globalIndex: number): Helix {
  const tadIndex = Math.floor(globalIndex / TAD_SIZE);
  const localIndex = globalIndex % TAD_SIZE;

  const tad = store.getClosedTad(genome, tadIndex) ?? store.getOpenTad(genome);
  const post = tad?.posts[localIndex];
  if (!post) {
    throw new Error(`getPostByIndex: no post at global index ${globalIndex} for genome ${genome}`);
  }
  return post;
}

/** GET /sync equivalent: the O(log N)-sized payload a remote peer needs to sync. */
export function getSyncState(store: HelixStore, genome: string): MMRSyncState {
  return store.getOrCreateMmr(genome).getSyncState();
}

export interface PostMerkleProof {
  post: Helix;
  tadMerkleRootHex: string;
  /** Proves the post is one of its TAD's leaves. */
  tadProof: MerkleProofStep[];
  /** Proves that TAD's root is under one of the genome's current MMR peaks. */
  mmrProof: MMRProof;
}

/** Builds the two-level proof (intra-TAD + MMR) for a post in an already-closed TAD. */
export function getMerkleProof(store: HelixStore, genome: string, globalIndex: number): PostMerkleProof {
  const tadIndex = Math.floor(globalIndex / TAD_SIZE);
  const localIndex = globalIndex % TAD_SIZE;

  const tad = store.getClosedTad(genome, tadIndex);
  if (!tad) {
    throw new Error(`getMerkleProof: TAD ${tadIndex} for genome ${genome} is not closed yet - not provable via the MMR`);
  }
  const post = tad.posts[localIndex];
  if (!post) {
    throw new Error(`getMerkleProof: no post at local index ${localIndex} in TAD ${tadIndex}`);
  }
  if (tad.mmrLeafIndex === undefined) {
    throw new Error(`getMerkleProof: TAD ${tadIndex} has no MMR leaf index (should not happen for a closed TAD)`);
  }

  const tadLeaves = tad.posts.map((p) => from_base4(p.contentHashBase4));
  const tadProof = computeMerkleProof(tadLeaves, localIndex);
  const mmrProof = store.getOrCreateMmr(genome).getProof(tad.mmrLeafIndex);

  return { post, tadMerkleRootHex: tad.merkleRootHex, tadProof, mmrProof };
}

/**
 * Pure verification: recomputes the post's content hash and checks both proof legs
 * against the caller's own `peaks` (e.g. from a `getSyncState()` a peer already trusts).
 * No store access - a peer can run this having only received the post, its proof, and
 * a sync state over the wire.
 */
export function verifyPost(
  post: Helix,
  tadMerkleRootHex: string,
  tadProof: MerkleProofStep[],
  mmrProof: MMRProof,
  peaks: readonly MMRPeak[],
): boolean {
  const recomputedHashBase4 = to_base4(computePostContentHash(post.content, post.attachment));
  if (recomputedHashBase4 !== post.contentHashBase4) return false;

  const leafBytes = from_base4(post.contentHashBase4);
  if (!verifyMerkleProof(leafBytes, tadProof, tadMerkleRootHex)) return false;

  return MerkleMountainRange.verifyProof(fromHex(tadMerkleRootHex), mmrProof, peaks);
}
