import { PolyGraph, defineEdges } from '@0xx0lostcause0xx0/polypack';
import type { PersistenceAdapter, PolyNode } from '@0xx0lostcause0xx0/polypack';

const EDGE = defineEdges({ FOLLOWS: 'FOLLOWS' });
const NODE_TYPE_GENOME = 'genome';

/**
 * Wraps @0xx0lostcause0xx0/polypack's PolyGraph as the social graph engine — the one
 * place in this project a graph library is a direct fit for the actual data shape
 * (typed nodes/edges, multi-hop traversal), unlike the from-scratch primitives used
 * everywhere else. Kept behind this narrow interface so callers never touch polypack
 * directly; if its API needs to change, only this file does.
 *
 * No vector embeddings are used here - follow edges are plain graph structure,
 * `PolyGraph`'s `addNode`/`addEdge` work without them.
 */
export class FollowGraph {
  private graph: PolyGraph;

  constructor(adapter?: PersistenceAdapter) {
    this.graph = new PolyGraph(adapter);
  }

  load(): Promise<void> {
    return this.graph.warm();
  }

  flush(): Promise<void> {
    return this.graph.flush();
  }

  dispose(): Promise<void> {
    return this.graph.dispose();
  }

  private flushSoon(): void {
    this.graph.flush().catch((err) => console.error('[helix] failed to persist follow graph', err));
  }

  private ensureGenomeNode(genome: string): void {
    if (this.graph.getNode(genome)) return;
    const now = Date.now();
    const node: PolyNode = { id: genome, type: NODE_TYPE_GENOME, data: {}, insertedAt: now, updatedAt: now };
    this.graph.addNode(node);
  }

  /** Idempotent - addEdge is a no-op if the (follower, FOLLOWS, followee) triple already exists. */
  addFollow(followerGenome: string, followeeGenome: string): void {
    this.ensureGenomeNode(followerGenome);
    this.ensureGenomeNode(followeeGenome);
    this.graph.addEdge(followerGenome, EDGE.FOLLOWS, followeeGenome);
    this.flushSoon();
  }

  /** Who `genome` follows. */
  getFollowing(genome: string): string[] {
    return this.graph.getEdgeTargets(genome, EDGE.FOLLOWS);
  }

  /** Who follows `genome`. */
  getFollowers(genome: string): string[] {
    return this.graph.getEdgeSources(genome, EDGE.FOLLOWS);
  }

  /**
   * The 2nd-degree ring: followers of `genome`'s followers, excluding `genome` itself
   * and its direct followers - "who might you want to follow next," not the raw union.
   */
  getFollowersOfFollowers(genome: string): string[] {
    const directFollowers = new Set(this.getFollowers(genome));
    const secondDegree = new Set<string>();

    for (const follower of directFollowers) {
      for (const followerOfFollower of this.getFollowers(follower)) {
        secondDegree.add(followerOfFollower);
      }
    }

    secondDegree.delete(genome);
    for (const follower of directFollowers) secondDegree.delete(follower);

    return [...secondDegree];
  }
}
