import { describe, expect, it } from 'vitest';
import { from_base4, to_base4 } from '../../src/math/base4.js';

describe('to_base4 / from_base4', () => {
  it('encodes an empty buffer to an empty string', () => {
    expect(to_base4(new Uint8Array())).toBe('');
  });

  it('encodes a single byte to exactly 4 symbols', () => {
    expect(to_base4(new Uint8Array([0b00_01_10_11]))).toBe('ACGT');
    expect(to_base4(new Uint8Array([0x00]))).toBe('AAAA');
    expect(to_base4(new Uint8Array([0xff]))).toBe('TTTT');
  });

  it('round-trips arbitrary bytes through to_base4/from_base4', () => {
    const bytes = new Uint8Array([0, 1, 42, 255, 128, 17]);
    expect(from_base4(to_base4(bytes))).toEqual(bytes);
  });

  it('throws on a length not a multiple of 4', () => {
    expect(() => from_base4('ACG')).toThrow(RangeError);
  });

  it('throws on invalid characters', () => {
    expect(() => from_base4('ACGX')).toThrow(RangeError);
  });
});
