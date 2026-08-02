export type Base4Char = 'A' | 'C' | 'G' | 'T';

/** Chronological index of a post within its TAD. */
export type Twist = number;
/** Reply/quote tree depth. */
export type Writhe = number;

export interface Genome {
  genome: string; // base-4 string
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

export interface Helix {
  postId: string;
  genome: string;
  content: string;
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

export interface Spacer {
  postId: string;
  /** 64-bit SimHash fingerprint of the debunked content, as a hex string — see src/math/simhash.ts. */
  simhashHex: string;
  evidenceHash: string;
  submittedBy: string;
}
