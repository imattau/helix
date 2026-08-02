import { randomUUID } from 'node:crypto';
import { to_base4, from_base4 } from '../math/base4.js';
import { calculate_entropy } from '../math/entropy.js';
import { calculate_linking_number } from '../math/linking.js';
import { gf4Checksum } from '../math/gf4.js';
import { sha256 } from '../crypto/hash.js';
import { computeMerkleRoot } from '../store/merkle.js';
import { toHex, fromHex } from '../crypto/hex.js';
import { TOPICS } from '../node/pubsubTopics.js';
import { encodePost } from '../node/messages.js';
import type { HelixNode } from '../node/createNode.js';
import type { HelixStore } from '../store/memoryStore.js';
import type { HybridLogicalClock } from '../clock/hlc.js';
import type { Helix } from '../types/index.js';

/** Anti-spam gate: posts with less character-distribution diversity than this are rejected. */
export const ENTROPY_THRESHOLD = 2.5;
/** A TAD closes (freezes) once it reaches this many posts. */
export const TAD_SIZE = 10;

export class SpamRejectedError extends Error {
  constructor(entropy: number) {
    super(`Content entropy too low (${entropy.toFixed(2)} < ${ENTROPY_THRESHOLD}). Please diversify your posting style.`);
    this.name = 'SpamRejectedError';
  }
}

export interface CreatePostOptions {
  authorGenome: string;
  content: string;
  parentPostId?: string;
}

export async function createPost(
  node: HelixNode,
  store: HelixStore,
  hlcClock: HybridLogicalClock,
  opts: CreatePostOptions,
): Promise<Helix> {
  const entropy = calculate_entropy(opts.content);
  if (entropy < ENTROPY_THRESHOLD) {
    throw new SpamRejectedError(entropy);
  }

  const contentHash = sha256(new TextEncoder().encode(opts.content));
  const contentHashBase4 = to_base4(contentHash);
  const checksum = gf4Checksum(contentHashBase4);

  let writhe = 0;
  let parent: Helix | undefined;
  if (opts.parentPostId) {
    parent = store.getPost(opts.parentPostId);
    if (!parent) {
      throw new Error(`createPost: parent post ${opts.parentPostId} not found`);
    }
    writhe = parent.writhe + 1;
  }

  // causalParents records what the author knew about at creation time: their own
  // previous post (their local clock is already monotonic w.r.t. it, so it needs no
  // HLC merge) plus a reply's parent (merged below, since it may be from another peer).
  const authorLastPost = store.getLatestPostForGenome(opts.authorGenome);
  const causalParents = [...new Set([authorLastPost?.postId, opts.parentPostId].filter((id): id is string => id !== undefined))];
  const hlcTimestamp = parent ? hlcClock.update(parent.hlcTimestamp) : hlcClock.now();

  let tad = store.getOpenTad(opts.authorGenome);
  if (!tad) {
    tad = store.createTad(opts.authorGenome);
  }

  const twist = tad.posts.length;

  const post: Helix = {
    postId: randomUUID(),
    genome: opts.authorGenome,
    content: opts.content,
    parentPostId: opts.parentPostId,
    twist,
    writhe,
    linkingNumber: calculate_linking_number({ postsInTad: twist + 1, totalReplyDepth: writhe }),
    entropy,
    contentHashBase4,
    gf4Checksum: checksum,
    hlcTimestamp,
    causalParents,
  };

  tad.posts.push(post);
  tad.merkleRootHex = toHex(computeMerkleRoot(tad.posts.map((p) => from_base4(p.contentHashBase4))));
  if (tad.posts.length >= TAD_SIZE) {
    tad.closed = true;
    tad.mmrLeafIndex = store.getOrCreateMmr(opts.authorGenome).append(fromHex(tad.merkleRootHex));
  }
  store.savePost(post, tad);

  await node.services.pubsub.publish(TOPICS.POSTS, encodePost(post));

  return post;
}
