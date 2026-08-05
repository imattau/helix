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
 */
export class PeerAddressBook {
  private readonly addrs = new Map<string, string[]>();

  constructor(private readonly maxEntries = 5_000) {}

  set(peerId: string, multiaddrs: string[]): void {
    this.addrs.delete(peerId);
    this.addrs.set(peerId, multiaddrs);
    if (this.addrs.size > this.maxEntries) {
      const oldest = this.addrs.keys().next().value;
      if (oldest !== undefined) this.addrs.delete(oldest);
    }
  }

  get(peerId: string): string[] | undefined {
    return this.addrs.get(peerId);
  }

  get size(): number {
    return this.addrs.size;
  }
}
