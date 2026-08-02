import type { HLCTimestamp } from '../types/index.js';

/**
 * Hybrid Logical Clock (Kulkarni et al.): every peer runs its own instance, no
 * producer/coordinator role - this is what actually decentralizes post timestamps
 * (the single-producer VDF clock it replaces made "decentralized timestamping"
 * actually centralized on whoever ran the producer). Timestamps are already totally
 * ordered by construction (physical, then logical, then peerId), so - unlike a plain
 * Lamport/vector clock - no separate hash-based tiebreak is needed on top.
 */
export class HybridLogicalClock {
  private physical = 0;
  private logical = 0;

  constructor(private readonly peerId: string) {}

  /** Ticks the clock for a locally-originated event (e.g. this peer's own new post). */
  now(): HLCTimestamp {
    const pt = Date.now();
    if (pt > this.physical) {
      this.physical = pt;
      this.logical = 0;
    } else {
      this.logical += 1;
    }
    return { physical: this.physical, logical: this.logical, peerId: this.peerId };
  }

  /** Merges an observed remote timestamp into the local clock (e.g. receiving a post). */
  update(remote: HLCTimestamp): HLCTimestamp {
    const pt = Date.now();
    const newPhysical = Math.max(pt, this.physical, remote.physical);

    let newLogical: number;
    if (newPhysical === this.physical && newPhysical === remote.physical) {
      newLogical = Math.max(this.logical, remote.logical) + 1;
    } else if (newPhysical === this.physical) {
      newLogical = this.logical + 1;
    } else if (newPhysical === remote.physical) {
      newLogical = remote.logical + 1;
    } else {
      newLogical = 0;
    }

    this.physical = newPhysical;
    this.logical = newLogical;
    return { physical: this.physical, logical: this.logical, peerId: this.peerId };
  }

  static compare(a: HLCTimestamp, b: HLCTimestamp): -1 | 0 | 1 {
    if (a.physical !== b.physical) return a.physical < b.physical ? -1 : 1;
    if (a.logical !== b.logical) return a.logical < b.logical ? -1 : 1;
    if (a.peerId !== b.peerId) return a.peerId < b.peerId ? -1 : 1;
    return 0;
  }
}
