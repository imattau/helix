import { sha256 } from './hash.js';
import { toHex } from './hex.js';

/**
 * ~65k average attempts, sub-second in Node — sized for a responsive demo. A real
 * deployment would tune this much higher, likely with a Bitcoin-style difficulty
 * retarget mechanism as the network grows.
 */
export const REGISTRATION_DIFFICULTY_BITS = 16;

function nonceBytes(nonce: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, nonce, false);
  return buf;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function countLeadingZeroBits(hash: Uint8Array): number {
  let count = 0;
  for (const byte of hash) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    let b = byte;
    while ((b & 0x80) === 0) {
      count++;
      b <<= 1;
    }
    break;
  }
  return count;
}

/**
 * Hashcash-style proof of work: search for a nonce whose `sha256(data ++ nonce)` has
 * at least `difficultyBits` leading zero bits. Deliberately a plain parallelizable
 * search, not the sequential VDF used elsewhere in this project - a registration cost
 * wants work anyone can throw CPU at and everyone else verifies in a single hash,
 * the opposite performance profile from a VDF (non-parallelizable, verification =
 * redoing the whole computation).
 */
export function findProofOfWork(data: Uint8Array, difficultyBits: number): { nonce: number; hashHex: string } {
  let nonce = 0;
  while (nonce <= 0xffffffff) {
    const hash = sha256(concatBytes(data, nonceBytes(nonce)));
    if (countLeadingZeroBits(hash) >= difficultyBits) {
      return { nonce, hashHex: toHex(hash) };
    }
    nonce++;
  }
  throw new Error('findProofOfWork: nonce space exhausted');
}

/** O(1) regardless of how expensive finding the nonce was - one hash, one comparison. */
export function verifyProofOfWork(data: Uint8Array, nonce: number, difficultyBits: number): boolean {
  const hash = sha256(concatBytes(data, nonceBytes(nonce)));
  return countLeadingZeroBits(hash) >= difficultyBits;
}
