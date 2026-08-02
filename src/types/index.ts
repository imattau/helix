export type Base4Char = 'A' | 'C' | 'G' | 'T';

/** Chronological index of a post within its TAD. */
export type Twist = number;
/** Reply/quote tree depth. */
export type Writhe = number;

export interface Genome {
  genome: string; // base-4 string
  publicKeyHex: string;
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
  vdfTickIndex: number;
  vdfOutputHex: string;
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
  falseHashBase4: string;
  evidenceHash: string;
  submittedBy: string;
  complementaryAnchor: string;
}

export interface VDFTickMessage {
  tickIndex: number;
  seedHex: string;
  outputHex: string;
  difficulty: number;
  prevTickHashHex: string;
}
