import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { multiaddr } from '@multiformats/multiaddr';
import { generateHelixIdentity } from '../../src/crypto/keys.js';
import { createHelixNode, type HelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { registerUser } from '../../src/api/registerUser.js';
import { createPost } from '../../src/api/createPost.js';
import { HybridLogicalClock } from '../../src/clock/hlc.js';
import {
  requestDirectory,
  registerDirectoryHandler,
  buildDirectorySnapshot,
  ingestDirectory,
  encodeDirectory,
  decodeDirectory,
} from '../../src/node/directory.js';
import { TOPICS } from '../../src/node/pubsubTopics.js';
import type { Genome } from '../../src/types/index.js';

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('directory sync over libp2p', () => {
  let alice: HelixNode;
  let bob: HelixNode;

  beforeEach(async () => {
    const [aliceIdentity, bobIdentity] = await Promise.all([generateHelixIdentity(), generateHelixIdentity()]);
    [alice, bob] = await Promise.all([
      createHelixNode({ port: 0, privateKey: aliceIdentity.privateKey }),
      createHelixNode({ port: 0, privateKey: bobIdentity.privateKey }),
    ]);
    await alice.dial(multiaddr(bob.getMultiaddrs()[0]));
  });

  afterEach(async () => {
    await Promise.all([alice.stop(), bob.stop()]);
  });

  it('serves a directory request so the requester verifies and mirrors genomes + posts', async () => {
    const aliceStore = new MemoryStore();
    const bobStore = new MemoryStore();
    registerDirectoryHandler(alice, aliceStore);
    registerDirectoryHandler(bob, bobStore);

    const { genome: aliceGenome } = await registerUser(alice, aliceStore, 'alice');
    const aliceHlc = new HybridLogicalClock(alice.peerId.toString());
    await createPost(alice, aliceStore, aliceHlc, { authorGenome: aliceGenome.genome, content: 'hello from alice' });
    await registerUser(bob, bobStore, 'bob');

    const snapshot = await requestDirectory(bob, alice.peerId, {}, AbortSignal.timeout(10_000));
    const { genomesAccepted, postsAccepted } = ingestDirectory(bobStore, snapshot);

    expect(genomesAccepted).toBeGreaterThanOrEqual(1);
    expect(postsAccepted).toBeGreaterThanOrEqual(1);
    // bob never subscribed to POSTS - the directory is the only path alice's post took
    expect(bobStore.hasGenome(aliceGenome.genome)).toBe(true);
    expect(bobStore.getPostsByGenome(aliceGenome.genome).length).toBe(1);
  });

  it('rejects tampered directory entries instead of trusting them', () => {
    const store = new MemoryStore();
    const fake: Genome = {
      genome: 'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
      displayName: 'eve',
      publicKeyHex: 'aabb'.repeat(16),
      peerId: 'eve-peer',
      powNonce: 0, // would need ~65k average attempts - clearly not a valid proof
    };
    const { genomesAccepted, postsAccepted } = ingestDirectory(store, {
      entries: [{ genome: fake, recentPosts: [], multiaddrs: [] }],
    });

    expect(genomesAccepted).toBe(0);
    expect(postsAccepted).toBe(0);
    expect(store.hasGenome(fake.genome)).toBe(false);
  });

  it('propagates capped directory snapshots over the helix-directory gossipsub topic', async () => {
    const aliceStore = new MemoryStore();
    const bobStore = new MemoryStore();
    const aliceHlc = new HybridLogicalClock(alice.peerId.toString());
    const { genome: aliceGenome } = await registerUser(alice, aliceStore, 'alice');
    await createPost(alice, aliceStore, aliceHlc, { authorGenome: aliceGenome.genome, content: 'broadcast me' });

    bob.services.pubsub.subscribe(TOPICS.DIRECTORY);
    bob.services.pubsub.addEventListener('message', (evt) => {
      if (evt.detail.topic !== TOPICS.DIRECTORY) return;
      ingestDirectory(bobStore, decodeDirectory(evt.detail.data));
    });
    alice.services.pubsub.subscribe(TOPICS.DIRECTORY);

    await waitFor(() => bob.services.pubsub.getSubscribers(TOPICS.DIRECTORY).length >= 1);
    await alice.services.pubsub.publish(TOPICS.DIRECTORY, encodeDirectory(buildDirectorySnapshot(aliceStore, {})));

    await waitFor(() => bobStore.hasGenome(aliceGenome.genome));
    expect(bobStore.getPostsByGenome(aliceGenome.genome).length).toBe(1);
  });
});
