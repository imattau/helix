import { to_base4, from_base4 } from '../math/base4.js';
import { calculate_entropy } from '../math/entropy.js';
import { calculate_linking_number } from '../math/linking.js';
import { gf4Checksum } from '../math/gf4.js';
import { computePostContentHash } from '../crypto/postHash.js';
import { computeMerkleRoot } from '../store/merkle.js';
import { toHex, fromHex } from '../crypto/hex.js';
import { ENTROPY_THRESHOLD, TAD_SIZE } from './createPost.js';
import type { HelixStore } from '../store/memoryStore.js';
import type { Helix, HelixKind } from '../types/index.js';

const KINDS = new Set<HelixKind>(['post', 'like', 'boost', 'profile']);

export class PostRejectedError extends Error {
  constructor(reason: string) {
    super(`post rejected: ${reason}`);
    this.name = 'PostRejectedError';
  }
}

function reject(reason: string): never {
  throw new PostRejectedError(reason);
}

function assertFiniteInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value)) reject(`${name} must be a safe integer`);
}

function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(`${name} must be a finite number`);
}

/**
 * Receiver-side equivalent of createPost's invariant checks. Accepted posts are folded
 * into the local MemoryStore so feed visibility, recombinations, reactions, profiles,
 * and MMR state all derive from the same append-only log for local and remote posts.
 */
export function ingestPost(store: HelixStore, post: Helix): Helix {
  if (store.getPost(post.postId)) return post;

  if (typeof post.postId !== 'string' || post.postId.length === 0) reject('missing postId');
  if (typeof post.genome !== 'string' || !store.hasGenome(post.genome)) reject(`unknown author genome ${post.genome}`);
  if (!KINDS.has(post.kind)) reject(`unknown kind ${String(post.kind)}`);
  if (typeof post.content !== 'string') reject('content must be a string');

  assertFiniteInteger(post.twist, 'twist');
  assertFiniteInteger(post.writhe, 'writhe');
  assertFiniteInteger(post.linkingNumber, 'linkingNumber');
  if (post.twist < 0 || post.writhe < 0) reject('twist/writhe cannot be negative');
  assertFiniteNumber(post.entropy, 'entropy');

  if (!post.hlcTimestamp || typeof post.hlcTimestamp !== 'object') reject('missing HLC timestamp');
  assertFiniteInteger(post.hlcTimestamp.physical, 'hlcTimestamp.physical');
  assertFiniteInteger(post.hlcTimestamp.logical, 'hlcTimestamp.logical');
  if (post.hlcTimestamp.physical < 0 || post.hlcTimestamp.logical < 0) reject('HLC values cannot be negative');
  if (typeof post.hlcTimestamp.peerId !== 'string' || post.hlcTimestamp.peerId.length === 0) {
    reject('hlcTimestamp.peerId must be a string');
  }
  if (!Array.isArray(post.causalParents) || post.causalParents.some((id) => typeof id !== 'string')) {
    reject('causalParents must be a string array');
  }

  const expectedContentHashBase4 = to_base4(computePostContentHash(post.content, post.attachment));
  if (post.contentHashBase4 !== expectedContentHashBase4) reject('content hash mismatch');
  if (post.gf4Checksum !== gf4Checksum(post.contentHashBase4)) reject('GF(4) checksum mismatch');

  const expectedEntropy = post.kind === 'post' ? calculate_entropy(post.content) : 0;
  if (Math.abs(post.entropy - expectedEntropy) > 1e-9) reject('entropy mismatch');
  if (post.kind === 'post' && post.entropy < ENTROPY_THRESHOLD) reject('content entropy below threshold');

  let expectedParentPostId = post.parentPostId;
  let expectedWrithe = 0;
  let causalPost: Helix | undefined;

  if (post.recombinesPostId) {
    const target = store.getPost(post.recombinesPostId);
    if (!target) reject(`unknown recombination target ${post.recombinesPostId}`);
    if (target.genome !== post.genome) reject('recombination target belongs to another genome');
    if (store.isSuperseded(post.recombinesPostId)) reject('recombination target is already superseded');
    if (post.kind !== target.kind) reject('recombination changed kind');
    expectedParentPostId = target.parentPostId;
    expectedWrithe = target.writhe;
    causalPost = target;
  } else if (post.kind === 'like' || post.kind === 'boost') {
    if (!post.parentPostId) reject(`kind '${post.kind}' requires parentPostId`);
  }

  if (!post.recombinesPostId && post.parentPostId) {
    const parent = store.getPost(post.parentPostId);
    if (!parent) reject(`unknown parent post ${post.parentPostId}`);
    if (post.kind === 'post') expectedWrithe = parent.writhe + 1;
    causalPost = parent;
  }

  if (post.parentPostId !== expectedParentPostId) reject('parentPostId mismatch');
  if (post.writhe !== expectedWrithe) reject('writhe mismatch');
  if (post.linkingNumber !== calculate_linking_number({ postsInTad: post.twist + 1, totalReplyDepth: post.writhe })) {
    reject('linking number mismatch');
  }

  const authorLastPost = store.getLatestPostForGenome(post.genome);
  const expectedCausalParents = [
    ...new Set([authorLastPost?.postId, post.parentPostId, post.recombinesPostId].filter((id): id is string => id !== undefined)),
  ];
  if (JSON.stringify(post.causalParents) !== JSON.stringify(expectedCausalParents)) reject('causalParents mismatch');
  if (causalPost && post.hlcTimestamp.physical < causalPost.hlcTimestamp.physical) reject('HLC is older than causal parent');

  let tad = store.getOpenTad(post.genome);
  if (!tad) tad = store.createTad(post.genome);
  if (post.twist !== tad.posts.length) reject(`twist ${post.twist} does not match next local TAD index ${tad.posts.length}`);

  tad.posts.push(post);
  tad.merkleRootHex = toHex(computeMerkleRoot(tad.posts.map((p) => from_base4(p.contentHashBase4))));
  if (tad.posts.length >= TAD_SIZE) {
    tad.closed = true;
    tad.mmrLeafIndex = store.getOrCreateMmr(post.genome).append(fromHex(tad.merkleRootHex));
  }
  store.savePost(post, tad);

  return post;
}
