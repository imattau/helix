import { describe, expect, it } from 'vitest';
import { MerkleMountainRange } from '../../src/store/mmr.js';
import { PeakGraph } from '../../src/store/peakGraph.js';

function leaf(n: number): Uint8Array {
  return new Uint8Array([n, n, n, n]);
}

describe('PeakGraph', () => {
  it('records a CONTAINS edge from the combined peak to both children on a fold', () => {
    const graph = new PeakGraph();
    const genome = 'ACGT';
    const mmr = new MerkleMountainRange((combined, left, right) => graph.recordFold(genome, combined, left, right));

    mmr.append(leaf(0));
    mmr.append(leaf(1)); // two height-0 peaks combine into one height-1 peak

    const { peaks } = mmr.getSyncState();
    expect(peaks).toHaveLength(1);
    const combinedPeak = peaks[0];

    const children = graph.getChildren(genome, combinedPeak);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.height)).toEqual([0, 0]);
  });

  it('getChildren returns [] for a peak that was never combined with a sibling', () => {
    const graph = new PeakGraph();
    const genome = 'ACGT';
    const mmr = new MerkleMountainRange((combined, left, right) => graph.recordFold(genome, combined, left, right));

    mmr.append(leaf(0));
    mmr.append(leaf(1));
    mmr.append(leaf(2)); // N=3 (0b11): a height-1 peak and a lone height-0 peak

    const { peaks } = mmr.getSyncState();
    const loneHeight0 = peaks.find((p) => p.height === 0)!;
    expect(graph.getChildren(genome, loneHeight0)).toEqual([]);
  });

  it('getAncestors walks up correctly across multiple fold levels', () => {
    const graph = new PeakGraph();
    const genome = 'ACGT';
    const mmr = new MerkleMountainRange((combined, left, right) => graph.recordFold(genome, combined, left, right));

    for (let i = 0; i < 8; i++) mmr.append(leaf(i)); // N=8 -> one height-3 peak from three fold levels

    const { peaks } = mmr.getSyncState();
    expect(peaks.map((p) => p.height)).toEqual([3]);
    const root = peaks[0];

    const [child0, child1] = graph.getChildren(genome, root);
    expect([child0.height, child1.height]).toEqual([2, 2]);

    const [grandchild0] = graph.getChildren(genome, child0);
    expect(grandchild0.height).toBe(1);

    const ancestors = graph.getAncestors(genome, grandchild0);
    expect(ancestors.map((a) => a.height)).toEqual([2, 3]); // nearest first, up to the root
  });

  it('keys peak nodes by (genome, coordinates), keeping each genome\'s fold history distinct', () => {
    const graph = new PeakGraph();
    const mmrA = new MerkleMountainRange((combined, left, right) => graph.recordFold('ACGT', combined, left, right));
    const mmrB = new MerkleMountainRange((combined, left, right) => graph.recordFold('TGCA', combined, left, right));

    mmrA.append(leaf(0));
    mmrA.append(leaf(1));
    mmrB.append(leaf(10));
    mmrB.append(leaf(11));

    const combinedA = mmrA.getSyncState().peaks[0];
    const combinedB = mmrB.getSyncState().peaks[0];
    // Both MMRs grow identically (2 leaves each), so they land on the same
    // (startIndex, height) coordinates - only the leaf bytes differ.
    expect(combinedA.startIndex).toBe(combinedB.startIndex);
    expect(combinedA.height).toBe(combinedB.height);
    expect(combinedA.hashHex).not.toBe(combinedB.hashHex);

    const childrenA = graph.getChildren('ACGT', combinedA).map((c) => c.hashHex).sort();
    const childrenB = graph.getChildren('TGCA', combinedB).map((c) => c.hashHex).sort();
    expect(childrenA).toHaveLength(2);
    expect(childrenB).toHaveLength(2);
    expect(childrenA).not.toEqual(childrenB); // each genome's fold history is tracked independently
  });
});
