import { describe, expect, it, afterEach } from 'vitest';
import { unixfs } from '@helia/unixfs';
import type { Helia } from 'helia';
import { createIpfsNode } from '../../src/ipfs/node.js';

describe('createIpfsNode', () => {
  let node: Helia | undefined;

  afterEach(async () => {
    await node?.stop();
    node = undefined;
  });

  it('stores and retrieves bytes by CID', async () => {
    node = await createIpfsNode();
    const fs = unixfs(node);
    const bytes = new TextEncoder().encode('hello ipfs, this is a round-trip test');

    const cid = await fs.addBytes(bytes);

    const chunks: Uint8Array[] = [];
    for await (const chunk of fs.cat(cid)) chunks.push(chunk);
    const result = Buffer.concat(chunks);

    expect(new Uint8Array(result)).toEqual(bytes);
  });

  it('produces a deterministic CID for the same bytes', async () => {
    node = await createIpfsNode();
    const fs = unixfs(node);
    const bytes = new TextEncoder().encode('deterministic content');

    const cid1 = await fs.addBytes(bytes);
    const cid2 = await fs.addBytes(bytes);

    expect(cid1.toString()).toBe(cid2.toString());
  });
});
