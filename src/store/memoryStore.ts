import { PolyGraph, defineEdges, MemoryAdapter } from '@0xx0lostcause0xx0/polypack';
import type { PersistenceAdapter, PolyNode } from '@0xx0lostcause0xx0/polypack';
import { MerkleMountainRange } from './mmr.js';
import { PeakGraph } from './peakGraph.js';
import { FollowGraph } from '../social/followGraph.js';
import { computeMerkleRoot } from './merkle.js';
import { toHex, fromHex } from '../crypto/hex.js';
import { from_base4 } from '../math/base4.js';
import { TAD_SIZE } from '../api/createPost.js';
import type { Genome, Helix, TAD } from '../types/index.js';

const EDGE = defineEdges({
  OWNS_TAD: 'OWNS_TAD',
  CONTAINS_POST: 'CONTAINS_POST',
  SUPERSEDES: 'SUPERSEDES',
  RELATES_TO: 'RELATES_TO',
});

const NODE_TYPE_GENOME = 'genome';
const NODE_TYPE_TAD = 'tad';
const NODE_TYPE_POST = 'post';

const ID_PREFIX_GENOME = 'genome:';
const ID_PREFIX_TAD = 'tad:';
const ID_PREFIX_POST = 'post:';

interface TadData {
  genome: string;
  merkleRootHex: string;
  closed: boolean;
  mmrLeafIndex?: number;
  /** Position in this genome's closed-TAD ordering (0 = first closed). */
  closedOrder?: number;
}

/**
 * The protocol store, backed by @0xx0lostcause0xx0/polypack's PolyGraph rather than
 * bare Maps. Genomes, TADs, and posts are graph nodes; the relationships between them
 * are edges - ownership (`genome ->OWNS_TAD-> tad`), membership
 * (`tad ->CONTAINS_POST-> post`), edits (`post ->SUPERSEDES-> post`), and
 * reply/like/boost targets (`post ->RELATES_TO-> post`) - so everything is
 * identifiable, retrievable by traversal, and persisted through the same adapter
 * machinery as the follow/peak graphs.
 *
 * The graph is given `hotCacheMax = Infinity`: this store already assumed the entire
 * dataset lives in memory, so keeping every node resident makes all synchronous reads
 * (`getNode`/`getEdgeTargets`/`whereType`) hit reliably and sidesteps PolyGraph's
 * eviction semantics entirely. Persistence (when an adapter is supplied) is therefore
 * a durable write-through mirror of an always-resident working set, not a load-on-demand
 * cache.
 *
 * Two things are deliberately NOT graph entities (they're sequential bookkeeping,
 * not relationships): the per-genome Merkle Mountain Range (rebuilt on demand by
 * re-folding closed TADs' roots in closing order - the same "mirror" the CLI demo
 * does by hand) and the open-TAD pointer (a transient Map since an open TAD has no
 * durable OWNS_TAD edge yet).
 */
export interface HelixStore {
  saveGenome(genome: Genome): void;
  getGenome(genomeAddress: string): Genome | undefined;
  hasGenome(genomeAddress: string): boolean;
  /** Every genome this store has observed (via genesis or directory sync) - used to
   *  serve directory snapshots and to build discovery suggestions. */
  getKnownGenomes(): Genome[];
  getOpenTad(genomeAddress: string): TAD | undefined;
  createTad(genomeAddress: string): TAD;
  getPost(postId: string): Helix | undefined;
  /** Write-through for a validated post: adds the node + edges and folds it into its
   *  TAD (recomputing the Merkle root, closing + MMR-folding the TAD at TAD_SIZE). */
  appendPost(post: Helix): void;
  getOrCreateMmr(genomeAddress: string): MerkleMountainRange;
  getClosedTad(genomeAddress: string, tadIndex: number): TAD | undefined;
  getLatestPostForGenome(genomeAddress: string): Helix | undefined;
  /** Posts inside a TAD, in twist order (derived from CONTAINS_POST edges). */
  getPostsInTad(tadId: string): Helix[];
  /** Every post the store knows about. */
  getAllPosts(): Helix[];
  getPostsByGenome(genome: string): Helix[];
  /** Current-version reply posts targeting `postId`. */
  getRepliesTo(postId: string): Helix[];
  /** Current-version like/boost posts targeting `targetPostId`. */
  getReactionsTo(targetPostId: string, kind: 'like' | 'boost'): Helix[];
  getProfilePost(genome: string): Helix | undefined;
  getFollowGraph(): FollowGraph;
  getPeakGraph(): PeakGraph;
  isSuperseded(postId: string): boolean;
  getCurrentVersion(postId: string): Helix | undefined;
}

