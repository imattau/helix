import type { PersistenceAdapter, PersistenceChanges, PersistedNodeQuery } from "@0xx0lostcause0xx0/polypack";
import type { SerializedNode, SerializedEdge } from "@0xx0lostcause0xx0/polypack";

/**
 * Browser persistence for the app's PolyGraph stores backed by IndexedDB.
 *
 * This is the fallback that actually runs inside the packaged desktop app:
 * WebKitGTK (Tauri's Linux webview) does not ship the File System Access API
 * that OPFS relies on (`navigator.storage.getDirectory` is undefined there),
 * so the OPFS adapters silently no-op on the AppImage build and the feed was
 * lost on every restart. IndexedDB, by contrast, persists to disk on every
 * browser engine including WebKitGTK, so it keeps the feed/genomes/follows
 * across app restarts there. Kept as a separate module (rather than importing
 * polypack's internal one) because polypack doesn't export its IndexedDB
 * adapter through its package exports map.
 */
export class IndexedDbPersistenceAdapter implements PersistenceAdapter {
  private dbPromise?: Promise<IDBDatabase>;

  constructor(private readonly dbName: string) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = this.open();
    return this.dbPromise;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("nodes")) {
          const nodes = db.createObjectStore("nodes", { keyPath: "id" });
          nodes.createIndex("type", "type", { unique: false });
        }
        if (!db.objectStoreNames.contains("edges")) {
          const edges = db.createObjectStore("edges", { keyPath: "id" });
          edges.createIndex("source", "source", { unique: false });
          edges.createIndex("target", "target", { unique: false });
          edges.createIndex("type", "type", { unique: false });
        }
        if (!db.objectStoreNames.contains("vectors")) {
          db.createObjectStore("vectors", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private transaction(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private cursorAll(store: IDBObjectStore): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const results: unknown[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async applyChanges(changes: PersistenceChanges): Promise<void> {
    const database = await this.db();
    const tx = database.transaction(["nodes", "edges", "vectors"], "readwrite");
    const nodes = tx.objectStore("nodes");
    const edges = tx.objectStore("edges");
    const vectors = tx.objectStore("vectors");
    for (const id of changes.deleteNodeIds) nodes.delete(id);
    for (const id of changes.deleteEdgeIds) edges.delete(id);
    for (const id of changes.deleteVectorIds) vectors.delete(id);
    for (const node of changes.putNodes) nodes.put(node);
    for (const edge of changes.putEdges) edges.put(edge);
    for (const entry of changes.putVectors) vectors.put(entry);
    await this.transaction(tx);
  }

  async putNode(node: SerializedNode): Promise<void> {
    await this.bulkPutNodes([node]);
  }

  async bulkPutNodes(nodes: SerializedNode[]): Promise<void> {
    if (nodes.length === 0) return;
    const database = await this.db();
    const tx = database.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");
    for (const node of nodes) store.put(node);
    await this.transaction(tx);
  }

  async getNode(id: string): Promise<SerializedNode | undefined> {
    const database = await this.db();
    return this.request(database.transaction("nodes").objectStore("nodes").get(id) as IDBRequest<SerializedNode>);
  }

  async getNodes(ids: string[]): Promise<SerializedNode[]> {
    if (ids.length === 0) return [];
    const database = await this.db();
    const store = database.transaction("nodes").objectStore("nodes");
    const results = await Promise.all(ids.map((id) => this.request(store.get(id) as IDBRequest<SerializedNode>)));
    return results.filter((node): node is SerializedNode => node !== undefined);
  }

  async deleteNode(id: string): Promise<void> {
    await this.bulkDeleteNodes([id]);
  }

  async bulkDeleteNodes(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const database = await this.db();
    const tx = database.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");
    for (const id of ids) store.delete(id);
    await this.transaction(tx);
  }

  async allNodeIds(): Promise<string[]> {
    const database = await this.db();
    return new Promise((resolve, reject) => {
      const ids: string[] = [];
      const req = database.transaction("nodes").objectStore("nodes").openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          ids.push(cursor.primaryKey as string);
          cursor.continue();
        } else {
          resolve(ids);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async queryNodes(query: PersistedNodeQuery): Promise<SerializedNode[]> {
    const database = await this.db();
    const store = database.transaction("nodes").objectStore("nodes");
    const ids = query.nodeTypes && query.nodeTypes.length === 1 ? store.index("type") : undefined;
    const candidates = ids
      ? ((await this.request(ids.getAll(query.nodeTypes![0]))) as SerializedNode[])
      : ((await this.cursorAll(store)) as SerializedNode[]);
    return this.applyNodeQuery(candidates, query);
  }

  async countNodes(query: PersistedNodeQuery): Promise<number> {
    const onlySingleType =
      query.nodeTypes?.length === 1 && !query.attributes && !query.attributeRanges;
    if (onlySingleType) {
      const database = await this.db();
      const store = database.transaction("nodes").objectStore("nodes");
      return this.request(store.index("type").count(query.nodeTypes![0]) as IDBRequest<number>);
    }
    return (await this.queryNodes(query)).length;
  }

  private applyNodeQuery(nodes: SerializedNode[], query: PersistedNodeQuery): SerializedNode[] {
    let filtered = nodes;
    if (query.nodeTypes && query.nodeTypes.length > 0) {
      filtered = filtered.filter((n) => query.nodeTypes!.includes(n.type));
    }
    if (query.attributes) {
      filtered = filtered.filter((n) =>
        Object.entries(query.attributes!).every(([key, value]) => n.data[key] === value),
      );
    }
    if (query.attributeRanges) {
      filtered = filtered.filter((n) =>
        Object.entries(query.attributeRanges!).every(([key, range]) => {
          const v = n.data[key];
          if (typeof v !== "number") return false;
          if (range.above !== undefined && v <= range.above) return false;
          if (range.below !== undefined && v >= range.below) return false;
          return true;
        }),
      );
    }
    if (query.orderBy) {
      const { field, direction } = query.orderBy;
      filtered = [...filtered].sort((a, b) => {
        const av = a.data[field];
        const bv = b.data[field];
        const cmp = av === bv ? 0 : av === undefined ? -1 : bv === undefined ? 1 : av! > bv! ? 1 : -1;
        return direction === "asc" ? cmp : -cmp;
      });
    }
    const start = query.offset ?? 0;
    const end = query.limit !== undefined ? start + query.limit : undefined;
    return filtered.slice(start, end);
  }

  async putEdge(edge: SerializedEdge): Promise<void> {
    await this.bulkPutEdges([edge]);
  }

  async bulkPutEdges(edges: SerializedEdge[]): Promise<void> {
    if (edges.length === 0) return;
    const database = await this.db();
    const tx = database.transaction("edges", "readwrite");
    const store = tx.objectStore("edges");
    for (const edge of edges) store.put(edge);
    await this.transaction(tx);
  }

  async getAllEdges(): Promise<SerializedEdge[]> {
    const database = await this.db();
    return (await this.cursorAll(database.transaction("edges").objectStore("edges"))) as SerializedEdge[];
  }

  async getEdgesBySources(sources: string[], type?: string): Promise<SerializedEdge[]> {
    return this.edgesByIndex("source", sources, type);
  }

  async getEdgesByTargets(targets: string[], type?: string): Promise<SerializedEdge[]> {
    return this.edgesByIndex("target", targets, type);
  }

  private async edgesByIndex(indexName: string, values: string[], type?: string): Promise<SerializedEdge[]> {
    if (values.length === 0) return [];
    const database = await this.db();
    const index = database.transaction("edges").objectStore("edges").index(indexName);
    const groups = await Promise.all(
      [...new Set(values)].map((value) => this.request(index.getAll(value))),
    );
    const edges = groups.flat() as SerializedEdge[];
    return type === undefined ? edges : edges.filter((edge) => edge.type === type);
  }

  async deleteEdge(id: string): Promise<void> {
    await this.bulkDeleteEdges([id]);
  }

  async bulkDeleteEdges(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const database = await this.db();
    const tx = database.transaction("edges", "readwrite");
    const store = tx.objectStore("edges");
    for (const id of ids) store.delete(id);
    await this.transaction(tx);
  }

  async putVector(id: string, vector: number[]): Promise<void> {
    await this.bulkPutVectors([{ id, vector }]);
  }

  async bulkPutVectors(entries: Array<{ id: string; vector: number[] }>): Promise<void> {
    if (entries.length === 0) return;
    const database = await this.db();
    const tx = database.transaction("vectors", "readwrite");
    const store = tx.objectStore("vectors");
    for (const entry of entries) store.put(entry);
    await this.transaction(tx);
  }

  async deleteVector(id: string): Promise<void> {
    const database = await this.db();
    const tx = database.transaction("vectors", "readwrite");
    tx.objectStore("vectors").delete(id);
    await this.transaction(tx);
  }

  async getVectors(ids: string[]): Promise<Array<{ id: string; vector: number[] }>> {
    if (ids.length === 0) return [];
    const database = await this.db();
    const store = database.transaction("vectors").objectStore("vectors");
    const results = await Promise.all(
      ids.map((id) => this.request(store.get(id) as IDBRequest<{ id: string; vector: number[] }>)),
    );
    return results.filter((entry): entry is { id: string; vector: number[] } => entry !== undefined);
  }

  async getAllVectors(): Promise<Array<{ id: string; vector: number[] }>> {
    const database = await this.db();
    return (await this.cursorAll(database.transaction("vectors").objectStore("vectors"))) as Array<{
      id: string;
      vector: number[];
    }>;
  }

  async clearAll(): Promise<void> {
    const database = await this.db();
    const stores = ["nodes", "edges", "vectors"];
    const tx = database.transaction(stores, "readwrite");
    for (const store of stores) tx.objectStore(store).clear();
    await this.transaction(tx);
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    try {
      (await this.dbPromise).close();
    } catch {
      // Ignore close failures - the page is going away anyway.
    }
    this.dbPromise = undefined;
  }
}
