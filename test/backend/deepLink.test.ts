import { describe, expect, it } from 'vitest';
import { parseBootstrapDeepLink } from '../../app/src/backend/deepLink.ts';

describe('bootstrap deep link', () => {
  it('extracts the addr param from a helix://bootstrap link', () => {
    const addr = '/dns4/relay.example.com/tcp/443/wss/p2p/12D3KooWAbc';
    const link = `helix://bootstrap?addr=${encodeURIComponent(addr)}`;
    expect(parseBootstrapDeepLink(link)).toBe(addr);
  });

  it('rejects a different scheme', () => {
    expect(parseBootstrapDeepLink('https://bootstrap?addr=%2Fip4%2F1.2.3.4%2Ftcp%2F1')).toBeUndefined();
  });

  it('rejects a helix:// link for a different action', () => {
    expect(parseBootstrapDeepLink('helix://profile?id=abc')).toBeUndefined();
  });

  it('rejects a helix://bootstrap link with no addr param', () => {
    expect(parseBootstrapDeepLink('helix://bootstrap')).toBeUndefined();
  });

  it('rejects unparseable input', () => {
    expect(parseBootstrapDeepLink('not a url')).toBeUndefined();
  });

  it('accepts the addr as a path segment too', () => {
    const addr = '/ip4/203.0.113.5/tcp/4001/p2p/12D3KooWAbc';
    const link = `helix:///bootstrap?addr=${encodeURIComponent(addr)}`;
    expect(parseBootstrapDeepLink(link)).toBe(addr);
  });
});
