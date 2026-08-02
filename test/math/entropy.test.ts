import { describe, expect, it } from 'vitest';
import { calculate_entropy } from '../../src/math/entropy.js';

describe('calculate_entropy', () => {
  it('returns 0 for an empty string', () => {
    expect(calculate_entropy('')).toBe(0);
  });

  it('returns 0 for a string of one repeated character', () => {
    expect(calculate_entropy('aaaaaa')).toBe(0);
  });

  it('returns 1 bit for a 50/50 two-symbol distribution', () => {
    expect(calculate_entropy('abab')).toBeCloseTo(1, 10);
  });

  it('returns 2 bits for a uniform 4-symbol distribution', () => {
    expect(calculate_entropy('ACGT')).toBeCloseTo(2, 10);
  });

  it('does not split multi-byte characters', () => {
    expect(() => calculate_entropy('hello 🧬🧬 world')).not.toThrow();
  });
});
