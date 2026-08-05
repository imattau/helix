import type { PersistenceAdapter } from "@0xx0lostcause0xx0/polypack";
import { IndexedDbPersistenceAdapter } from "./indexedDbPersistence";
import { isTauri } from "./platform";

async function createTauriFsAdapter(storeName: string): Promise<PersistenceAdapter | undefined> {
  const { BinaryStoreAdapter } = await import("@0xx0lostcause0xx0/polypack/persistence/opfs");
  const { TauriFileIO } = await import("./tauriFileIO");
  return new BinaryStoreAdapter({ storeDir: storeName, fileIO: new TauriFileIO(storeName) });
}

async function createOpfsAdapter(storeName: string): Promise<PersistenceAdapter | undefined> {
  if (!("storage" in navigator) || typeof navigator.storage.getDirectory !== "function") return undefined;

  const { BinaryStoreAdapter, OPFSFileIO } = await import("@0xx0lostcause0xx0/polypack/persistence/opfs");
  const fileIO = await OPFSFileIO.create(storeName);
  return new BinaryStoreAdapter({ storeDir: storeName, fileIO });
}

/** IndexedDB needs no availability probe beyond the API existing - every browser
 *  engine (including WebKitGTK) persists it to disk. Kept separate from OPFS so a
 *  per-store OPFS failure doesn't silently drop the other stores. */
async function createIndexedDbAdapter(storeName: string): Promise<PersistenceAdapter | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  return new IndexedDbPersistenceAdapter(storeName);
}

/**
 * Picks a persistence backend per environment, most-native first:
 *
 * 1. Tauri desktop app -> real files under the OS app-data directory via
 *    @tauri-apps/plugin-fs (same snapshot+WAL BinaryStoreAdapter the CLI uses).
 * 2. Browser with the File System Access API (modern Chrome/Firefox/Safari) ->
 *    OPFS, a durable snapshot+WAL store.
 * 3. Anything else (notably WebKitGTK, Tauri's Linux webview, which doesn't ship
 *    that API yet) -> IndexedDB, which every engine persists to disk.
 *
 * Without 1 or 3 the AppImage build fell back to in-memory graphs and the feed
 * was lost on every restart.
 */
async function createAdapter(storeName: string): Promise<PersistenceAdapter | undefined> {
  if (isTauri()) {
    const tauri = await createTauriFsAdapter(storeName);
    if (tauri) return tauri;
  }
  const opfs = await createOpfsAdapter(storeName);
  if (opfs) return opfs;
  return createIndexedDbAdapter(storeName);
}

export async function createBrowserPolyPackAdapters(namespace: string): Promise<{
  storeAdapter?: PersistenceAdapter;
  followGraphAdapter?: PersistenceAdapter;
  blockGraphAdapter?: PersistenceAdapter;
  peakGraphAdapter?: PersistenceAdapter;
  searchIndexAdapter?: PersistenceAdapter;
}> {
  const prefix = `helix-${namespace}`;
  try {
    const [storeAdapter, followGraphAdapter, blockGraphAdapter, peakGraphAdapter, searchIndexAdapter] = await Promise.all([
      createAdapter(`${prefix}-store`),
      createAdapter(`${prefix}-follow-graph`),
      createAdapter(`${prefix}-block-graph`),
      createAdapter(`${prefix}-peak-graph`),
      createAdapter(`${prefix}-search-index`),
    ]);
    return { storeAdapter, followGraphAdapter, blockGraphAdapter, peakGraphAdapter, searchIndexAdapter };
  } catch (err) {
    console.warn("[helix] PolyPack persistence unavailable; using in-memory graphs", err);
    return {};
  }
}
