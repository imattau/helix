import type { Base4Char } from '../types/index.js';

const LUT: Base4Char[] = ['A', 'C', 'G', 'T']; // 00, 01, 10, 11
const REVERSE_LUT: Record<Base4Char, number> = { A: 0, C: 1, G: 2, T: 3 };

/** Maps a base-4 symbol to its 2-bit value (0-3). Shared with the GF(4) module, whose field elements use the same encoding. */
export function base4CharToValue(ch: string): number {
  const value = REVERSE_LUT[ch as Base4Char];
  if (value === undefined) {
    throw new RangeError(`base4CharToValue: invalid base-4 character "${ch}"`);
  }
  return value;
}

/** Inverse of base4CharToValue. */
export function valueToBase4Char(value: number): Base4Char {
  const ch = LUT[value];
  if (ch === undefined) {
    throw new RangeError(`valueToBase4Char: value out of range 0-3: ${value}`);
  }
  return ch;
}

/** Encodes bytes to a string over {A,C,G,T}, 2 bits -> 1 symbol, MSB-first. */
export function to_base4(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += LUT[(byte >> 6) & 0b11];
    out += LUT[(byte >> 4) & 0b11];
    out += LUT[(byte >> 2) & 0b11];
    out += LUT[byte & 0b11];
  }
  return out;
}

/** Inverse of to_base4. Throws if the input length isn't a multiple of 4 or contains invalid symbols. */
export function from_base4(str: string): Uint8Array {
  if (str.length % 4 !== 0) {
    throw new RangeError(`from_base4: length must be a multiple of 4, got ${str.length}`);
  }
  const out = new Uint8Array(str.length / 4);
  for (let i = 0; i < out.length; i++) {
    const chunk = str.slice(i * 4, i * 4 + 4);
    let byte = 0;
    for (const ch of chunk) {
      const bits = REVERSE_LUT[ch as Base4Char];
      if (bits === undefined) {
        throw new RangeError(`from_base4: invalid base-4 character "${ch}"`);
      }
      byte = (byte << 2) | bits;
    }
    out[i] = byte;
  }
  return out;
}
