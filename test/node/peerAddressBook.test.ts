import { describe, expect, it } from 'vitest';
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
});