export class MemoryStore implements HelixStore {
  private graph: PolyGraph;
  private followGraph: FollowGraph;
  private peakGraph: PeakGraph;
  private mmrsByGenome = new Map<string, MerkleMountainRange>();
  private openTadByGenome = new Map<string, string>();

  constructor(
    opts: {
      storeAdapter?: PersistenceAdapter;
      followGraphAdapter?: PersistenceAdapter;
      peakGraphAdapter?: PersistenceAdapter;
    } = {},
  ) {
    this.graph = new PolyGraph(opts.storeAdapter ?? new MemoryAdapter(), Infinity);
    this.followGraph = new FollowGraph(opts.followGraphAdapter);
    this.peakGraph = new PeakGraph(opts.peakGraphAdapter);
  }

  async loadPersistentGraphs(): Promise<void> {
    await this.graph.load();
    this.rebuildOpenTads();
    await Promise.all([this.followGraph.load(), this.peakGraph.load()]);
  }

  async flushPersistentGraphs(): Promise<void> {
    await Promise.all([this.graph.flush(), this.followGraph.flush(), this.peakGraph.flush()]);
  }

  async disposePersistentGraphs(): Promise<void> {
    await Promise.all([this.graph.dispose(), this.followGraph.dispose(), this.peakGraph.dispose()]);
  }

