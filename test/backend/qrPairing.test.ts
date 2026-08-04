import { describe, expect, it } from 'vitest';
import { encodeQrPairingPayload, decodeQrPairingPayload } from '../../app/src/backend/qrPairing.ts';

describe('QR pairing payload', () => {
  it('round-trips a list of multiaddrs', () => {
    const addrs = [
      '/dns4/relay.example.com/tcp/443/wss/p2p/QmRelay/p2p-circuit/p2p/12D3KooWAbc',
      '/ip4/203.0.113.5/tcp/4001/p2p/12D3KooWAbc',
    ];
    expect(decodeQrPairingPayload(encodeQrPairingPayload(addrs))).toEqual(addrs);
  });

  it('rejects unparseable input', () => {
    expect(() => decodeQrPairingPayload('not json')).toThrow('not a Helix pairing code');
  });

  it('rejects well-formed JSON that is not a pairing payload', () => {
    expect(() => decodeQrPairingPayload(JSON.stringify({ hello: 'world' }))).toThrow('not a Helix pairing code');
  });

  it('rejects an unknown version', () => {
    expect(() => decodeQrPairingPayload(JSON.stringify({ v: 2, addrs: ['/ip4/1.2.3.4/tcp/1'] }))).toThrow(
      'not a Helix pairing code',
    );
  });

  it('rejects an empty address list', () => {
    expect(() => decodeQrPairingPayload(JSON.stringify({ v: 1, addrs: [] }))).toThrow('not a Helix pairing code');
  });

  it('rejects a non-string entry in addrs', () => {
    expect(() => decodeQrPairingPayload(JSON.stringify({ v: 1, addrs: [123] }))).toThrow('not a Helix pairing code');
  });
});
