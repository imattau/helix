import { describe, expect, it } from 'vitest';
import { hamming_distance } from '../../src/math/hamming.js';

describe('hamming_distance', () => {
  it('returns 0 for identical strings', () => {
    expect(hamming_distance('ACGT', 'ACGT')).toBe(0);
  });

  it('counts differing positions', () => {
    expect(hamming_distance('ACGT', 'AGGA')).toBe(2);
  });

  it('throws on unequal-length strings', () => {
    expect(() => hamming_distance('ACG', 'ACGT')).toThrow(RangeError);
  });
});
