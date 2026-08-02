import { describe, expect, it } from 'vitest';
import { gf4Add, gf4Checksum, gf4Mul, verifyGf4Checksum } from '../../src/math/gf4.js';
import { to_base4 } from '../../src/math/base4.js';

describe('GF(4) field arithmetic', () => {
  it('addition is XOR and self-inverse', () => {
    for (let a = 0; a < 4; a++) {
      expect(gf4Add(a as 0 | 1 | 2 | 3, a as 0 | 1 | 2 | 3)).toBe(0);
      for (let b = 0; b < 4; b++) {
        expect(gf4Add(a as 0 | 1 | 2 | 3, b as 0 | 1 | 2 | 3)).toBe(a ^ b);
      }
    }
  });

  it('0 is the multiplicative annihilator and 1 is the identity', () => {
    for (let a = 0; a < 4; a++) {
      expect(gf4Mul(a as 0 | 1 | 2 | 3, 0)).toBe(0);
      expect(gf4Mul(a as 0 | 1 | 2 | 3, 1)).toBe(a);
    }
  });

  it('alpha^2 = alpha + 1 (2*2 = 3) and alpha^3 = 1 (2*3 = 1)', () => {
    expect(gf4Mul(2, 2)).toBe(3);
    expect(gf4Mul(2, 3)).toBe(1);
  });

  it('every nonzero element has a multiplicative inverse', () => {
    for (let a = 1; a < 4; a++) {
      let foundInverse = false;
      for (let b = 1; b < 4; b++) {
        if (gf4Mul(a as 0 | 1 | 2 | 3, b as 0 | 1 | 2 | 3) === 1) foundInverse = true;
      }
      expect(foundInverse).toBe(true);
    }
  });
});

describe('gf4Checksum', () => {
  it('is deterministic', () => {
    const msg = to_base4(new Uint8Array([1, 2, 3, 4, 5]));
    expect(gf4Checksum(msg)).toBe(gf4Checksum(msg));
  });

  it('always produces a 4-character base-4 string', () => {
    const shortMsg = 'AC';
    const longMsg = to_base4(new Uint8Array(Array.from({ length: 20 }, (_, i) => i)));
    expect(gf4Checksum(shortMsg)).toHaveLength(4);
    expect(gf4Checksum(longMsg)).toHaveLength(4);
  });

  it('verifies correctly and detects tampering', () => {
    const msg = to_base4(new Uint8Array([9, 8, 7, 6]));
    const checksum = gf4Checksum(msg);
    expect(verifyGf4Checksum(msg, checksum)).toBe(true);

    const tampered = 'T' + msg.slice(1);
    expect(verifyGf4Checksum(tampered, checksum)).toBe(false);
  });
});
