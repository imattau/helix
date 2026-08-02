import { sha256 } from '../crypto/hash.js';
import { toHex, fromHex } from '../crypto/hex.js';
import { computeMerkleRoot, computeMerkleProof, verifyMerkleProof, type MerkleProofStep } from './merkle.js';

export interface MMRPeak {
  height: number;
  hashHex: string;
  /** Index of this peak's first leaf within the MMR's full append order. */
  startIndex: number;
  leafCount: number;
}

export interface MMRSyncState {
  totalLeaves: number;
  /** O(log N)-sized payload: this is the entire thing a remote peer needs to sync. */
  peaks: MMRPeak[];
  /** Combined hash of all peak hashes in order, for a one-shot "did anything change" check. */
  syncHashHex: string;
}

export interface MMRProof {
  index: number;
  peakIndex: number;
  steps: MerkleProofStep[];
}

/**
 * A Merkle Mountain Range: leaves append into an internal tail; once the tail reaches
 * a power-of-2 size (relative to the current peak count) it folds into a new peak, and
 * peaks of equal height bag together the same way DNA loops stack into a fractal
 * globule. The full leaf history is retained (nothing is discarded - see the project
 * plan for why the "XOR zipper" tail-fold from the original proposal doesn't actually
 * save space and isn't implemented), so proofs are always recomputed on demand from the
 * live leaf array using each peak's (startIndex, leafCount) span rather than a maintained
 * tree of objects - simpler, and always consistent with the current bagged state.
 *
 * NOTE: a leaf that has been appended but not yet folded into a peak (because the
 * internal tail hasn't reached its next power-of-2 threshold) has no peak-based proof
 * yet - getProof() throws for such an index. It's still directly readable from local
 * storage; it just isn't compactly provable to a remote peer until the next fold.
 */
export class MerkleMountainRange {
  private leaves: Uint8Array[] = [];
  private peaks: MMRPeak[] = [];
  private tailStart = 0;

  /** Appends a leaf (e.g. a closed TAD's Merkle root), folding/bagging peaks as needed. Returns the assigned leaf index. */
  append(leafHash: Uint8Array): number {
    const index = this.leaves.length;
    this.leaves.push(leafHash);

    const tailLen = this.leaves.length - this.tailStart;
    if (tailLen === 2 ** this.peaks.length) {
      this.foldTail();
    }
    return index;
  }

  private foldTail(): void {
    const start = this.tailStart;
    const count = this.leaves.length - start;
    const slice = this.leaves.slice(start, start + count);
    const rootHash = computeMerkleRoot(slice);

    this.peaks.push({ height: Math.log2(count), hashHex: toHex(rootHash), startIndex: start, leafCount: count });
    this.tailStart = this.leaves.length;

    while (this.peaks.length >= 2 && this.peaks[this.peaks.length - 1].height === this.peaks[this.peaks.length - 2].height) {
      const right = this.peaks.pop()!;
      const left = this.peaks.pop()!;
      const combined = new Uint8Array(64);
      combined.set(fromHex(left.hashHex), 0);
      combined.set(fromHex(right.hashHex), 32);
      this.peaks.push({
        height: left.height + 1,
        hashHex: toHex(sha256(combined)),
        startIndex: left.startIndex,
        leafCount: left.leafCount + right.leafCount,
      });
    }
  }

  getSyncState(): MMRSyncState {
    const peaks = this.peaks.map((p) => ({ ...p }));
    const combined = new Uint8Array(peaks.length * 32);
    peaks.forEach((p, i) => combined.set(fromHex(p.hashHex), i * 32));
    return { totalLeaves: this.leaves.length, peaks, syncHashHex: toHex(sha256(combined)) };
  }

  getProof(index: number): MMRProof {
    if (index < 0 || index >= this.leaves.length) {
      throw new RangeError(`getProof: index ${index} out of range for ${this.leaves.length} leaves`);
    }

    let offset = 0;
    for (let i = 0; i < this.peaks.length; i++) {
      const peak = this.peaks[i];
      if (index < offset + peak.leafCount) {
        const localIndex = index - offset;
        const slice = this.leaves.slice(peak.startIndex, peak.startIndex + peak.leafCount);
        return { index, peakIndex: i, steps: computeMerkleProof(slice, localIndex) };
      }
      offset += peak.leafCount;
    }

    throw new Error(`getProof: index ${index} has not yet been folded into a peak`);
  }

  static verifyProof(leaf: Uint8Array, proof: MMRProof, peaks: readonly MMRPeak[]): boolean {
    const peak = peaks[proof.peakIndex];
    if (!peak) return false;
    return verifyMerkleProof(leaf, proof.steps, peak.hashHex);
  }
}
