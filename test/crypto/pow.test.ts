import { describe, expect, it } from 'vitest';
import { findProofOfWork, verifyProofOfWork, countLeadingZeroBits } from '../../src/crypto/pow.js';

const data = new TextEncoder().encode('some registration payload');

describe('proof of work', () => {
  it('finds a nonce that verifies at a low difficulty', () => {
    const { nonce } = findProofOfWork(data, 8);
    expect(verifyProofOfWork(data, nonce, 8)).toBe(true);
  });

  it('rejects a tampered nonce', () => {
    const { nonce } = findProofOfWork(data, 8);
    expect(verifyProofOfWork(data, nonce + 1, 8)).toBe(false);
  });

  it('rejects the same proof against different data', () => {
    const { nonce } = findProofOfWork(data, 8);
    const otherData = new TextEncoder().encode('different registration payload');
    expect(verifyProofOfWork(otherData, nonce, 8)).toBe(false);
  });

  it('rejects a valid low-difficulty proof against a higher required difficulty', () => {
    const { nonce } = findProofOfWork(data, 8);
    // an 8-bit proof only guarantees >=8 leading zero bits, not >=24
    expect(verifyProofOfWork(data, nonce, 24)).toBe(false);
  });

  it('countLeadingZeroBits counts correctly across byte boundaries', () => {
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00, 0xff]))).toBe(16);
    expect(countLeadingZeroBits(new Uint8Array([0x0f]))).toBe(4);
    expect(countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x01]))).toBe(15);
  });
});
