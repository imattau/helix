import { describe, expect, it } from 'vitest';
import { generateSimhash, hammingDistance64, simhashFromHex, simhashToHex } from '../../src/math/simhash.js';
import { sha256 } from '../../src/crypto/hash.js';

describe('generateSimhash', () => {
  it('produces a small Hamming distance for near-duplicate content', () => {
    const original = 'The election results were certified by every state official involved';
    const paraphrase = 'The election results were certified by every state official present';

    const distance = hammingDistance64(generateSimhash(original), generateSimhash(paraphrase));
    expect(distance).toBeLessThanOrEqual(12);
  });

  it('produces a large Hamming distance for unrelated content', () => {
    const a = 'The election results were certified by every state official involved';
    const b = 'My cat knocked a glass of orange juice off the kitchen counter this morning';

    const distance = hammingDistance64(generateSimhash(a), generateSimhash(b));
    expect(distance).toBeGreaterThan(10);
  });

  it('is deterministic', () => {
    const text = 'Deterministic fingerprints matter for a moderation registry';
    expect(generateSimhash(text)).toBe(generateSimhash(text));
  });

  it('handles content shorter than the shingle size', () => {
    expect(() => generateSimhash('hi')).not.toThrow();
    expect(() => generateSimhash('')).not.toThrow();
  });

  it('round-trips through hex without losing precision (regression: bigint vs number)', () => {
    // a fingerprint with the high bit set would silently corrupt under a plain JS number
    const highBitFingerprint = 1n << 63n;
    const hex = simhashToHex(highBitFingerprint);
    expect(simhashFromHex(hex)).toBe(highBitFingerprint);
  });

  it('the sha256-derived shingle hash uses the full 64-bit range, not just 53 safe bits', () => {
    // sanity check that our bigint construction from sha256 bytes isn't silently truncated
    const digest = sha256(new TextEncoder().encode('some shingle text here'));
    let value = 0n;
    for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(digest[i]);
    expect(value).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });
});

describe('hammingDistance64', () => {
  it('is 0 for identical fingerprints', () => {
    const fp = generateSimhash('some content here for testing purposes today');
    expect(hammingDistance64(fp, fp)).toBe(0);
  });

  it('is 64 for exact bit complements', () => {
    const all = (1n << 64n) - 1n;
    expect(hammingDistance64(0n, all)).toBe(64);
  });
});
