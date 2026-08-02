import { sha256 } from '../crypto/hash.js';

const FINGERPRINT_BITS = 64;
// Helix posts are short (tweet-length), unlike the long documents SimHash near-dup
// literature typically assumes. Multi-word n-gram shingles (e.g. 4-grams) were tried
// and rejected: on a 6-10 word post, changing one word flips a large fraction of the
// shingles at once, blowing up the distance between genuine paraphrases (measured
// 7-20 bits) past any threshold that still rejects unrelated text. Single-word tokens
// (classic weighted bag-of-words SimHash) give a clean, measured separation instead:
// near-duplicates land at 5-10 bits, unrelated content at 27+ bits.
const SHINGLE_SIZE = 1;

function shingleHashToBigint(shingle: string): bigint {
  const digest = sha256(new TextEncoder().encode(shingle));
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(digest[i]);
  }
  return value;
}

/**
 * 64-bit SimHash fingerprint: near-duplicate content produces a small Hamming distance
 * between fingerprints, unlike a cryptographic hash (SHA-256) where a single changed
 * character produces an unrecognizably different digest. Uses `bigint` throughout -
 * JS `number` only has 53 safe integer bits, which would silently corrupt the top bits
 * of a 64-bit fingerprint.
 */
export function generateSimhash(content: string): bigint {
  const words = content.trim().split(/\s+/).filter(Boolean);
  const shingles = new Set<string>();
  if (words.length >= SHINGLE_SIZE) {
    for (let i = 0; i <= words.length - SHINGLE_SIZE; i++) {
      shingles.add(words.slice(i, i + SHINGLE_SIZE).join(' '));
    }
  } else {
    shingles.add(content);
  }

  const weights = new Array(FINGERPRINT_BITS).fill(0);
  for (const shingle of shingles) {
    const hash = shingleHashToBigint(shingle);
    for (let bit = 0; bit < FINGERPRINT_BITS; bit++) {
      weights[bit] += (hash >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < FINGERPRINT_BITS; bit++) {
    if (weights[bit] > 0) fingerprint |= 1n << BigInt(bit);
  }
  return fingerprint;
}

export function popcount64(value: bigint): number {
  let count = 0;
  let v = value;
  while (v > 0n) {
    count += Number(v & 1n);
    v >>= 1n;
  }
  return count;
}

export function hammingDistance64(a: bigint, b: bigint): number {
  return popcount64(a ^ b);
}

export function simhashToHex(value: bigint): string {
  return value.toString(16).padStart(16, '0');
}

export function simhashFromHex(hex: string): bigint {
  return BigInt(`0x${hex}`);
}
