import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { generateHelixIdentity } from '../../src/crypto/keys.js';
import { createHelixNode, type HelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { HybridLogicalClock } from '../../src/clock/hlc.js';
import { createPost } from '../../src/api/createPost.js';
import { ingestPost, PostRejectedError } from '../../src/api/ingestPost.js';
import type { Genome, Helix } from '../../src/types/index.js';

describe('ingestPost receiver validation', () => {
  let node: HelixNode;
  let senderStore: MemoryStore;
  let receiverStore: MemoryStore;
  let hlc: HybridLogicalClock;

  const genome: Genome = {
    genome: 'ACGT',
    displayName: 'alice',
    publicKeyHex: '00',
    peerId: 'peer',
    powNonce: 0,
  };

  beforeEach(async () => {
    const identity = await generateHelixIdentity();
    node = await createHelixNode({ port: 0, privateKey: identity.privateKey, browser: true });
    senderStore = new MemoryStore();
    receiverStore = new MemoryStore();
    senderStore.saveGenome(genome);
    receiverStore.saveGenome(genome);
    hlc = new HybridLogicalClock(node.peerId.toString());
  });

  afterEach(async () => {
    await node.stop();
  });

  it('stores a valid remote post in the receiver store', async () => {
    const post = await createPost(node, senderStore, hlc, {
      authorGenome: genome.genome,
      content: 'a valid remote post with enough character diversity',
    });

    ingestPost(receiverStore, post);

    expect(receiverStore.getPost(post.postId)?.postId).toBe(post.postId);
    expect(receiverStore.getOpenTad(genome.genome)?.posts).toHaveLength(1);
  });

  it('updates recombination state for valid remote edits', async () => {
    const original = await createPost(node, senderStore, hlc, {
      authorGenome: genome.genome,
      content: 'first version with enough entropy for acceptance',
    });
    ingestPost(receiverStore, original);

    const edited = await createPost(node, senderStore, hlc, {
      authorGenome: genome.genome,
      content: 'second version with enough entropy for acceptance',
      recombinesPostId: original.postId,
    });
    ingestPost(receiverStore, edited);

    expect(receiverStore.isSuperseded(original.postId)).toBe(true);
    expect(receiverStore.getCurrentVersion(original.postId)?.postId).toBe(edited.postId);
  });

  it('rejects tampered checksum data before saving', async () => {
    const post = await createPost(node, senderStore, hlc, {
      authorGenome: genome.genome,
      content: 'a valid post before checksum tampering happens',
    });
    const tampered: Helix = { ...post, gf4Checksum: 'AAAA' };

    expect(() => ingestPost(receiverStore, tampered)).toThrow(PostRejectedError);
    expect(receiverStore.getPost(post.postId)).toBeUndefined();
  });

  it('rejects posts for unknown author genomes', async () => {
    const post = await createPost(node, senderStore, hlc, {
      authorGenome: genome.genome,
      content: 'another valid post before changing its author',
    });
    const forged: Helix = { ...post, postId: 'forged-post', genome: 'TTTT' };

    expect(() => ingestPost(receiverStore, forged)).toThrow(/unknown author genome/);
    expect(receiverStore.getPost(forged.postId)).toBeUndefined();
  });
});
