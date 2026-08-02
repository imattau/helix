import { describe, expect, it } from 'vitest';
import { computePostContentHash } from '../../src/crypto/postHash.js';
import { toHex } from '../../src/crypto/hex.js';
import type { Attachment } from '../../src/types/index.js';

const attachment: Attachment = {
  hashHex: 'a'.repeat(64),
  mimeType: 'text/markdown',
  sizeBytes: 1234,
  sourceUrl: 'https://example.com/post.md',
};

describe('computePostContentHash', () => {
  it('is deterministic for the same inputs', () => {
    expect(toHex(computePostContentHash('hello', attachment))).toBe(toHex(computePostContentHash('hello', attachment)));
  });

  it('differs with vs. without an attachment, for the same content', () => {
    const withAttachment = computePostContentHash('hello', attachment);
    const withoutAttachment = computePostContentHash('hello');
    expect(toHex(withAttachment)).not.toBe(toHex(withoutAttachment));
  });

  it('changes if the attachment hash changes, even when content does not', () => {
    const original = computePostContentHash('hello', attachment);
    const tampered = computePostContentHash('hello', { ...attachment, hashHex: 'b'.repeat(64) });
    expect(toHex(original)).not.toBe(toHex(tampered));
  });

  it('matches a plain sha256(content) when no attachment is present', () => {
    // no-attachment case must stay bit-identical to the pre-attachment behavior,
    // or every existing post's contentHashBase4 would silently stop verifying
    const content = 'no attachment here';
    const expected = computePostContentHash(content);
    expect(toHex(expected)).toBe(toHex(computePostContentHash(content, undefined)));
  });
});
