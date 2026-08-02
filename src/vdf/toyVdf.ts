import { sha256 } from '../crypto/hash.js';

/**
 * Toy sequential-hashing VDF: y_{i+1} = sha256(y_i), iterated `difficulty` times.
 *
 * This is explicitly PROTOTYPE-GRADE, not a production VDF:
 *  - Sequential by construction (each step needs the previous output), which gives the
 *    "you can't skip ahead" delay property in practice on ordinary hardware.
 *  - It is NOT proven sequentially-hard the way Wesolowski/Pietrzak VDFs (built on
 *    groups of unknown order, e.g. RSA groups or class groups) are.
 *  - Verification here costs the same as computation (redo all `difficulty` iterations) —
 *    there is no succinct proof, unlike a real VDF's O(1)-ish verification.
 * A production deployment should use an audited VDF library (e.g. Chia's `chiavdf`,
 * a Wesolowski construction) rather than hand-rolling iterated hashing like this.
 */
export const DEFAULT_DIFFICULTY = 100_000;

export function computeVdf(seed: Uint8Array, difficulty: number = DEFAULT_DIFFICULTY): Uint8Array {
  let y = seed;
  for (let i = 0; i < difficulty; i++) {
    y = sha256(y);
  }
  return y;
}

/** Verification = recomputation, since this toy construction has no succinct proof. */
export function verifyVdf(seed: Uint8Array, output: Uint8Array, difficulty: number = DEFAULT_DIFFICULTY): boolean {
  const recomputed = computeVdf(seed, difficulty);
  if (recomputed.length !== output.length) return false;
  for (let i = 0; i < recomputed.length; i++) {
    if (recomputed[i] !== output[i]) return false;
  }
  return true;
}
