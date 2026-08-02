import { describe, expect, it } from 'vitest';
import { fetchAndVerifyAttachment, AttachmentVerificationError, toDataUrl } from '../../src/api/attachment.js';
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
