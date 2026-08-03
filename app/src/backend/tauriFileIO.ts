import { readFile, writeFile, remove, exists, mkdir } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";
import type { FileIO } from "@0xx0lostcause0xx0/polypack/persistence";

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /(no such file|not found|ENOENT|entity not found|os error 2)/i.test(err.message);
}

/**
 * A polypack FileIO backed by Tauri's filesystem plugin, so the desktop app's
 * graph stores live as real files under the OS app-data directory instead of
 * inside webview storage. This is the same snapshot+WAL store the CLI uses
 * (BinaryStoreAdapter), just with a different FileIO - see src/cli/peer.ts.
 * Relative to BaseDirectory.AppData, which on Linux is
 * ~/.local/share/com.lostcause.helix/, on macOS ~/Library/Application
 * Support/com.lostcause.helix/, and on Windows %APPDATA%\com.lostcause.helix\.
 * Requires the fs:allow-appdata-write-recursive capability (see
 * src-tauri/capabilities/default.json).
 */
export class TauriFileIO implements FileIO {
  private ensureDirPromise?: Promise<void>;

  constructor(private readonly storeDir: string) {}

  private path(name: string): string {
    return `${this.storeDir}/${name}`;
  }

  async readFile(name: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.path(name), { baseDir: BaseDirectory.AppData });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async writeFile(name: string, data: Uint8Array): Promise<void> {
    await this.ensureDir();
    await writeFile(this.path(name), data, { baseDir: BaseDirectory.AppData });
  }

  async appendFile(name: string, data: Uint8Array): Promise<void> {
    await this.ensureDir();
    await writeFile(this.path(name), data, { baseDir: BaseDirectory.AppData, append: true });
  }

  async deleteFile(name: string): Promise<void> {
    try {
      await remove(this.path(name), { baseDir: BaseDirectory.AppData });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async fileExists(name: string): Promise<boolean> {
    return exists(this.path(name), { baseDir: BaseDirectory.AppData });
  }

  private ensureDir(): Promise<void> {
    if (!this.ensureDirPromise) {
      this.ensureDirPromise = mkdir(this.storeDir, { baseDir: BaseDirectory.AppData, recursive: true }).catch(
        (err) => {
          this.ensureDirPromise = undefined;
          throw err;
        },
      );
    }
    return this.ensureDirPromise;
  }
}
