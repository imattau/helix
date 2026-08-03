import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { BinaryStoreAdapter } from '@0xx0lostcause0xx0/polypack/persistence/node';
import { generateHelixIdentity } from '../../src/crypto/keys.js';
import { createHelixNode, type HelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { HybridLogicalClock } from '../../src/clock/hlc.js';
import { createPost, TAD_SIZE } from '../../src/api/createPost.js';
import { getSyncState, getMerkleProof, verifyPost } from '../../src/api/query.js';
import type { Genome } from '../../src/types/index.js';

describe('PolyGraph-backed MemoryStore', () => {
  let node: HelixNode;

  const genome = 'ACGT';
  const otherGenome = 'TGCA';

  const alice: Genome = { genome, displayName: 'alice', publicKeyHex: '00', peerId: 'p', powNonce: 0 };
  const bob: Genome = { genome: otherGenome, displayName: 'bob', publicKeyHex: '01', peerId: 'q', powNonce: 0 };

  beforeEach(async () => {
    const identity = await generateHelixIdentity();
    node = await createHelixNode({ port: 0, privateKey: identity.privateKey, browser: true });
  });

  afterEach(async () => {
    await node.stop();
  });

  it('exposes relationships as traversals: replies, reactions, profile, supersession', async () => {
    const store = new MemoryStore();
    const hlc = new HybridLogicalClock(node.peerId.toString());
    store.saveGenome(alice);
    store.saveGenome(bob);

    const root = await createPost(node, store, hlc, {
      authorGenome: genome,
      content: 'a root post with enough character diversity',
    });
    const reply = await createPost(node, store, hlc, {
      authorGenome: otherGenome,
      content: 'a reply with enough character diversity',
      parentPostId: root.postId,
    });
    const like = await createPost(node, store, hlc, {
      authorGenome: otherGenome,
      kind: 'like',
      content: '',
      parentPostId: root.postId,
    });
    const profile = await createPost(node, store, hlc, {
      authorGenome: otherGenome,
      kind: 'profile',
      content: JSON.stringify({ displayName: 'Bob' }),
    });

    expect(store.getRepliesTo(root.postId).map((p) => p.postId)).toEqual([reply.postId]);
    expect(store.getReactionsTo(root.postId, 'like').map((p) => p.postId)).toEqual([like.postId]);
    expect(store.getReactionsTo(root.postId, 'boost')).toEqual([]);
    expect(store.getProfilePost(otherGenome)?.postId).toBe(profile.postId);
    expect(store.getPostsByGenome(otherGenome).map((p) => p.postId).sort()).toEqual(
      [reply.postId, like.postId, profile.postId].sort(),
    );
    expect(store.getPostsInTad(store.getOpenTad(genome)!.tadId).map((p) => p.postId)).toEqual([root.postId]);

    // an edit supersedes the reply; traversals then resolve to the current version
    const edited = await createPost(node, store, hlc, {
      authorGenome: otherGenome,
      content: 'an edited reply with enough character diversity',
      recombinesPostId: reply.postId,
    });
    expect(store.isSuperseded(reply.postId)).toBe(true);
    expect(store.isSuperseded(edited.postId)).toBe(false);
    expect(store.getCurrentVersion(reply.postId)?.postId).toBe(edited.postId);
    expect(store.getRepliesTo(root.postId).map((p) => p.postId)).toEqual([edited.postId]);
  });

  it('persists genomes, posts, TADs, supersession and the MMR across a restart', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'helix-store-'));
    try {
      const first = new MemoryStore({ storeAdapter: new BinaryStoreAdapter({ storeDir: dir }) });
      const hlc = new HybridLogicalClock(node.peerId.toString());
      first.saveGenome(alice);

      const original = await createPost(node, first, hlc, {
        authorGenome: genome,
        content: 'the original post with enough character diversity',
      });
      const edited = await createPost(node, first, hlc, {
        authorGenome: genome,
        content: 'the edited post with enough character diversity',
        recombinesPostId: original.postId,
      });
      const posts: Awaited<ReturnType<typeof createPost>>[] = [];
      for (let i = 0; i < TAD_SIZE; i++) {
        posts.push(
          await createPost(node, first, hlc, {
            authorGenome: genome,
            content: `persistent post ${i} with enough character diversity`,
          }),
        );
      }
      // TAD_SIZE + 2 total: original + edited + TAD_SIZE = one closed TAD (10) + open TAD (2)
      const preSync = getSyncState(first, genome);
      expect(preSync.totalLeaves).toBe(1);
      await first.disposePersistentGraphs();

      const restored = new MemoryStore({ storeAdapter: new BinaryStoreAdapter({ storeDir: dir }) });
      await restored.loadPersistentGraphs();

      expect(restored.hasGenome(genome)).toBe(true);
      expect(restored.getGenome(genome)?.displayName).toBe('alice');
      expect(restored.getAllPosts().length).toBe(TAD_SIZE + 2);
      expect(restored.getPost(original.postId)?.content).toBe(original.content);
      expect(restored.getPost(edited.postId)?.content).toBe(edited.content);
      expect(restored.getClosedTad(genome, 0)?.posts).toHaveLength(TAD_SIZE);
      expect(restored.getOpenTad(genome)?.posts).toHaveLength(2);
      expect(restored.getLatestPostForGenome(genome)?.postId).toBe(posts[posts.length - 1].postId);

      // supersession edges survived the restart
      expect(restored.isSuperseded(original.postId)).toBe(true);
      expect(restored.getCurrentVersion(original.postId)?.postId).toBe(edited.postId);

      // the MMR is rebuilt by re-folding persisted closed TAD roots, matching pre-restart
      const postSync = getSyncState(restored, genome);
      expect(postSync.totalLeaves).toBe(preSync.totalLeaves);
      expect(postSync.syncHashHex).toBe(preSync.syncHashHex);

      // two-level proofs still verify against the rebuilt MMR
      const { post, tadMerkleRootHex, tadProof, mmrProof } = getMerkleProof(restored, genome, 3);
      expect(verifyPost(post, tadMerkleRootHex, tadProof, mmrProof, postSync.peaks)).toBe(true);
      await restored.disposePersistentGraphs();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
