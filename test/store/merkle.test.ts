import { describe, expect, it } from 'vitest';
import { computeMerkleRoot, computeMerkleProof, verifyMerkleProof } from '../../src/store/merkle.js';
import { toHex } from '../../src/crypto/hex.js';

function leaf(n: number): Uint8Array {
  return new Uint8Array([n, n, n, n]);
}

describe('merkle proofs', () => {
  it.each([1, 2, 3, 4, 5, 7, 8, 10])('round-trips a proof for every index with %d leaves', (count) => {
    const leaves = Array.from({ length: count }, (_, i) => leaf(i));
    const rootHex = toHex(computeMerkleRoot(leaves));

    for (let i = 0; i < count; i++) {
      const proof = computeMerkleProof(leaves, i);
      expect(verifyMerkleProof(leaves[i], proof, rootHex)).toBe(true);
    }
  });

  it('rejects a proof against the wrong leaf', () => {
    const leaves = Array.from({ length: 5 }, (_, i) => leaf(i));
    const rootHex = toHex(computeMerkleRoot(leaves));
    const proof = computeMerkleProof(leaves, 2);

    expect(verifyMerkleProof(leaf(99), proof, rootHex)).toBe(false);
  });

  it('rejects a proof against a tampered root', () => {
    const leaves = Array.from({ length: 4 }, (_, i) => leaf(i));
    const proof = computeMerkleProof(leaves, 1);
    expect(verifyMerkleProof(leaves[1], proof, '00'.repeat(32))).toBe(false);
  });

  it('throws for an out-of-range index', () => {
    const leaves = [leaf(0), leaf(1)];
    expect(() => computeMerkleProof(leaves, 5)).toThrow(RangeError);
  });
});
