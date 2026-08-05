import type { FileIO } from "@0xx0lostcause0xx0/polypack/persistence";
import { MemoryFileIO } from "@0xx0lostcause0xx0/polypack/persistence";
import { BaseBlockstore } from "blockstore-core/base";
import { BaseDatastore } from "datastore-core/base";
import { NotFoundError } from "interface-store";
import { CID } from "multiformats/cid";
import { Key } from "interface-datastore/key";
import type { AbortOptions } from "abort-error";
import type { Pair as BlockPair } from "interface-blockstore";
import type { Pair as DatastorePair } from "interface-datastore";
import { generateKeyPair, privateKeyFromRaw } from "@libp2p/crypto/keys";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
// Relative, not the `@helix` alias other app/src/backend files use (e.g. identity.ts) -
// this file is also imported directly by a root-level test
// (test/backend/ipfsPersistence.test.ts), which type-checks under the root tsconfig
// (Node-oriented, no `@helix` path mapping, no DOM lib - see the navigator guard
// below too), not app's own (browser-oriented) one.
import { toHex, fromHex } from "../../../src/crypto/hex.js";
import { isTauri } from "./platform.js";

const INDEX_FILE = "_index.json";

interface BlockIndexEntry {
  size: number;
  /** A monotonic counter, not a wall-clock timestamp - Date.now()'s millisecond
   *  resolution isn't fine enough to order two accesses that land in the same tick
   *  (e.g. two blocks fetched back to back), which would make eviction pick an
   *  arbitrary one of them rather than the genuinely older one. */
  accessSeq: number;
  pinned: boolean;
}

/** Encodes a datastore Key's path string into a flat, filesystem-safe filename - a
 *  key like `/local` or `/peers/12D3Koo...` must never be handed to FileIO as-is,
 *  since an embedded `/` would silently attempt to create a subdirectory FileIO's
 *  writeFile doesn't necessarily auto-create (TauriFileIO's ensureDir only covers its
 *  own top-level storeDir). Hex-encoding the UTF-8 bytes is unambiguous and always flat. */
