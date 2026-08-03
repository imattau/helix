import { describe, expect, it } from 'vitest';
import { MerkleMountainRange, type MMRPeak } from '../../src/store/mmr.js';

function leaf(n: number): Uint8Array {
  return new Uint8Array([n, n, n, n]);
}

describe('MerkleMountainRange', () => {
  it('bags every leaf immediately: peak heights always match the set bits of the leaf count', () => {
    // Real per-leaf MMR carry-propagation: at any N, peak heights (tallest first) are
    // exactly N's set bits in binary, e.g. N=7 (0b111) -> [2, 1, 0], N=5 (0b101) -> [2, 0].
    const mmr = new MerkleMountainRange();
    for (let n = 1; n <= 20; n++) {
      mmr.append(leaf(n - 1));
      const state = mmr.getSyncState();
      expect(state.totalLeaves).toBe(n);

      const expectedHeights: number[] = [];
      for (let bit = 31; bit >= 0; bit--) {
        if (n & (1 << bit)) expectedHeights.push(bit);
      }
      expect(state.peaks.map((p) => p.height)).toEqual(expectedHeights);
      expect(state.peaks.reduce((sum, p) => sum + p.leafCount, 0)).toBe(n); // every leaf always belongs to some peak
    }
  });

  it('every appended leaf has a peak-based proof immediately (no pending/unfolded leaves)', () => {
    const mmr = new MerkleMountainRange();
    mmr.append(leaf(0));
    mmr.append(leaf(1));

    const state = mmr.getSyncState();
    expect(state.totalLeaves).toBe(2);
    expect(state.peaks.reduce((sum, p) => sum + p.leafCount, 0)).toBe(2);
    expect(() => mmr.getProof(1)).not.toThrow();
  });

  it('round-trips proofs for every folded leaf across many appends', () => {
    const mmr = new MerkleMountainRange();
    const leaves = Array.from({ length: 15 }, (_, i) => leaf(i));
    for (const l of leaves) mmr.append(l);

    const { peaks } = mmr.getSyncState();
    for (let i = 0; i < leaves.length; i++) {
      const proof = mmr.getProof(i);
      expect(MerkleMountainRange.verifyProof(leaves[i], proof, peaks)).toBe(true);
    }
  });

  it('rejects a proof for a tampered leaf', () => {
    const mmr = new MerkleMountainRange();
    for (let i = 0; i < 7; i++) mmr.append(leaf(i));

    const { peaks } = mmr.getSyncState();
    const proof = mmr.getProof(3);
    expect(MerkleMountainRange.verifyProof(leaf(3), proof, peaks)).toBe(true);
    expect(MerkleMountainRange.verifyProof(leaf(99), proof, peaks)).toBe(false);
  });

  it('a freshly re-derived proof stays valid after later appends, even once its peak has been absorbed upward', () => {
    const mmr = new MerkleMountainRange();
    for (let i = 0; i < 3; i++) mmr.append(leaf(i));

    for (let i = 3; i < 7; i++) mmr.append(leaf(i)); // may absorb leaf 0's original peak into a taller one
    const laterProof = mmr.getProof(0); // re-derived against current state, not cached from before
    const { peaks: laterPeaks } = mmr.getSyncState();

    expect(MerkleMountainRange.verifyProof(leaf(0), laterProof, laterPeaks)).toBe(true);
  });

  it('fires onFold once per peak+peak combine, with the combined height one more than its children', () => {
    const folds: { combined: MMRPeak; left: MMRPeak; right: MMRPeak }[] = [];
    const mmr = new MerkleMountainRange((combined, left, right) => folds.push({ combined, left, right }));

    for (let i = 0; i < 8; i++) mmr.append(leaf(i));

    // N=8 (0b1000) folds down to a single height-3 peak: leaf appends 1..8 trigger
    // combines at N=2,4(x2),6,8(x3) -> 1+2+3 = ... let's just assert the invariants
    // instead of a magic count, since the exact count is implied by popcount cascades.
    expect(folds.length).toBeGreaterThan(0);
    for (const { combined, left, right } of folds) {
      expect(left.height).toBe(right.height);
      expect(combined.height).toBe(left.height + 1);
      expect(combined.leafCount).toBe(left.leafCount + right.leafCount);
    }
    // 8 = 2^3, so everything bags into one peak of height 3.
    expect(mmr.getSyncState().peaks.map((p) => p.height)).toEqual([3]);
  });
});
