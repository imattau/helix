import { PolyGraph, defineEdges } from '@0xx0lostcause0xx0/polypack';
import type { PolyNode } from '@0xx0lostcause0xx0/polypack';
import type { MMRPeak } from './mmr.js';

const EDGE = defineEdges({ CONTAINS: 'CONTAINS' });
const NODE_TYPE_PEAK = 'peak';

interface PeakNodeData {
  [key: string]: unknown;
  genome: string;
  height: number;
  hashHex: string;
  startIndex: number;
  leafCount: number;
}

function peakNodeId(genome: string, peak: MMRPeak): string {
  // (startIndex, height) uniquely identifies a peak within one genome's MMR.
  return `${genome}:${peak.startIndex}:${peak.height}`;
}

function nodeToPeak(node: PolyNode): MMRPeak {
  const d = node.data as PeakNodeData;
  return { height: d.height, hashHex: d.hashHex, startIndex: d.startIndex, leafCount: d.leafCount };
}

/**
 * Mirrors MerkleMountainRange's peak-folding events (src/store/mmr.ts's foldTail(),
 * via the optional onFold constructor callback) into `@0xx0lostcause0xx0/polypack`'s
 * graph engine, the same wrapper pattern src/social/followGraph.ts already uses for
 * the social graph. This makes the fold hierarchy - which peaks combined into which
 * higher peaks - graph-queryable, but it's purely an additive mirror: the actual
 * proof/sync math (getSyncState/getProof/verifyProof in mmr.ts) never reads from
 * this and is completely unaffected by it.
 */
export class PeakGraph {
  private graph = new PolyGraph();

  private ensurePeakNode(genome: string, peak: MMRPeak): string {
    const id = peakNodeId(genome, peak);
    if (!this.graph.getNode(id)) {
      const now = Date.now();
      const data: PeakNodeData = { genome, height: peak.height, hashHex: peak.hashHex, startIndex: peak.startIndex, leafCount: peak.leafCount };
      const node: PolyNode = { id, type: NODE_TYPE_PEAK, data, insertedAt: now, updatedAt: now };
      this.graph.addNode(node);
    }
    return id;
  }

  /** Records that `left` and `right` (adjacent, equal-height peaks) folded into `combined`. */
  recordFold(genome: string, combined: MMRPeak, left: MMRPeak, right: MMRPeak): void {
    const combinedId = this.ensurePeakNode(genome, combined);
    const leftId = this.ensurePeakNode(genome, left);
    const rightId = this.ensurePeakNode(genome, right);
    // 'owned': the combined peak contains all the data of both children losslessly -
    // there's no meaningful independent lifetime for a child peak once folded.
    this.graph.addEdge(combinedId, EDGE.CONTAINS, leftId, {}, 'owned');
    this.graph.addEdge(combinedId, EDGE.CONTAINS, rightId, {}, 'owned');
  }

  /** The two peaks `peak` was folded from, or [] if it was never combined with a sibling. */
  getChildren(genome: string, peak: MMRPeak): MMRPeak[] {
    const id = peakNodeId(genome, peak);
    return this.graph
      .getEdgeTargets(id, EDGE.CONTAINS)
      .map((childId) => this.graph.getNode(childId))
      .filter((n): n is PolyNode => n !== undefined)
      .map(nodeToPeak);
  }

  /** Every higher-order peak `peak` eventually became part of, nearest first. Each
   *  peak has exactly one parent once folded, so this is a genuine linear chain -
   *  unlike descendants (two children per node), which getChildren walks one level
   *  at a time instead. */
  getAncestors(genome: string, peak: MMRPeak): MMRPeak[] {
    const id = peakNodeId(genome, peak);
    // walkAncestors returns root-to-start (per its own doc); reverse to nearest-first.
    return this.graph
      .walkAncestors(id, EDGE.CONTAINS)
      .filter((n) => n.id !== id)
      .reverse()
      .map(nodeToPeak);
  }
}
