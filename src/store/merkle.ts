import { sha256 } from '../crypto/hash.js';
import { toHex, fromHex } from '../crypto/hex.js';

/**
 * Minimal binary Merkle tree over SHA-256, sized for a single TAD (max 10 leaves).
 * Hand-rolled rather than a library: the fixed small size keeps this a couple dozen
 * lines and keeps the SHA-256-only invariant auditable in one place.
 */

function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return sha256(combined);
}

export function computeMerkleRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return new Uint8Array(32); // zero root for an empty TAD

  let layer = leaves.map((leaf) => sha256(leaf));
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? layer[i]; // duplicate last leaf on odd counts
      next.push(hashPair(left, right));
    }
    layer = next;
  }
  return layer[0];
}

export interface MerkleProofStep {
  /** Hex of the sibling hash at this level. */
  siblingHex: string;
  /** Where the sibling sits relative to the running hash: before it ('left') or after it ('right'). */
  position: 'left' | 'right';
}

/** Builds an inclusion proof for `leaves[index]`, using the same pairing/duplication rule as computeMerkleRoot. */
export function computeMerkleProof(leaves: Uint8Array[], index: number): MerkleProofStep[] {
  if (index < 0 || index >= leaves.length) {
    throw new RangeError(`computeMerkleProof: index ${index} out of range for ${leaves.length} leaves`);
  }

  let layer = leaves.map((leaf) => sha256(leaf));
  let idx = index;
  const steps: MerkleProofStep[] = [];

  while (layer.length > 1) {
    const isRightNode = idx % 2 === 1;
    const siblingIndex = isRightNode ? idx - 1 : Math.min(idx + 1, layer.length - 1);
    steps.push({ siblingHex: toHex(layer[siblingIndex]), position: isRightNode ? 'left' : 'right' });

    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? layer[i];
      next.push(hashPair(left, right));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }

  return steps;
}

/** Verifies that `leaf` is included under `expectedRootHex` per `proof`, recomputing bottom-up with SHA-256. */
export function verifyMerkleProof(leaf: Uint8Array, proof: MerkleProofStep[], expectedRootHex: string): boolean {
  let current = sha256(leaf);
  for (const step of proof) {
    const sibling = fromHex(step.siblingHex);
    current = step.position === 'left' ? hashPair(sibling, current) : hashPair(current, sibling);
  }
  return toHex(current) === expectedRootHex;
}
