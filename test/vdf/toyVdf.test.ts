import { describe, expect, it } from 'vitest';
import { computeVdf, verifyVdf } from '../../src/vdf/toyVdf.js';

describe('toy VDF', () => {
  const seed = new Uint8Array([1, 2, 3, 4]);

  it('is deterministic for a given seed and difficulty', () => {
    const a = computeVdf(seed, 500);
    const b = computeVdf(seed, 500);
    expect(a).toEqual(b);
  });

  it('produces different output for different difficulty', () => {
    const a = computeVdf(seed, 500);
    const b = computeVdf(seed, 501);
    expect(a).not.toEqual(b);
  });

  it('verifies a correct (seed, output, difficulty) triple', () => {
    const output = computeVdf(seed, 500);
    expect(verifyVdf(seed, output, 500)).toBe(true);
  });

  it('rejects a tampered output', () => {
    const output = computeVdf(seed, 500);
    const tampered = new Uint8Array(output);
    tampered[0] ^= 0xff;
    expect(verifyVdf(seed, tampered, 500)).toBe(false);
  });
});
