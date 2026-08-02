import { describe, expect, it, vi, afterEach } from 'vitest';
import { HybridLogicalClock } from '../../src/clock/hlc.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HybridLogicalClock', () => {
  it('bumps the logical counter when physical time does not advance', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const clock = new HybridLogicalClock('alice');

    const t1 = clock.now();
    const t2 = clock.now();

    expect(t1).toEqual({ physical: 1000, logical: 0, peerId: 'alice' });
    expect(t2).toEqual({ physical: 1000, logical: 1, peerId: 'alice' });
  });

  it('resets the logical counter when physical time advances', () => {
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValue(1000);
    const clock = new HybridLogicalClock('alice');
    clock.now();
    clock.now();

    spy.mockReturnValue(2000);
    const t3 = clock.now();
    expect(t3).toEqual({ physical: 2000, logical: 0, peerId: 'alice' });
  });

  it('update() adopts the remote physical time when it is ahead', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const clock = new HybridLogicalClock('bob');
    clock.now(); // local: physical=1000, logical=0

    const merged = clock.update({ physical: 5000, logical: 3, peerId: 'alice' });
    expect(merged).toEqual({ physical: 5000, logical: 4, peerId: 'bob' });
  });

  it('update() keeps local physical time when it is ahead of the remote', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const clock = new HybridLogicalClock('bob');
    clock.now(); // local: physical=1000, logical=0

    const merged = clock.update({ physical: 500, logical: 9, peerId: 'alice' });
    expect(merged).toEqual({ physical: 1000, logical: 1, peerId: 'bob' });
  });

  it('update() takes the max logical counter + 1 when physical times are equal', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const clock = new HybridLogicalClock('bob');
    clock.now();
    clock.now(); // local: physical=1000, logical=1

    const merged = clock.update({ physical: 1000, logical: 5, peerId: 'alice' });
    expect(merged).toEqual({ physical: 1000, logical: 6, peerId: 'bob' });
  });

  describe('compare (total ordering)', () => {
    it('orders by physical time first', () => {
      const a = { physical: 1, logical: 99, peerId: 'z' };
      const b = { physical: 2, logical: 0, peerId: 'a' };
      expect(HybridLogicalClock.compare(a, b)).toBe(-1);
      expect(HybridLogicalClock.compare(b, a)).toBe(1);
    });

    it('breaks physical ties with the logical counter', () => {
      const a = { physical: 1, logical: 1, peerId: 'z' };
      const b = { physical: 1, logical: 2, peerId: 'a' };
      expect(HybridLogicalClock.compare(a, b)).toBe(-1);
    });

    it('breaks physical+logical ties with peerId', () => {
      const a = { physical: 1, logical: 1, peerId: 'alice' };
      const b = { physical: 1, logical: 1, peerId: 'bob' };
      expect(HybridLogicalClock.compare(a, b)).toBe(-1);
      expect(HybridLogicalClock.compare(b, a)).toBe(1);
    });

    it('returns 0 for identical timestamps', () => {
      const a = { physical: 1, logical: 1, peerId: 'alice' };
      expect(HybridLogicalClock.compare(a, { ...a })).toBe(0);
    });
  });
});
