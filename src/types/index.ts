export type Base4Char = 'A' | 'C' | 'G' | 'T';

/** Chronological index of a post within its TAD. */
export type Twist = number;
/** Reply/quote tree depth. */
export type Writhe = number;

export interface Genome {
  genome: string; // base-4 string
  displayName: string;
  publicKeyHex: string;
  peerId: string;
  /** Proof-of-work nonce proving registration cost was paid — see src/crypto/pow.ts. */
  powNonce: number;
}

/** Hybrid Logical Clock timestamp — see src/clock/hlc.ts. */
export interface HLCTimestamp {
  physical: number;
  logical: number;
  peerId: string;
}

/**
 * A content-addressed reference to media/long-form content hosted outside the gossiped
 * post itself — see src/api/attachment.ts. `sourceUrl`/`ipfsCid` are hints only;
 * `hashHex` is the source of truth a reader verifies against before trusting fetched
 * bytes, whichever transport actually served them.
 *
 * `sourceUrl` is present only for attachments at or under INLINE_MAX_BYTES (see
 * attachment.ts) — inlining a full data: URL for every attachment, regardless of size,
 * meant every peer that ever receives the post downloads and permanently stores the
 * full bytes whether or not anyone reads them, with no eviction. Above the threshold,
 * `sourceUrl` is omitted and `ipfsCid` (real IPFS/bitswap) is the only retrieval path —
 * genuinely pull-based, and readers reseed what they fetch (see client.ts), so
 * availability doesn't depend solely on the original publisher staying online.
 */
export interface Attachment {
  hashHex: string;
  mimeType: string;
  sizeBytes: number;
  sourceUrl?: string;
  ipfsCid?: string;
}

/**
 * 'post' covers both top-level posts and replies (already distinguished via
 * parentPostId). 'like'/'boost'/'profile' reuse the same append-only/recombinable
 * post primitive instead of inventing separate wire types - see createPost.ts.
 */
export type HelixKind = 'post' | 'like' | 'boost' | 'profile';

export interface Helix {
  postId: string;
  genome: string;
  content: string;
  kind: HelixKind;
  /** Reply target (kind 'post') or like/boost target (kind 'like'/'boost') - the
   *  same field doubles as a generic "this relates to that post" reference. */
  parentPostId?: string;
  twist: Twist;
  writhe: Writhe;
  linkingNumber: number;
  entropy: number;
  contentHashBase4: string;
  gf4Checksum: string;
  hlcTimestamp: HLCTimestamp;
  /** Post IDs the author knew about at creation time: their own previous post, plus a reply's parent. */
  causalParents: string[];
  attachment?: Attachment;
  /** Set when this post supersedes an earlier one by the same author (an "edit") -
   *  see src/api/createPost.ts's recombination handling. The original post is never
   *  mutated or removed; readers follow this pointer forward for the current version. */
  recombinesPostId?: string;
}

export interface TAD {
  tadId: string;
  genome: string;
  merkleRootHex: string;
  posts: Helix[];
  closed: boolean;
  /** Set when this TAD closes and its root is folded into the genome's MMR. Undefined while still open. */
  mmrLeafIndex?: number;
}

export type FollowAction = 'follow' | 'unfollow';

export interface Follow {
  followerGenome: string;
  followeeGenome: string;
  hlcTimestamp: HLCTimestamp;
  /** 'unfollow' removes the edge on every receiver - see src/api/follow.ts. */
  action: FollowAction;
}

export interface Spacer {
  postId: string;
  /** 64-bit SimHash fingerprint of the debunked content, as a hex string — see src/math/simhash.ts. */
  simhashHex: string;
  evidenceHash: string;
  submittedBy: string;
}
