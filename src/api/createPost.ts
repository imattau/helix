import { to_base4, from_base4 } from '../math/base4.js';
import { calculate_entropy } from '../math/entropy.js';
import { calculate_linking_number } from '../math/linking.js';
import { gf4Checksum } from '../math/gf4.js';
import { sha256 } from '../crypto/hash.js';
import { computePostContentHash } from '../crypto/postHash.js';
import { computeMerkleRoot } from '../store/merkle.js';
import { toHex, fromHex } from '../crypto/hex.js';
import { TOPICS } from '../node/pubsubTopics.js';
import { encodePost } from '../node/messages.js';
import type { HelixNode } from '../node/createNode.js';
import type { HelixStore } from '../store/memoryStore.js';
import type { HybridLogicalClock } from '../clock/hlc.js';
import type { Attachment, Helix, HelixKind } from '../types/index.js';

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
  /** Media/long-form content hosted outside the gossiped post - see src/api/attachment.ts.
   * `ipfsCid` is opt-in and passed through as-is if the caller already published to IPFS
   * themselves (createPost stays IPFS-unaware, same as it never validates sourceUrl). */
  attachment?: { bytes: Uint8Array; mimeType: string; sourceUrl: string; ipfsCid?: string };
  /** "Edit" an earlier post by the same author - see the recombination handling below.
   * Mutually exclusive with `parentPostId`: the new post's position (parentPostId/writhe)
   * is derived from the target post being recombined, not chosen by the caller. */
  recombinesPostId?: string;
  /** Defaults to 'post'. Ignored (inherited from the target instead) when recombining -
   * a recombination replaces the content of the same kind of record, it can't change
   * what a post *is*. See src/types/index.ts's HelixKind doc comment. */
  kind?: HelixKind;
}

export async function createPost(
  node: HelixNode,
  store: HelixStore,
  hlcClock: HybridLogicalClock,
  opts: CreatePostOptions,
): Promise<Helix> {
  if (opts.recombinesPostId && opts.parentPostId) {
    throw new Error('createPost: recombinesPostId and parentPostId are mutually exclusive');
  }

  // Recombination ("edit"): a new post that supersedes an earlier one by the same
  // author. The original is never mutated - once its TAD closes, its Merkle root is
  // folded into the MMR and every proof issued against it depends on the content never
  // changing (see src/api/query.ts). Readers follow `recombinesPostId` forward instead.
  let recombinationTarget: Helix | undefined;
  if (opts.recombinesPostId) {
    recombinationTarget = store.getPost(opts.recombinesPostId);
    if (!recombinationTarget) {
      throw new Error(`createPost: recombination target ${opts.recombinesPostId} not found`);
    }
    if (recombinationTarget.genome !== opts.authorGenome) {
      throw new Error('createPost: cannot recombine a post authored by a different genome');
    }
    if (store.isSuperseded(opts.recombinesPostId)) {
      throw new Error(`createPost: ${opts.recombinesPostId} has already been recombined - one linear edit chain per post`);
    }
  }

  // A recombination can't change what a post *is* - kind always follows the target.
  const kind: HelixKind = recombinationTarget?.kind ?? opts.kind ?? 'post';

  // When recombining, the target (a previously-valid like/boost) already has a
  // parentPostId that gets inherited below regardless of what the caller passes -
  // only a brand-new like/boost needs this check.
  if (!recombinationTarget && (kind === 'like' || kind === 'boost') && !opts.parentPostId) {
    throw new Error(`createPost: kind '${kind}' requires parentPostId (what it targets)`);
  }

  // The character-diversity spam gate is meant for authored text - a like/boost has no
  // content at all, and a profile post's content is a small JSON blob, neither of which
  // should be judged as "spam" by that heuristic.
  const entropy = kind === 'post' ? calculate_entropy(opts.content) : 0;
  if (kind === 'post' && entropy < ENTROPY_THRESHOLD) {
    throw new SpamRejectedError(entropy);
  }

  // hash/size are always computed from the actual bytes, never trusted from the caller -
  // matching every other hash in this codebase
  const attachment: Attachment | undefined = opts.attachment && {
    hashHex: toHex(sha256(opts.attachment.bytes)),
    mimeType: opts.attachment.mimeType,
    sizeBytes: opts.attachment.bytes.length,
    sourceUrl: opts.attachment.sourceUrl,
    ipfsCid: opts.attachment.ipfsCid,
  };

  const contentHash = computePostContentHash(opts.content, attachment);
  const contentHashBase4 = to_base4(contentHash);
  const checksum = gf4Checksum(contentHashBase4);

  let writhe = 0;
  let parentPostId = opts.parentPostId;
  let parent: Helix | undefined;
  if (recombinationTarget) {
    // Continuity, not reply depth: a recombination replaces a tree node in place
    // rather than adding a new one, so it inherits the target's position/writhe.
    parentPostId = recombinationTarget.parentPostId;
    writhe = recombinationTarget.writhe;
  } else if (opts.parentPostId) {
    parent = store.getPost(opts.parentPostId);
    if (!parent) {
      throw new Error(`createPost: parent post ${opts.parentPostId} not found`);
    }
    // "Reply tree depth" isn't a meaningful concept for a like/boost - only real
    // replies (kind 'post') deepen writhe; likes/boosts just reference their target.
    if (kind === 'post') writhe = parent.writhe + 1;
  }

  // causalParents records what the author knew about at creation time: their own
  // previous post (their local clock is already monotonic w.r.t. it, so it needs no
  // HLC merge), plus a reply's parent or a recombination's target (merged below,
  // since either may be from another peer).
  const authorLastPost = store.getLatestPostForGenome(opts.authorGenome);
  const causalParents = [
    ...new Set(
      [authorLastPost?.postId, opts.parentPostId, opts.recombinesPostId].filter((id): id is string => id !== undefined),
    ),
  ];
  const causalPost = parent ?? recombinationTarget;
  const hlcTimestamp = causalPost ? hlcClock.update(causalPost.hlcTimestamp) : hlcClock.now();

  let tad = store.getOpenTad(opts.authorGenome);
  if (!tad) {
    tad = store.createTad(opts.authorGenome);
  }

  const twist = tad.posts.length;

  const post: Helix = {
    postId: globalThis.crypto.randomUUID(),
    genome: opts.authorGenome,
    content: opts.content,
    kind,
    parentPostId,
    twist,
    writhe,
    linkingNumber: calculate_linking_number({ postsInTad: twist + 1, totalReplyDepth: writhe }),
    entropy,
    contentHashBase4,
    gf4Checksum: checksum,
    hlcTimestamp,
    causalParents,
    attachment,
    recombinesPostId: opts.recombinesPostId,
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