  saveGenome(genome: Genome): void {
    const existing = this.graph.getNode(`${ID_PREFIX_GENOME}${genome.genome}`);
    const data = existing ? { ...existing.data, ...genome } : { ...genome };
    this.graph.addNode({
      id: `${ID_PREFIX_GENOME}${genome.genome}`,
      type: NODE_TYPE_GENOME,
      data: data as Record<string, unknown>,
      insertedAt: existing?.insertedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  }

  getGenome(genomeAddress: string): Genome | undefined {
    return this.graph.getNode(`${ID_PREFIX_GENOME}${genomeAddress}`)?.data as unknown as Genome | undefined;
  }

  hasGenome(genomeAddress: string): boolean {
    return this.graph.getNode(`${ID_PREFIX_GENOME}${genomeAddress}`) !== undefined;
  }

  getKnownGenomes(): Genome[] {
    return this.graph.whereType(NODE_TYPE_GENOME).map((n) => n.data as unknown as Genome);
  }

  getOpenTad(genomeAddress: string): TAD | undefined {
    const tadId = this.openTadByGenome.get(genomeAddress);
    if (!tadId) return undefined;
    const node = this.graph.getNode(`${ID_PREFIX_TAD}${tadId}`);
    if (!node) return undefined;
    return this.toTad(node);
  }

  createTad(genomeAddress: string): TAD {
    const tadId = `${genomeAddress}.${globalThis.crypto.randomUUID()}`;
    const now = Date.now();
    this.graph.addNode({
      id: `${ID_PREFIX_TAD}${tadId}`,
      type: NODE_TYPE_TAD,
      data: { genome: genomeAddress, merkleRootHex: '00'.repeat(32), closed: false },
      insertedAt: now,
      updatedAt: now,
    });
    this.openTadByGenome.set(genomeAddress, tadId);
    return { tadId, genome: genomeAddress, merkleRootHex: '00'.repeat(32), posts: [], closed: false };
  }

  getPost(postId: string): Helix | undefined {
    return this.graph.getNode(`${ID_PREFIX_POST}${postId}`)?.data as unknown as Helix | undefined;
  }

  appendPost(post: Helix): void {
    const tadId = this.openTadByGenome.get(post.genome);
    if (!tadId) {
      throw new Error(`appendPost: no open TAD for genome ${post.genome}`);
    }
    const existing = this.getPostsInTad(tadId);
    if (post.twist !== existing.length) {
      throw new Error(`appendPost: twist ${post.twist} does not match next TAD index ${existing.length}`);
    }

    const now = Date.now();
    this.graph.addNode({
      id: `${ID_PREFIX_POST}${post.postId}`,
      type: NODE_TYPE_POST,
      data: post as unknown as Record<string, unknown>,
      insertedAt: now,
      updatedAt: now,
    });
    this.graph.addEdge(`${ID_PREFIX_TAD}${tadId}`, EDGE.CONTAINS_POST, `${ID_PREFIX_POST}${post.postId}`);
    if (post.parentPostId) {
      this.graph.addEdge(`${ID_PREFIX_POST}${post.postId}`, EDGE.RELATES_TO, `${ID_PREFIX_POST}${post.parentPostId}`);
    }
    if (post.recombinesPostId) {
      this.graph.addEdge(`${ID_PREFIX_POST}${post.postId}`, EDGE.SUPERSEDES, `${ID_PREFIX_POST}${post.recombinesPostId}`);
    }

    const allPosts = [...existing, post];
    const merkleRootHex = toHex(computeMerkleRoot(allPosts.map((p) => from_base4(p.contentHashBase4))));

    const updates: Record<string, unknown> = { merkleRootHex };
    if (allPosts.length >= TAD_SIZE) {
      const mmrLeafIndex = this.getOrCreateMmr(post.genome).append(fromHex(merkleRootHex));
      this.openTadByGenome.delete(post.genome);
      this.graph.addEdge(`${ID_PREFIX_GENOME}${post.genome}`, EDGE.OWNS_TAD, `${ID_PREFIX_TAD}${tadId}`);
      updates.closed = true;
      updates.mmrLeafIndex = mmrLeafIndex;
      updates.closedOrder = this.graph.getEdgeTargets(`${ID_PREFIX_GENOME}${post.genome}`, EDGE.OWNS_TAD).length - 1;
    }
    this.graph.updateNode(`${ID_PREFIX_TAD}${tadId}`, updates);
  }

  getOrCreateMmr(genomeAddress: string): MerkleMountainRange {
    let mmr = this.mmrsByGenome.get(genomeAddress);
    if (!mmr) {
      mmr = new MerkleMountainRange((combined, left, right) => this.peakGraph.recordFold(genomeAddress, combined, left, right));
      for (const tadId of this.closedTadIds(genomeAddress)) {
        const node = this.graph.getNode(tadId)?.data as TadData | undefined;
        if (!node || node.mmrLeafIndex === undefined) continue;
        mmr.append(fromHex(node.merkleRootHex));
      }
      this.mmrsByGenome.set(genomeAddress, mmr);
    }
    return mmr;
  }

  getClosedTad(genomeAddress: string, tadIndex: number): TAD | undefined {
    const tadId = this.closedTadIds(genomeAddress)[tadIndex];
    if (!tadId) return undefined;
    const node = this.graph.getNode(tadId);
    if (!node) return undefined;
    return this.toTad(node);
  }

  getLatestPostForGenome(genomeAddress: string): Helix | undefined {
    const openTad = this.getOpenTad(genomeAddress);
    if (openTad && openTad.posts.length > 0) {
      return openTad.posts[openTad.posts.length - 1];
    }
    const closedIds = this.closedTadIds(genomeAddress);
    const lastClosedId = closedIds[closedIds.length - 1];
    if (!lastClosedId) return undefined;
    const node = this.graph.getNode(lastClosedId);
    if (!node) return undefined;
    const lastClosed = this.toTad(node);
    return lastClosed.posts[lastClosed.posts.length - 1];
  }

  getPostsInTad(tadId: string): Helix[] {
    return this.graph
      .getEdgeTargets(`${ID_PREFIX_TAD}${tadId}`, EDGE.CONTAINS_POST)
      .map((id) => this.graph.getNode(id))
      .filter((n): n is PolyNode => n !== undefined)
      .map((n) => n.data as unknown as Helix)
      .sort((a, b) => a.twist - b.twist);
  }

  getAllPosts(): Helix[] {
    return this.graph.whereType(NODE_TYPE_POST).map((n) => n.data as unknown as Helix);
  }

  getPostsByGenome(genome: string): Helix[] {
    return this.graph
      .whereType(NODE_TYPE_POST)
      .filter((n) => (n.data as unknown as Helix).genome === genome)
      .map((n) => n.data as unknown as Helix);
  }

  getRepliesTo(postId: string): Helix[] {
    return this.graph
      .getEdgeSources(`${ID_PREFIX_POST}${postId}`, EDGE.RELATES_TO)
      .map((id) => this.graph.getNode(id))
      .filter((n): n is PolyNode => n !== undefined)
      .map((n) => n.data as unknown as Helix)
      .filter((p) => p.kind === 'post' && !this.isSuperseded(p.postId));
  }

  getReactionsTo(targetPostId: string, kind: 'like' | 'boost'): Helix[] {
    return this.graph
      .getEdgeSources(`${ID_PREFIX_POST}${targetPostId}`, EDGE.RELATES_TO)
      .map((id) => this.graph.getNode(id))
      .filter((n): n is PolyNode => n !== undefined)
      .map((n) => n.data as unknown as Helix)
      .filter((p) => p.kind === kind && !this.isSuperseded(p.postId));
  }

  getProfilePost(genome: string): Helix | undefined {
    return this.getAllPosts().find((p) => p.genome === genome && p.kind === 'profile' && !this.isSuperseded(p.postId));
  }

  getFollowGraph(): FollowGraph {
    return this.followGraph;
  }

  getPeakGraph(): PeakGraph {
    return this.peakGraph;
  }

  isSuperseded(postId: string): boolean {
    return this.graph.getEdgeSources(`${ID_PREFIX_POST}${postId}`, EDGE.SUPERSEDES).length > 0;
  }

  getCurrentVersion(postId: string): Helix | undefined {
    let id = postId;
    const seen = new Set<string>();
    while (!seen.has(id)) {
      seen.add(id);
      const superseding = this.graph.getEdgeSources(`${ID_PREFIX_POST}${id}`, EDGE.SUPERSEDES);
      if (superseding.length === 0) break;
      id = superseding[0].slice(ID_PREFIX_POST.length);
    }
    return this.getPost(id);
  }

  /** Closed TAD node ids for a genome, in close order (returns full `tad:`-prefixed ids). */
  private closedTadIds(genomeAddress: string): string[] {
    return this.graph
      .getEdgeTargets(`${ID_PREFIX_GENOME}${genomeAddress}`, EDGE.OWNS_TAD)
      .sort((a, b) => {
        const an = (this.graph.getNode(a)?.data as unknown as TadData | undefined)?.closedOrder ?? 0;
        const bn = (this.graph.getNode(b)?.data as unknown as TadData | undefined)?.closedOrder ?? 0;
        return an - bn;
      });
  }

  private rebuildOpenTads(): void {
    this.openTadByGenome.clear();
    for (const node of this.graph.whereType(NODE_TYPE_TAD)) {
      const d = node.data as unknown as TadData;
      if (!d.closed) {
        this.openTadByGenome.set(d.genome, node.id.slice(ID_PREFIX_TAD.length));
      }
    }
  }

  private toTad(node: PolyNode, posts?: Helix[]): TAD {
    const d = node.data as unknown as TadData;
    return {
      tadId: node.id.slice(ID_PREFIX_TAD.length),
      genome: d.genome,
      merkleRootHex: d.merkleRootHex,
      posts: posts ?? this.getPostsInTad(node.id.slice(ID_PREFIX_TAD.length)),
      closed: d.closed,
      mmrLeafIndex: d.mmrLeafIndex,
    };
  }
}
