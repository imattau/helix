import { MerkleMountainRange } from './mmr.js';
import { FollowGraph } from '../social/followGraph.js';
import type { Genome, Helix, TAD } from '../types/index.js';

/**
 * Small interface so this in-memory Map-based store can later be swapped for a
 * persistent backend (sqlite/lowdb) without touching callers. Real IPFS/DHT-backed
 * storage is out of scope for this pass; `db.*` from the pseudocode maps to this.
 */
export interface HelixStore {
  saveGenome(genome: Genome): void;
  getGenome(genomeAddress: string): Genome | undefined;
  hasGenome(genomeAddress: string): boolean;
  getOpenTad(genomeAddress: string): TAD | undefined;
  createTad(genomeAddress: string): TAD;
  saveTad(tad: TAD): void;
  getPost(postId: string): Helix | undefined;
  savePost(post: Helix, tad: TAD): void;
  getOrCreateMmr(genomeAddress: string): MerkleMountainRange;
  getClosedTad(genomeAddress: string, tadIndex: number): TAD | undefined;
  getLatestPostForGenome(genomeAddress: string): Helix | undefined;
  getFollowGraph(): FollowGraph;
  /** True once some other post's `recombinesPostId` points at this one - see createPost.ts. */
  isSuperseded(postId: string): boolean;
  /** Walks the recombination chain forward to the current (non-superseded) version. */
  getCurrentVersion(postId: string): Helix | undefined;
}

export class MemoryStore implements HelixStore {
  private genomes = new Map<string, Genome>();
  private tads = new Map<string, TAD>();
  private posts = new Map<string, Helix>();
  private openTadByGenome = new Map<string, string>(); // genome -> tadId
  private mmrsByGenome = new Map<string, MerkleMountainRange>();
  private closedTadsByGenome = new Map<string, TAD[]>();
  private closedTadIdsSeen = new Set<string>();
  private followGraph = new FollowGraph();
  private supersededBy = new Map<string, string>(); // originalPostId -> newer postId

  saveGenome(genome: Genome): void {
    this.genomes.set(genome.genome, genome);
  }

  getGenome(genomeAddress: string): Genome | undefined {
    return this.genomes.get(genomeAddress);
  }

  hasGenome(genomeAddress: string): boolean {
    return this.genomes.has(genomeAddress);
  }

  getOpenTad(genomeAddress: string): TAD | undefined {
    const tadId = this.openTadByGenome.get(genomeAddress);
    if (!tadId) return undefined;
    const tad = this.tads.get(tadId);
    return tad && !tad.closed ? tad : undefined;
  }

  createTad(genomeAddress: string): TAD {
    const tad: TAD = {
      tadId: `${genomeAddress}.${globalThis.crypto.randomUUID()}`,
      genome: genomeAddress,
      merkleRootHex: '00'.repeat(32),
      posts: [],
      closed: false,
    };
    this.tads.set(tad.tadId, tad);
    this.openTadByGenome.set(genomeAddress, tad.tadId);
    return tad;
  }

  saveTad(tad: TAD): void {
    this.tads.set(tad.tadId, tad);
    if (!tad.closed) return;

    if (this.openTadByGenome.get(tad.genome) === tad.tadId) {
      this.openTadByGenome.delete(tad.genome);
    }
    if (!this.closedTadIdsSeen.has(tad.tadId)) {
      this.closedTadIdsSeen.add(tad.tadId);
      const list = this.closedTadsByGenome.get(tad.genome) ?? [];
      list.push(tad);
      this.closedTadsByGenome.set(tad.genome, list);
    }
  }

  getPost(postId: string): Helix | undefined {
    return this.posts.get(postId);
  }

  savePost(post: Helix, tad: TAD): void {
    this.posts.set(post.postId, post);
    if (post.recombinesPostId) {
      this.supersededBy.set(post.recombinesPostId, post.postId);
    }
    this.saveTad(tad);
  }

  isSuperseded(postId: string): boolean {
    return this.supersededBy.has(postId);
  }

  getCurrentVersion(postId: string): Helix | undefined {
    let id = postId;
    while (this.supersededBy.has(id)) {
      id = this.supersededBy.get(id)!;
    }
    return this.getPost(id);
  }

  getOrCreateMmr(genomeAddress: string): MerkleMountainRange {
    let mmr = this.mmrsByGenome.get(genomeAddress);
    if (!mmr) {
      mmr = new MerkleMountainRange();
      this.mmrsByGenome.set(genomeAddress, mmr);
    }
    return mmr;
  }

  getClosedTad(genomeAddress: string, tadIndex: number): TAD | undefined {
    return this.closedTadsByGenome.get(genomeAddress)?.[tadIndex];
  }

  getLatestPostForGenome(genomeAddress: string): Helix | undefined {
    const openTad = this.getOpenTad(genomeAddress);
    if (openTad && openTad.posts.length > 0) {
      return openTad.posts[openTad.posts.length - 1];
    }
    const closedTads = this.closedTadsByGenome.get(genomeAddress);
    const lastClosedTad = closedTads?.[closedTads.length - 1];
    return lastClosedTad?.posts[lastClosedTad.posts.length - 1];
  }

  getFollowGraph(): FollowGraph {
    return this.followGraph;
  }
}
