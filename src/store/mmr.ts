import { sha256 } from '../crypto/hash.js';
import { toHex, fromHex } from '../crypto/hex.js';
import { computeMerkleProof, verifyMerkleProof, type MerkleProofStep } from './merkle.js';

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
 * A Merkle Mountain Range: each appended leaf becomes a new height-0 peak, then peaks
 * bag together - two adjacent peaks of equal height combine into one peak of height+1 -
 * the same carry-propagation as incrementing a binary counter, and the same way DNA
 * loops stack into a fractal globule. At any point the peak heights are exactly the set
 * bits of the total leaf count, from tallest to shortest. The full leaf history is
 * retained (nothing is discarded), so proofs are always recomputed on demand from the
 * live leaf array using each peak's (startIndex, leafCount) span rather than a maintained
 * tree of objects - simpler, and always consistent with the current bagged state.
 *
 * NOTE: because peaks bag upward as more leaves arrive, a peak (and any MMRProof
 * derived from it) is only guaranteed valid against its *own* getSyncState() snapshot -
 * a later append can absorb it into a taller peak with a different hash. Callers that
 * need a proof to stay verifiable should re-derive it (getProof + fresh getSyncState())
 * rather than caching one indefinitely. This is standard MMR behavior, not a bug.
 */
export class MerkleMountainRange {
  private leaves: Uint8Array[] = [];
  private peaks: MMRPeak[] = [];

  /**
   * Optional observer fired once per peak+peak combine. Purely additive: the
   * proof/sync math below never reads from it. See src/store/peakGraph.ts, which
   * uses this to mirror the fold hierarchy into the PolyPack graph engine.
   */
  constructor(private readonly onFold?: (combined: MMRPeak, left: MMRPeak, right: MMRPeak) => void) {}

  /** Appends a leaf (e.g. a closed TAD's Merkle root), bagging peaks as needed. Returns the assigned leaf index. */
  append(leafHash: Uint8Array): number {
    const index = this.leaves.length;
    this.leaves.push(leafHash);

    this.peaks.push({ height: 0, hashHex: toHex(sha256(leafHash)), startIndex: index, leafCount: 1 });

    while (this.peaks.length >= 2 && this.peaks[this.peaks.length - 1].height === this.peaks[this.peaks.length - 2].height) {
      const right = this.peaks.pop()!;
      const left = this.peaks.pop()!;
      const combined = new Uint8Array(64);
      combined.set(fromHex(left.hashHex), 0);
      combined.set(fromHex(right.hashHex), 32);
      const folded: MMRPeak = {
        height: left.height + 1,
        hashHex: toHex(sha256(combined)),
        startIndex: left.startIndex,
        leafCount: left.leafCount + right.leafCount,
      };
      this.peaks.push(folded);
      this.onFold?.(folded, left, right);
    }
    return index;
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
