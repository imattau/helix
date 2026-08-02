import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { multiaddr } from '@multiformats/multiaddr';
import { generateHelixIdentity } from '../../src/crypto/keys.js';
import { createHelixNode, type HelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { HybridLogicalClock } from '../../src/clock/hlc.js';
import { registerUser } from '../../src/api/registerUser.js';
import { createPost } from '../../src/api/createPost.js';
import { decodeGenesis, decodePost } from '../../src/node/messages.js';
import { TOPICS } from '../../src/node/pubsubTopics.js';
import type { Genome, Helix } from '../../src/types/index.js';

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('protocol over the WebSocket transport (not TCP)', () => {
  let alice: HelixNode;
  let bob: HelixNode;

  beforeEach(async () => {
    const aliceIdentity = await generateHelixIdentity();
    const bobIdentity = await generateHelixIdentity();
    alice = await createHelixNode({ port: 0, privateKey: aliceIdentity.privateKey });
    bob = await createHelixNode({ port: 0, privateKey: bobIdentity.privateKey });

    // dial bob's /ws/ multiaddr specifically, not the /tcp/ one every other test uses -
    // this is the whole point of this test: prove gossipsub/the protocol layer doesn't
    // assume TCP anywhere, not just that a WS socket can be opened
    const bobWsAddr = bob.getMultiaddrs().find((addr) => addr.toString().includes('/ws'));
    if (!bobWsAddr) throw new Error('bob has no /ws multiaddr to dial');
    await alice.dial(multiaddr(bobWsAddr.toString()));
  });

  afterEach(async () => {
    await alice.stop();
    await bob.stop();
  });

  it('propagates genome registration and posts over a WebSocket connection', async () => {
    const aliceStore = new MemoryStore();
    const bobStore = new MemoryStore();
    const aliceClock = new HybridLogicalClock(alice.peerId.toString());

    let receivedGenome: Genome | undefined;
    let receivedPost: Helix | undefined;

    bob.services.pubsub.subscribe(TOPICS.GENESIS);
    bob.services.pubsub.subscribe(TOPICS.POSTS);
    bob.services.pubsub.addEventListener('message', (evt) => {
      if (evt.detail.topic === TOPICS.GENESIS) {
        receivedGenome = decodeGenesis(evt.detail.data).genome;
      } else if (evt.detail.topic === TOPICS.POSTS) {
        receivedPost = decodePost(evt.detail.data);
      }
    });

    alice.services.pubsub.subscribe(TOPICS.GENESIS);
    alice.services.pubsub.subscribe(TOPICS.POSTS);

    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.GENESIS).length > 0);
    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.POSTS).length > 0);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const { genome } = await registerUser(alice, aliceStore, 'alice');
    await waitFor(() => receivedGenome !== undefined);
    expect(receivedGenome?.genome).toBe(genome.genome);

    const post = await createPost(alice, aliceStore, aliceClock, {
      authorGenome: genome.genome,
      content: 'Hello over WebSockets, this is a sufficiently diverse test post!',
    });
    await waitFor(() => receivedPost !== undefined);
    expect(receivedPost?.postId).toBe(post.postId);
    expect(receivedPost?.contentHashBase4).toBe(post.contentHashBase4);
  });
});
