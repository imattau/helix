import type { PersistenceAdapter } from "@0xx0lostcause0xx0/polypack";

async function createOpfsAdapter(storeName: string): Promise<PersistenceAdapter | undefined> {
  if (!("storage" in navigator) || typeof navigator.storage.getDirectory !== "function") return undefined;

  const { BinaryStoreAdapter, OPFSFileIO } = await import("@0xx0lostcause0xx0/polypack/persistence/opfs");
  const fileIO = await OPFSFileIO.create(storeName);
  return new BinaryStoreAdapter({ storeDir: storeName, fileIO });
}

export async function createBrowserPolyPackAdapters(namespace: string): Promise<{
  storeAdapter?: PersistenceAdapter;
  followGraphAdapter?: PersistenceAdapter;
  peakGraphAdapter?: PersistenceAdapter;
  searchIndexAdapter?: PersistenceAdapter;
}> {
  const prefix = `helix-${namespace}`;
  try {
    const [storeAdapter, followGraphAdapter, peakGraphAdapter, searchIndexAdapter] = await Promise.all([
      createOpfsAdapter(`${prefix}-store`),
      createOpfsAdapter(`${prefix}-follow-graph`),
      createOpfsAdapter(`${prefix}-peak-graph`),
      createOpfsAdapter(`${prefix}-search-index`),
    ]);
    return { storeAdapter, followGraphAdapter, peakGraphAdapter, searchIndexAdapter };
  } catch (err) {
    console.warn("[helix] PolyPack OPFS persistence unavailable; using in-memory graphs", err);
    return {};
  }
}
