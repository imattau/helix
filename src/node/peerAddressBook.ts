/**
 * A bounded, most-recently-seen-wins map of peerId -> self-reported dialable
 * multiaddrs (see TOPICS.PEER_ADDR/messages.ts's PeerAddrMessage) - the relay-side
 * companion to a HelixStore's unbounded genome ledger. Genomes are cheap and this
 * project already accepts every long-running peer's local store growing without
 * bound (a pre-existing characteristic of the whole system, not something this
 * feature needs to solve), but a relay that stays up indefinitely and hears from
 * every peer that ever bootstraps through it would otherwise accumulate an
 * unbounded number of address records - genuinely new state this feature
 * introduces, so it gets its own cap rather than inheriting the store's.
 *
 * Uses a plain Map's insertion-order iteration for eviction: `set()` always
 * deletes-then-reinserts so a re-seen peerId moves to the end (most-recent), and
 * the oldest (first) entry is evicted once over capacity - a simple LRU.
 *
 * Entries also expire after `ttlMs` of not being refreshed. Without this, a peer
 * that connects once and then goes offline forever (closed tab, process killed)
 * would sit in the directory indefinitely, handing out an address that will never
 * answer - wasting a discoverer's time on a guaranteed-to-fail dial, and getting
 * worse the longer a relay stays up. Client code re-broadcasts its own address
 * periodically while connected (see client.ts's announcePeerAddr keep-alive) - a
 * peer that's actually still online refreshes its own entry well within the TTL,
 * so this only prunes genuinely stale ones. Expiry is lazy (checked on `get()`,
 * not swept on a timer) - simple, and sufficient since the only thing that ever
 * reads this is a directory request.
 */
export class PeerAddressBook {
  private readonly addrs = new Map<string, { multiaddrs: string[]; lastSeen: number }>();

  constructor(
    private readonly maxEntries = 5_000,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  set(peerId: string, multiaddrs: string[]): void {
    this.addrs.delete(peerId);
    this.addrs.set(peerId, { multiaddrs, lastSeen: Date.now() });
    if (this.addrs.size > this.maxEntries) {
      const oldest = this.addrs.keys().next().value;
      if (oldest !== undefined) this.addrs.delete(oldest);
    }
  }

  get(peerId: string): string[] | undefined {
    const entry = this.addrs.get(peerId);
    if (!entry) return undefined;
    if (Date.now() - entry.lastSeen > this.ttlMs) {
      this.addrs.delete(peerId);
      return undefined;
    }
    return entry.multiaddrs;
  }

  get size(): number {
    return this.addrs.size;
  }
}
