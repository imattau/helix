import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerAddressBook } from '../../src/node/peerAddressBook.js';

describe('PeerAddressBook', () => {
  it('stores and retrieves addresses by peerId', () => {
    const book = new PeerAddressBook();
    book.set('peer-a', ['/ip4/1.2.3.4/tcp/1']);
    expect(book.get('peer-a')).toEqual(['/ip4/1.2.3.4/tcp/1']);
    expect(book.get('peer-b')).toBeUndefined();
  });

  it('overwrites and refreshes recency on re-set', () => {
    const book = new PeerAddressBook(2);
    book.set('a', ['addr-a1']);
    book.set('b', ['addr-b1']);
    book.set('a', ['addr-a2']); // 'a' is now most-recent, 'b' is oldest
    book.set('c', ['addr-c1']); // pushes out the oldest ('b'), not 'a'
    expect(book.get('a')).toEqual(['addr-a2']);
    expect(book.get('b')).toBeUndefined();
    expect(book.get('c')).toEqual(['addr-c1']);
    expect(book.size).toBe(2);
  });

  it('evicts the oldest entry once over capacity', () => {
    const book = new PeerAddressBook(3);
    book.set('a', ['1']);
    book.set('b', ['2']);
    book.set('c', ['3']);
    book.set('d', ['4']);
    expect(book.size).toBe(3);
    expect(book.get('a')).toBeUndefined();
    expect(book.get('d')).toEqual(['4']);
  });

  describe('TTL expiry', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('expires an entry that has not been refreshed within the TTL', () => {
      const book = new PeerAddressBook(5_000, 60_000);
      book.set('stale-peer', ['/ip4/1.2.3.4/tcp/1']);
      vi.advanceTimersByTime(60_001);
      expect(book.get('stale-peer')).toBeUndefined();
    });

    it('does not expire an entry refreshed (re-set) within the TTL window', () => {
      const book = new PeerAddressBook(5_000, 60_000);
      book.set('live-peer', ['/ip4/1.2.3.4/tcp/1']);
      vi.advanceTimersByTime(50_000);
      book.set('live-peer', ['/ip4/1.2.3.4/tcp/1']); // keep-alive re-broadcast
      vi.advanceTimersByTime(50_000); // total 100s since first set, but only 50s since refresh
      expect(book.get('live-peer')).toEqual(['/ip4/1.2.3.4/tcp/1']);
    });

    it('an expired entry also frees up capacity (does not count toward size once expired)', () => {
      const book = new PeerAddressBook(5_000, 60_000);
      book.set('old', ['1']);
      vi.advanceTimersByTime(60_001);
      expect(book.get('old')).toBeUndefined(); // triggers lazy deletion
      expect(book.size).toBe(0);
    });
  });
});
