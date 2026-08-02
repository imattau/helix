import { describe, expect, it, afterEach } from 'vitest';
import type { Helia } from 'helia';
import {
  fetchAndVerifyAttachment,
  publishAttachmentToIpfs,
  fetchAndVerifyAttachmentFromIpfs,
  AttachmentVerificationError,
  toDataUrl,
} from '../../src/api/attachment.js';
import { createIpfsNode } from '../../src/ipfs/node.js';
import { sha256 } from '../../src/crypto/hash.js';
import { toHex } from '../../src/crypto/hex.js';
import type { Attachment } from '../../src/types/index.js';

function attachmentFor(bytes: Uint8Array, mimeType = 'text/markdown'): Attachment {
  return {
    hashHex: toHex(sha256(bytes)),
    mimeType,
    sizeBytes: bytes.length,
    sourceUrl: toDataUrl(bytes, mimeType),
  };
}

describe('fetchAndVerifyAttachment', () => {
  it('fetches and returns bytes that match the claimed hash and size', async () => {
    const bytes = new TextEncoder().encode('# Hello\n\nThis is a long-form markdown post.');
    const attachment = attachmentFor(bytes);

    const result = await fetchAndVerifyAttachment(attachment);
    expect(result).toEqual(bytes);
  });

  it('rejects a hash mismatch', async () => {
    const bytes = new TextEncoder().encode('original content');
    const attachment = attachmentFor(bytes);
    const tampered: Attachment = { ...attachment, hashHex: 'f'.repeat(64) };

    await expect(fetchAndVerifyAttachment(tampered)).rejects.toThrow(AttachmentVerificationError);
  });

  it('rejects a size mismatch', async () => {
    const bytes = new TextEncoder().encode('original content');
    const attachment = attachmentFor(bytes);
    const tampered: Attachment = { ...attachment, sizeBytes: attachment.sizeBytes + 1 };

    await expect(fetchAndVerifyAttachment(tampered)).rejects.toThrow(AttachmentVerificationError);
  });

  it('rejects content served from a URL that does not match the claimed hash', async () => {
    const originalBytes = new TextEncoder().encode('what the post claims');
    const swappedBytes = new TextEncoder().encode('what was actually served - swapped!');
    const attachment: Attachment = {
      ...attachmentFor(originalBytes),
      sourceUrl: toDataUrl(swappedBytes, 'text/markdown'),
      sizeBytes: swappedBytes.length, // size alone matching doesn't help - hash still catches it
    };

    await expect(fetchAndVerifyAttachment(attachment)).rejects.toThrow(AttachmentVerificationError);
  });
});

describe('publishAttachmentToIpfs / fetchAndVerifyAttachmentFromIpfs', () => {
  let node: Helia | undefined;

  afterEach(async () => {
    await node?.stop();
    node = undefined;
  });

  it('publishes and independently fetches+verifies bytes via a real (local) IPFS node', async () => {
    node = await createIpfsNode();
    const bytes = new TextEncoder().encode('# Long-form article\n\nPublished via IPFS, not a URL.');
    const ipfsCid = await publishAttachmentToIpfs(node, bytes);

    const attachment: Attachment = { ...attachmentFor(bytes), sourceUrl: '', ipfsCid };
    const result = await fetchAndVerifyAttachmentFromIpfs(node, attachment);

    expect(result).toEqual(bytes);
  });

  it('rejects an attachment with no ipfsCid', async () => {
    node = await createIpfsNode();
    const bytes = new TextEncoder().encode('no cid here');
    const attachment: Attachment = { ...attachmentFor(bytes), sourceUrl: '' };

    await expect(fetchAndVerifyAttachmentFromIpfs(node, attachment)).rejects.toThrow(AttachmentVerificationError);
  });

  it('rejects a hash mismatch even when the CID resolves successfully', async () => {
    node = await createIpfsNode();
    const bytes = new TextEncoder().encode('real content');
    const ipfsCid = await publishAttachmentToIpfs(node, bytes);

    const tampered: Attachment = { ...attachmentFor(bytes), sourceUrl: '', ipfsCid, hashHex: 'f'.repeat(64) };
    await expect(fetchAndVerifyAttachmentFromIpfs(node, tampered)).rejects.toThrow(AttachmentVerificationError);
  });
});
