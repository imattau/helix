import { describe, expect, it } from 'vitest';
import { MerkleMountainRange } from '../../src/store/mmr.js';

function leaf(n: number): Uint8Array {
  return new Uint8Array([n, n, n, n]);
}

describe('MerkleMountainRange', () => {
  it('folds leaves into peaks with strictly increasing heights [0, 1, 2, ...] at N=1,3,7,15', () => {
    // Given the fold rule (tailLen === 2 ** peaks.length), each new peak's height always
    // equals the current peak count at fold time, so peaks come out as [0, 1, 2, ..., k-1]
    // with every leaf folded (no pending tail) exactly at N = 2^k - 1.
    const mmr = new MerkleMountainRange();
    const boundaries = [1, 3, 7, 15];
    let n = 0;
    for (const boundary of boundaries) {
      while (n < boundary) {
        mmr.append(leaf(n));
        n++;
      }
      const state = mmr.getSyncState();
      expect(state.totalLeaves).toBe(boundary);
      expect(state.peaks.map((p) => p.height)).toEqual(Array.from({ length: state.peaks.length }, (_, i) => i));
      expect(state.peaks.reduce((sum, p) => sum + p.leafCount, 0)).toBe(boundary); // fully folded, no pending tail
    }
  });

  it('leaves a pending (unfolded) leaf between fold boundaries', () => {
    const mmr = new MerkleMountainRange();
    mmr.append(leaf(0)); // folds immediately (N=1)
    mmr.append(leaf(1)); // N=2: tail needs to reach 2^1=2, so this one is still pending

    const state = mmr.getSyncState();
    expect(state.totalLeaves).toBe(2);
    const foldedCount = state.peaks.reduce((sum, p) => sum + p.leafCount, 0);
    expect(foldedCount).toBe(1); // only the first leaf has a peak yet
    expect(() => mmr.getProof(1)).toThrow(); // index 1 isn't folded into a peak yet
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

  it('keeps earlier proofs valid after later appends (peaks are append-only, never rewritten)', () => {
    const mmr = new MerkleMountainRange();
    for (let i = 0; i < 3; i++) mmr.append(leaf(i));
    const earlyProof = mmr.getProof(0);

    for (let i = 3; i < 7; i++) mmr.append(leaf(i)); // adds new peaks, doesn't touch existing ones
    const { peaks: laterPeaks } = mmr.getSyncState();

    expect(MerkleMountainRange.verifyProof(leaf(0), earlyProof, laterPeaks)).toBe(true);
  });
});
