import { PolyGraph, defineEdges } from '@0xx0lostcause0xx0/polypack';
import type { PersistenceAdapter, PolyNode } from '@0xx0lostcause0xx0/polypack';

const EDGE = defineEdges({ BLOCKS: 'BLOCKS' });
const NODE_TYPE_GENOME = 'genome';

/**
 * Same PolyGraph-backed pattern as FollowGraph (see follow ordinarily needing that
 * fit) - but unlike follows, blocks are never broadcast to the network: there's no
 * api/block.ts wrapper and no wire message type, since telling every peer "genome X
 * blocked genome Y" would itself be a privacy leak. This is purely local, per-device
 * state, persisted the same way (OPFS/IndexedDB/Tauri FS) so it survives restarts
 * without needing a bespoke localStorage key.
 */
export class BlockGraph {
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
    this.graph.flush().catch((err) => console.error('[helix] failed to persist block graph', err));
  }

  private ensureGenomeNode(genome: string): void {
    if (this.graph.getNode(genome)) return;
    const now = Date.now();
    const node: PolyNode = { id: genome, type: NODE_TYPE_GENOME, data: {}, insertedAt: now, updatedAt: now };
    this.graph.addNode(node);
  }

  /** Idempotent - addEdge is a no-op if the (blocker, BLOCKS, blocked) triple already exists. */
  addBlock(blockerGenome: string, blockedGenome: string): void {
    this.ensureGenomeNode(blockerGenome);
    this.ensureGenomeNode(blockedGenome);
    this.graph.addEdge(blockerGenome, EDGE.BLOCKS, blockedGenome);
    this.flushSoon();
  }

  /** Idempotent - removing an edge that isn't there is a no-op. The genome nodes stay. */
  removeBlock(blockerGenome: string, blockedGenome: string): void {
    this.graph.removeEdges(blockerGenome, EDGE.BLOCKS, blockedGenome);
    this.flushSoon();
  }

  /** Who `genome` has blocked. */
  getBlocked(genome: string): string[] {
    return this.graph.getEdgeTargets(genome, EDGE.BLOCKS);
  }

  isBlocked(blockerGenome: string, blockedGenome: string): boolean {
    return this.getBlocked(blockerGenome).includes(blockedGenome);
  }
}
