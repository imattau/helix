import { describe, expect, it } from 'vitest';
import { MemoryFileIO } from '@0xx0lostcause0xx0/polypack/persistence';
import { CID } from 'multiformats/cid';
import { Key } from 'interface-datastore/key';
import { FileIoBlockstore, FileIoDatastore } from '../../app/src/backend/ipfsPersistence.ts';

async function cidFor(bytes: Uint8Array): Promise<CID> {
  const { sha256 } = await import('multiformats/hashes/sha2');
  const raw = await import('multiformats/codecs/raw');
  const digest = await sha256.digest(bytes);
  return CID.createV1(raw.code, digest);
}

describe('FileIoBlockstore', () => {
  it('round-trips put/get/has/delete through a FileIO backend', async () => {
    const store = new FileIoBlockstore(new MemoryFileIO(), 1_000_000);
    const bytes = new TextEncoder().encode('hello block');
    const cid = await cidFor(bytes);

    await store.put(cid, bytes);
    expect(await store.has(cid)).toBe(true);

    const chunks: Uint8Array[] = [];
    for await (const chunk of store.get(cid)) chunks.push(chunk);
    expect(chunks[0]).toEqual(bytes);

    await store.delete(cid);
    expect(await store.has(cid)).toBe(false);
  });

  it('lists everything stored via getAll', async () => {
    const store = new FileIoBlockstore(new MemoryFileIO(), 1_000_000);
    const a = new TextEncoder().encode('aaa');
    const b = new TextEncoder().encode('bbb');
    const cidA = await cidFor(a);
    const cidB = await cidFor(b);
    await store.put(cidA, a);
    await store.put(cidB, b);

    const seen = new Set<string>();
    for await (const { cid } of store.getAll()) seen.add(cid.toString());
    expect(seen).toEqual(new Set([cidA.toString(), cidB.toString()]));
  });

  it('evicts the least-recently-accessed unpinned block once over the size cap, never a pinned one', async () => {
    const store = new FileIoBlockstore(new MemoryFileIO(), 1000);
    const a = new TextEncoder().encode('a'.repeat(400));
    const b = new TextEncoder().encode('b'.repeat(400));
    const c = new TextEncoder().encode('c'.repeat(400));
    const cidA = await cidFor(a);
    const cidB = await cidFor(b);
    const cidC = await cidFor(c);

    await store.put(cidA, a);
    await store.pin(cidA.toString());
    await store.put(cidB, b);
    await store.put(cidC, c); // pushes total over the 1000-byte cap

    expect(await store.has(cidA)).toBe(true); // pinned - never evicted
    expect(await store.has(cidB)).toBe(false); // unpinned and oldest - evicted
    expect(await store.has(cidC)).toBe(true); // newest
  });

  it('touching a block via get() refreshes its recency, protecting it from eviction over an untouched one', async () => {
    const store = new FileIoBlockstore(new MemoryFileIO(), 1000);
    const a = new TextEncoder().encode('a'.repeat(400));
    const b = new TextEncoder().encode('b'.repeat(400));
    const cidA = await cidFor(a);
    const cidB = await cidFor(b);

    await store.put(cidA, a);
    await store.put(cidB, b);
    for await (const _ of store.get(cidA)) {
      // touch A so it's now more recently accessed than B
    }

    const c = new TextEncoder().encode('c'.repeat(400));
    const cidC = await cidFor(c);
    await store.put(cidC, c); // over cap - B (now the oldest) should be evicted, not A

    expect(await store.has(cidA)).toBe(true);
    expect(await store.has(cidB)).toBe(false);
  });

  it('pin() on an unknown CID is a harmless no-op', async () => {
    const store = new FileIoBlockstore(new MemoryFileIO(), 1_000_000);
    const bytes = new TextEncoder().encode('never stored');
    const cid = await cidFor(bytes);
    await expect(store.pin(cid.toString())).resolves.toBeUndefined();
  });
});

describe('FileIoDatastore', () => {
  it('round-trips put/get/has/delete through a FileIO backend', async () => {
    const store = new FileIoDatastore(new MemoryFileIO());
    const key = new Key('/local/peer-id');
    const value = new TextEncoder().encode('some keychain bytes');

    await store.put(key, value);
    expect(await store.has(key)).toBe(true);
    expect(await store.get(key)).toEqual(value);

    await store.delete(key);
    expect(await store.has(key)).toBe(false);
  });

  it('enumerates stored keys via _all/_allKeys', async () => {
    const store = new FileIoDatastore(new MemoryFileIO());
    const keyA = new Key('/a');
    const keyB = new Key('/nested/b');
    await store.put(keyA, new TextEncoder().encode('one'));
    await store.put(keyB, new TextEncoder().encode('two'));

    const allKeys = new Set<string>();
    for await (const key of store._allKeys({} as never)) allKeys.add(key.toString());
    expect(allKeys).toEqual(new Set(['/a', '/nested/b']));

    const allValues = new Map<string, string>();
    for await (const { key, value } of store._all({} as never)) {
      allValues.set(key.toString(), new TextDecoder().decode(value));
    }
    expect(allValues.get('/a')).toBe('one');
    expect(allValues.get('/nested/b')).toBe('two');
  });
});
