import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { BinaryStoreAdapter } from '@0xx0lostcause0xx0/polypack/persistence/node';
import { FollowGraph } from '../../src/social/followGraph.js';
import { PeakGraph } from '../../src/store/peakGraph.js';
import type { MMRPeak } from '../../src/store/mmr.js';

describe('PolyPack persistence', () => {
  it('restores follow graph edges from disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'helix-follow-graph-'));
    try {
      const first = new FollowGraph(new BinaryStoreAdapter({ storeDir: dir }));
      first.addFollow('alice', 'bob');
      await first.dispose();

      const restored = new FollowGraph(new BinaryStoreAdapter({ storeDir: dir }));
      await restored.load();
      expect(restored.getFollowing('alice')).toEqual(['bob']);
      expect(restored.getFollowers('bob')).toEqual(['alice']);
      await restored.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('restores peak graph fold edges from disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'helix-peak-graph-'));
    try {
      const left: MMRPeak = { height: 0, hashHex: '11'.repeat(32), startIndex: 0, leafCount: 1 };
      const right: MMRPeak = { height: 0, hashHex: '22'.repeat(32), startIndex: 1, leafCount: 1 };
      const combined: MMRPeak = { height: 1, hashHex: '33'.repeat(32), startIndex: 0, leafCount: 2 };

      const first = new PeakGraph(new BinaryStoreAdapter({ storeDir: dir }));
      first.recordFold('alice', combined, left, right);
      await first.dispose();

      const restored = new PeakGraph(new BinaryStoreAdapter({ storeDir: dir }));
      await restored.load();
      expect(restored.getChildren('alice', combined)).toEqual([left, right]);
      expect(restored.getAncestors('alice', left)).toEqual([combined]);
      await restored.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
