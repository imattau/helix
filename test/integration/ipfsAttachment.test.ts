import { describe, expect, it, beforeEach, afterEach } from 'vitest';
// Helia's own libp2p is on @libp2p/interface v3 (nested @multiformats/multiaddr v13),
// distinct from our main Helix node's pinned v12 - this aliased import gets a
// version-matching Multiaddr, since libp2p.dial() has no plain-string overload.
import { multiaddr } from '@multiformats/multiaddr-v13';
import { createIpfsNode, type IpfsNode } from '../../src/ipfs/node.js';
import { publishAttachmentToIpfs, fetchAndVerifyAttachmentFromIpfs, AttachmentVerificationError } from '../../src/api/attachment.js';
import { sha256 } from '../../src/crypto/hash.js';
import { toHex } from '../../src/crypto/hex.js';
import type { Attachment } from '../../src/types/index.js';

describe('IPFS attachment transfer between two independent Helia nodes', () => {
  let alice: IpfsNode;
  let bob: IpfsNode;

  beforeEach(async () => {
    [alice, bob] = await Promise.all([createIpfsNode(), createIpfsNode()]);

    // explicit dial, same deterministic pattern as the libp2p integration tests -
    // no reliance on mDNS discovery timing in the automated suite
    const bobAddr = bob.libp2p
      .getMultiaddrs()
      .find((addr) => addr.toString().includes('127.0.0.1') && addr.toString().includes('/tcp/') && !addr.toString().includes('/ws'));
    if (!bobAddr) throw new Error('bob has no plain-TCP loopback multiaddr to dial');
    await alice.libp2p.dial(multiaddr(bobAddr.toString()));
  });

  afterEach(async () => {
    await Promise.all([alice.stop(), bob.stop()]);
  });

  it('lets bob fetch and verify an attachment alice published, via real bitswap - not local storage', async () => {
    const bytes = new TextEncoder().encode(
      '# A long-form article\n\nPublished to IPFS by alice, fetched by bob over real peer-to-peer bitswap.',
    );
    const ipfsCid = await publishAttachmentToIpfs(alice, bytes);

    const attachment: Attachment = {
      hashHex: toHex(sha256(bytes)),
      mimeType: 'text/markdown',
      sizeBytes: bytes.length,
      sourceUrl: '', // not used for this transport
      ipfsCid,
    };

    // bob's own node never had these bytes locally - this must go over the wire
    const fetched = await fetchAndVerifyAttachmentFromIpfs(bob, attachment);
    expect(fetched).toEqual(bytes);
  });

  it('bob rejects a tampered hash even though the CID resolves and transfers correctly', async () => {
    const bytes = new TextEncoder().encode('genuine content published by alice');
    const ipfsCid = await publishAttachmentToIpfs(alice, bytes);

    const tampered: Attachment = {
      hashHex: 'f'.repeat(64), // doesn't match the real bytes
      mimeType: 'text/markdown',
      sizeBytes: bytes.length,
      sourceUrl: '',
      ipfsCid,
    };

    await expect(fetchAndVerifyAttachmentFromIpfs(bob, tampered)).rejects.toThrow(AttachmentVerificationError);
  });
});