function encodeDatastoreKey(key: Key): string {
  const bytes = new TextEncoder().encode(key.toString());
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A Helia Blockstore backed by any FileIO (TauriFileIO, polypack's OPFSFileIO, or
 * MemoryFileIO as the final fallback) - see createPersistentIpfsStorage() below. Reuses
 * this project's existing multi-platform file persistence rather than pulling in a
 * third-party blockstore-idb/blockstore-fs dependency neither of which fits this
 * project's actual storage backends (Tauri FS, OPFS).
 *
 * Tracks size/accessSeq/pinned per CID in a companion `_index.json` (FileIO has no
 * directory listing, so this is also how getAll() enumerates what's stored) and
 * enforces `maxBytes` by evicting the least-recently-accessed *unpinned* entries first
 * - pinned entries (this device's own published attachments - see client.ts) are never
 * evicted, even if that pushes total usage over `maxBytes`; the cap only bounds the
 * unbounded part (content reseeded from other peers' posts).
 */
export class FileIoBlockstore extends BaseBlockstore {
  private index?: Record<string, BlockIndexEntry>;
  private accessCounter = 0;

  constructor(
    private readonly fileIO: FileIO,
    private readonly maxBytes: number,
  ) {
    super();
  }

  private async loadIndex(): Promise<Record<string, BlockIndexEntry>> {
    if (this.index) return this.index;
    const raw = await this.fileIO.readFile(INDEX_FILE);
    this.index = raw ? (JSON.parse(new TextDecoder().decode(raw)) as Record<string, BlockIndexEntry>) : {};
    return this.index;
  }

  private async saveIndex(): Promise<void> {
    if (!this.index) return;
    await this.fileIO.writeFile(INDEX_FILE, new TextEncoder().encode(JSON.stringify(this.index)));
  }

  async put(key: CID, val: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>, options?: AbortOptions): Promise<CID> {
    options?.signal?.throwIfAborted();
    const bytes = val instanceof Uint8Array ? val : concatChunks(await collect(val));
    const cidStr = key.toString();
    await this.fileIO.writeFile(cidStr, bytes);
    const index = await this.loadIndex();
    index[cidStr] = { size: bytes.length, accessSeq: ++this.accessCounter, pinned: index[cidStr]?.pinned ?? false };
    await this.saveIndex();
    await this.evictToFit();
    return key;
  }

  async *get(key: CID, options?: AbortOptions): AsyncGenerator<Uint8Array> {
    options?.signal?.throwIfAborted();
    const cidStr = key.toString();
    const bytes = await this.fileIO.readFile(cidStr);
    if (bytes === null) throw new NotFoundError();
    const index = await this.loadIndex();
    if (index[cidStr]) {
      index[cidStr].accessSeq = ++this.accessCounter;
      await this.saveIndex();
    }
    yield bytes;
  }

  async has(key: CID, options?: AbortOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    return this.fileIO.fileExists(key.toString());
  }

  async delete(key: CID, options?: AbortOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const cidStr = key.toString();
    await this.fileIO.deleteFile(cidStr);
    const index = await this.loadIndex();
    delete index[cidStr];
    await this.saveIndex();
  }

  async *getAll(options?: AbortOptions): AsyncGenerator<BlockPair> {
    options?.signal?.throwIfAborted();
    const index = await this.loadIndex();
    for (const cidStr of Object.keys(index)) {
      const bytes = await this.fileIO.readFile(cidStr);
      if (bytes === null) continue;
      yield { cid: CID.parse(cidStr), bytes: (async function* () { yield bytes; })() };
      options?.signal?.throwIfAborted();
    }
  }

  /** Marks a CID as pinned (never evicted) - used for this device's own published
   *  attachments, so the author always stays at least one durable seed for their own
   *  content regardless of the reseed cache's eviction pressure. */
  async pin(cidStr: string): Promise<void> {
    const index = await this.loadIndex();
    if (!index[cidStr]) return;
    index[cidStr].pinned = true;
    await this.saveIndex();
  }

  private async evictToFit(): Promise<void> {
    const index = await this.loadIndex();
    const entries = Object.entries(index);
    let total = entries.reduce((sum, [, e]) => sum + e.size, 0);
    if (total <= this.maxBytes) return;

    const unpinned = entries.filter(([, e]) => !e.pinned).sort((a, b) => a[1].accessSeq - b[1].accessSeq);
    for (const [cidStr, entry] of unpinned) {
      if (total <= this.maxBytes) break;
      await this.fileIO.deleteFile(cidStr).catch(() => {});
      delete index[cidStr];
      total -= entry.size;
    }
    await this.saveIndex();
  }
}

/** Same FileIO-backed pattern as FileIoBlockstore, for Helia/libp2p's small keychain
 *  bookkeeping (not attachment content) - no eviction, this data is never large. */
export class FileIoDatastore extends BaseDatastore {
  private keys?: Set<string>;

  constructor(private readonly fileIO: FileIO) {
    super();
  }

  private async loadKeys(): Promise<Set<string>> {
    if (this.keys) return this.keys;
    const raw = await this.fileIO.readFile(INDEX_FILE);
    this.keys = new Set(raw ? (JSON.parse(new TextDecoder().decode(raw)) as string[]) : []);
    return this.keys;
  }

  private async saveKeys(): Promise<void> {
    if (!this.keys) return;
    await this.fileIO.writeFile(INDEX_FILE, new TextEncoder().encode(JSON.stringify([...this.keys])));
  }

  // Key/Query/KeyQuery params below are typed `any` rather than their nominal
  // interface-datastore types: datastore-core's own published .d.ts resolves those
  // types against a *different* nested copy of interface-datastore (under
  // @ipshipyard/keychain) than the one this file's `Key` import resolves to - a
  // harmless cross-version duplicate-package artifact (same class as the casts in
  // src/ipfs/node.ts), not a real behavioral incompatibility, since `Key`'s own
  // behavior (`.toString()` etc.) is identical either way.
  async put(key: any, val: Uint8Array, options?: AbortOptions): Promise<any> {
    options?.signal?.throwIfAborted();
    await this.fileIO.writeFile(encodeDatastoreKey(key), val);
    const keys = await this.loadKeys();
    if (!keys.has(key.toString())) {
      keys.add(key.toString());
      await this.saveKeys();
    }
    return key;
  }

  async get(key: any, options?: AbortOptions): Promise<Uint8Array> {
    options?.signal?.throwIfAborted();
    const bytes = await this.fileIO.readFile(encodeDatastoreKey(key));
    if (bytes === null) throw new NotFoundError();
    return bytes;
  }

  async has(key: any, options?: AbortOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    return this.fileIO.fileExists(encodeDatastoreKey(key));
  }

  async delete(key: any, options?: AbortOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    await this.fileIO.deleteFile(encodeDatastoreKey(key));
    const keys = await this.loadKeys();
    if (keys.delete(key.toString())) await this.saveKeys();
  }

  async *_all(_q: any, options?: AbortOptions): AsyncGenerator<any> {
    options?.signal?.throwIfAborted();
    const keys = await this.loadKeys();
    for (const keyStr of keys) {
      const key = new Key(keyStr);
      const bytes = await this.fileIO.readFile(encodeDatastoreKey(key));
      if (bytes === null) continue;
      yield { key, value: bytes } as DatastorePair;
      options?.signal?.throwIfAborted();
    }
  }

  async *_allKeys(_q: any, options?: AbortOptions): AsyncGenerator<any> {
    options?.signal?.throwIfAborted();
    const keys = await this.loadKeys();
    for (const keyStr of keys) {
      yield new Key(keyStr);
      options?.signal?.throwIfAborted();
    }
  }
}

async function collect(source: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * A stable Ed25519 keypair for the device's Helia node, persisted separately from the
 * main Helix identity (identity.ts) - the two are architecturally independent nodes
 * (see src/ipfs/node.ts) and don't need to share a key, but each still needs its OWN
 * key to survive restarts. Namespaced by the main identity so a device holding
 * multiple Helix identities (e.g. after Log Out + restore - see identity.ts's
 * restoreIdentity) gets a distinct, consistent IPFS identity per Helix identity rather
 * than either sharing one or regenerating on every switch.
 */
export async function loadOrCreateIpfsPrivateKey(namespace: string): Promise<{ privateKey: unknown; peerId: string }> {
  const storageKey = `helix.ipfs.${namespace}.privateKeyHex`;
  const storedHex = localStorage.getItem(storageKey);
  const privateKey = storedHex ? privateKeyFromRaw(fromHex(storedHex)) : await generateKeyPair("Ed25519");
  if (!storedHex) localStorage.setItem(storageKey, toHex(privateKey.raw));
  // peerIdFromPrivateKey is the same @libp2p/peer-id already used by identity.ts for
  // the main identity - safe to call on this key without the usual cross-version
  // casting dance, since both this key and that function come from our top-level
  // (v2-pinned) @libp2p/* packages, not Helia's nested v3 ones. Statically imported,
  // not dynamically - @libp2p/peer-id is already pulled into the main bundle by many
  // other statically-imported modules, so deferring it here achieves no code-splitting
  // benefit, just a pointless "already in another chunk" build warning.
  return { privateKey, peerId: peerIdFromPrivateKey(privateKey).toString() };
}

/** Default cap on the *unpinned* (reseed-cache) portion of local attachment storage -
 *  see FileIoBlockstore's pin/evict doc comment. This device's own published
 *  attachments are pinned separately and don't count against it. */
const DEFAULT_MAX_CACHE_BYTES = 750 * 1024 * 1024;

async function createFileIO(storeName: string): Promise<FileIO | undefined> {
  if (isTauri()) {
    // Dynamically imported, not statically - same reasoning as polypackPersistence.ts:
    // this pulls in @tauri-apps/plugin-fs, which a plain browser build has no reason to
    // ever load into its main bundle.
    const { TauriFileIO } = await import("./tauriFileIO.js");
    return new TauriFileIO(storeName);
  }
  // Cast rather than rely on DOM's `Navigator` type - this file is also type-checked
  // under the root tsconfig (see the import comment above), which has no DOM lib and
  // (via @types/node's own minimal `navigator` global) types `navigator` as `unknown`.
  const nav = navigator as unknown as { storage?: { getDirectory?: () => unknown } } | undefined;
  if (nav && typeof nav.storage?.getDirectory === "function") {
    const { OPFSFileIO } = await import("@0xx0lostcause0xx0/polypack/persistence/opfs");
    return OPFSFileIO.create(storeName);
  }
  return undefined;
}

/**
 * Persistent Helia storage for a given identity namespace, most-native first (Tauri
 * FS, then OPFS), falling back to MemoryFileIO (today's in-memory behavior, nothing
 * survives a restart) only when neither is available - notably a plain browser tab
 * without the File System Access API. No IndexedDB tier here (unlike
 * polypackPersistence.ts's three-tier fallback for the main post store) - this is a
 * bounded, evictable cache rather than data that must never silently vanish, so the
 * added complexity of a fourth backend wasn't judged worth it for this pass.
 */
export async function createPersistentIpfsStorage(
  namespace: string,
  maxCacheBytes = DEFAULT_MAX_CACHE_BYTES,
): Promise<{ blockstore: FileIoBlockstore; datastore: FileIoDatastore }> {
  // Separate directories, not just separate instances - both classes use the same
  // `_index.json` filename for their own (incompatible) index format, so sharing one
  // FileIO/directory between them would have the datastore's key-list clobber the
  // blockstore's size/accessSeq/pinned index or vice versa.
  const [blocksFileIO, dataFileIO] = await Promise.all([
    createFileIO(`helix-${namespace}-ipfs-blocks`).catch(() => undefined),
    createFileIO(`helix-${namespace}-ipfs-data`).catch(() => undefined),
  ]);
  return {
    blockstore: new FileIoBlockstore(blocksFileIO ?? new MemoryFileIO(), maxCacheBytes),
    datastore: new FileIoDatastore(dataFileIO ?? new MemoryFileIO()),
  };
}
