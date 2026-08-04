import { describe, expect, it } from 'vitest';
import { BinaryStoreAdapter } from '@0xx0lostcause0xx0/polypack/persistence/opfs';
import type { SerializedNode } from '@0xx0lostcause0xx0/polypack';
import { TauriFileIO, type TauriFs } from '../../app/src/backend/tauriFileIO.ts';

/**
 * In-memory fake for @tauri-apps/plugin-fs. Deliberately throws Tauri-style
 * PLAIN STRINGS (not Error instances) for missing files - the exact shape
 * Tauri's IPC rejects with, which is what broke first-load on device.
 */
function makeFakeFs(files: Map<string, Uint8Array>): TauriFs {
  return {
    async readFile(path: string): Promise<Uint8Array> {
      const bytes = files.get(path);
      if (bytes === undefined) {
        throw `failed to open file at path: ${path} with error: No such file or directory (os error 2)`;
      }
      return new Uint8Array(bytes);
    },
    async writeFile(path: string, data: Uint8Array, options?: Record<string, unknown>): Promise<void> {
      if (options?.append) {
        const existing = files.get(path) ?? new Uint8Array(0);
        const combined = new Uint8Array(existing.length + data.length);
        combined.set(existing);
        combined.set(data, existing.length);
        files.set(path, combined);
      } else {
        files.set(path, new Uint8Array(data));
      }
    },
    async remove(path: string): Promise<void> {
      if (!files.delete(path)) {
        throw `failed to remove file at path: ${path} with error: No such file or directory (os error 2)`;
      }
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async mkdir(): Promise<void> {
      // Directories are implicit in the in-memory fake.
    },
  };
}

describe('TauriFileIO (first-load / initialization path)', () => {
  it('returns null for a missing file on first load instead of throwing', async () => {
    const io = new TauriFileIO('helix-store', makeFakeFs(new Map()));
    // Fresh install: no snapshot/WAL exists yet. This used to reject with a
    // Tauri string error and kill app startup.
    expect(await io.readFile('snapshot.msgpack')).toBeNull();
    expect(await io.readFile('wal.msgpack')).toBeNull();
  });

  it('round-trips a file through write/read and appends', async () => {
    const io = new TauriFileIO('helix-store', makeFakeFs(new Map()));
    expect(await io.fileExists('a.bin')).toBe(false);
    await io.writeFile('a.bin', new Uint8Array([1, 2, 3]));
    expect(await io.fileExists('a.bin')).toBe(true);
    const written = await io.readFile('a.bin');
    expect(written).not.toBeNull();
    expect([...written!]).toEqual([1, 2, 3]);

    await io.appendFile('a.bin', new Uint8Array([4, 5]));
    const appended = await io.readFile('a.bin');
    expect(appended).not.toBeNull();
    expect([...appended!]).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignores deleting a file that does not exist', async () => {
    const io = new TauriFileIO('helix-store', makeFakeFs(new Map()));
    await expect(io.deleteFile('missing.msgpack')).resolves.toBeUndefined();
  });

  it('survives a full first-load -> write -> restart-reload cycle through BinaryStoreAdapter', async () => {
    const files = new Map<string, Uint8Array>();
    // "First load": a brand-new store over the (empty) filesystem.
    const first = new BinaryStoreAdapter({ storeDir: 'helix-store', fileIO: new TauriFileIO('helix-store', makeFakeFs(files)) });
    expect(await first.allNodeIds()).toEqual([]);
    expect(await first.getAllEdges()).toEqual([]);

    const node: SerializedNode = {
      id: 'post:p1',
      type: 'post',
      data: { genome: 'G0', content: 'hello' },
      vector: null,
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await first.bulkPutNodes([node]);
    // close() compacts the WAL into a snapshot file.
    await first.close();

    // "Restart": a fresh adapter + fresh TauriFileIO over the same filesystem.
    const second = new BinaryStoreAdapter({ storeDir: 'helix-store', fileIO: new TauriFileIO('helix-store', makeFakeFs(files)) });
    expect(await second.allNodeIds()).toEqual(['post:p1']);
    const restored = await second.getNode('post:p1');
    expect(restored?.data).toEqual({ genome: 'G0', content: 'hello' });
    await second.close();
  });
});
