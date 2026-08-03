import { PolyGraph } from "@0xx0lostcause0xx0/polypack";
import type { PersistenceAdapter } from "@0xx0lostcause0xx0/polypack";

const NODE_TYPE_POST = "post";
const NODE_TYPE_USER = "user";
/** Cosine similarity floor for the word-hashed embedding below - low, since
 *  short queries against longer post bodies naturally score lower than an
 *  exact-title match would. Filters out unrelated noise, not near-misses. */
const SIMILARITY_THRESHOLD = 0.08;

interface PostSearchData {
  [key: string]: unknown;
  postId: string;
}

interface UserSearchData {
  [key: string]: unknown;
  genome: string;
}

/**
 * Full-text search over posts and display names, built on PolyPack's
 * dependency-free FeatureHashEmbedding (word-hashed bag-of-words, cosine
 * similarity) - same graph engine as FollowGraph/PeakGraph, no model
 * download, works fully offline in the browser. Lives at the app layer
 * (not src/store) because `displayName` is an app-layer convention (see
 * client.ts's ProfileContent), not a protocol field - this index only ever
 * sees plain strings its callers hand it.
 */
export class SearchIndex {
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
    this.graph.flush().catch((err) => console.error("[helix] failed to persist search index", err));
  }

  /** Indexes (or, called again with the same postId, re-indexes) a post's searchable text. */
  async indexPost(postId: string, content: string): Promise<void> {
    if (!content.trim()) return;
    const data: PostSearchData = { postId };
    await this.graph.addNodeWithEmbedding(
      { id: `post:${postId}`, type: NODE_TYPE_POST, data, insertedAt: Date.now(), updatedAt: Date.now() },
      content,
    );
    this.flushSoon();
  }

  /** Indexes (or, called again for the same genome, re-indexes on a profile edit) a display name. */
  async indexUser(genome: string, displayName: string): Promise<void> {
    if (!displayName.trim()) return;
    const data: UserSearchData = { genome };
    await this.graph.addNodeWithEmbedding(
      { id: `user:${genome}`, type: NODE_TYPE_USER, data, insertedAt: Date.now(), updatedAt: Date.now() },
      displayName,
    );
    this.flushSoon();
  }

  async search(text: string, limit = 20): Promise<{ postIds: string[]; genomes: string[] }> {
    const trimmed = text.trim();
    if (!trimmed) return { postIds: [], genomes: [] };

    const vector = [...(await this.graph.embed(trimmed))];
    const posts = this.graph.query().similarTo(vector, SIMILARITY_THRESHOLD).whereNodeType(NODE_TYPE_POST).limit(limit).toArray();
    const users = this.graph.query().similarTo(vector, SIMILARITY_THRESHOLD).whereNodeType(NODE_TYPE_USER).limit(limit).toArray();

    return {
      postIds: posts.map((n) => (n.data as PostSearchData).postId),
      genomes: users.map((n) => (n.data as UserSearchData).genome),
    };
  }
}
