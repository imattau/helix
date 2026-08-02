import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { multiaddr } from '@multiformats/multiaddr';
import { generateHelixIdentity } from '../../src/crypto/keys.js';
import { createHelixNode, type HelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { VDFClock } from '../../src/vdf/clock.js';
import { registerUser } from '../../src/api/registerUser.js';
import { createPost, TAD_SIZE } from '../../src/api/createPost.js';
import { getSyncState, getMerkleProof, verifyPost } from '../../src/api/query.js';
import { decodeGenesis, decodePost } from '../../src/node/messages.js';
import { TOPICS } from '../../src/node/pubsubTopics.js';
import { calculate_entropy } from '../../src/math/entropy.js';
import { verifyGf4Checksum } from '../../src/math/gf4.js';
import { computeMerkleRoot } from '../../src/store/merkle.js';
import { MerkleMountainRange } from '../../src/store/mmr.js';
import { from_base4 } from '../../src/math/base4.js';
import { toHex } from '../../src/crypto/hex.js';
import type { Genome, Helix } from '../../src/types/index.js';

// small difficulty so VDF ticks resolve quickly in tests, but not so small that the
// producer outpaces gossipsub mesh formation (see the startup grace pause below)
const TEST_DIFFICULTY = 20_000;

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('two peers over libp2p', () => {
  let alice: HelixNode;
  let bob: HelixNode;

  beforeEach(async () => {
    const aliceIdentity = await generateHelixIdentity();
    const bobIdentity = await generateHelixIdentity();
    alice = await createHelixNode({ port: 0, privateKey: aliceIdentity.privateKey });
    bob = await createHelixNode({ port: 0, privateKey: bobIdentity.privateKey });
    await alice.dial(multiaddr(bob.getMultiaddrs()[0]));
  });

  afterEach(async () => {
    await alice.stop();
    await bob.stop();
  });

  it('propagates genome registration and posts, and bob independently verifies them', async () => {
    const aliceStore = new MemoryStore();
    const bobStore = new MemoryStore();
    const aliceClock = new VDFClock(alice, TEST_DIFFICULTY);
    const bobClock = new VDFClock(bob, TEST_DIFFICULTY);

    let receivedGenome: Genome | undefined;
    let receivedPost: Helix | undefined;
    const receivedPosts: Helix[] = [];
    // bob mirrors his own MMR purely from what he observes over gossipsub
    const bobMirroredMmr = new MerkleMountainRange();

    bob.services.pubsub.subscribe(TOPICS.GENESIS);
    bob.services.pubsub.subscribe(TOPICS.POSTS);
    bobClock.start();
    bob.services.pubsub.addEventListener('message', (evt) => {
      if (evt.detail.topic === TOPICS.GENESIS) {
        const msg = decodeGenesis(evt.detail.data);
        bobStore.saveGenome(msg.genome);
        receivedGenome = msg.genome;
      } else if (evt.detail.topic === TOPICS.POSTS) {
        const post = decodePost(evt.detail.data);
        receivedPost = post;
        receivedPosts.push(post);
        if (receivedPosts.length % TAD_SIZE === 0) {
          const tadPosts = receivedPosts.slice(receivedPosts.length - TAD_SIZE);
          const tadRoot = computeMerkleRoot(tadPosts.map((p) => from_base4(p.contentHashBase4)));
          bobMirroredMmr.append(tadRoot);
        }
      }
    });

    alice.services.pubsub.subscribe(TOPICS.GENESIS);
    alice.services.pubsub.subscribe(TOPICS.POSTS);
    aliceClock.start();
    aliceClock.startProducing();

    // wait for the gossipsub mesh to form on every topic between the two directly-dialed peers
    // before producing anything, so bob doesn't miss early messages (esp. VDF ticks, which
    // the toy clock has no gap-recovery for - see VDFClock's handleIncomingTick).
    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.GENESIS).length > 0);
    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.POSTS).length > 0);
    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.VDF_TICK).length > 0);
    // gossipsub grafts mesh links on a periodic heartbeat; give it a beat to finish
    // before the producer starts, or its earliest ticks race the mesh and get dropped
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const { genome, genesisTad } = await registerUser(alice, aliceStore, 'alice');
    await waitFor(() => receivedGenome !== undefined);

    expect(receivedGenome?.genome).toBe(genome.genome);
    expect(receivedGenome?.peerId).toBe(alice.peerId.toString());

    const createdPosts: Helix[] = [];
    for (let i = 0; i < TAD_SIZE + 1; i++) {
      const post = await createPost(alice, aliceStore, aliceClock, {
        authorGenome: genome.genome,
        content: `Hello Helix network, sufficiently diverse test post number ${i}!`,
      });
      createdPosts.push(post);
    }
    const post = createdPosts[0];
    await waitFor(() => receivedPosts.length >= createdPosts.length);

    expect(receivedPost?.postId).toBe(createdPosts[createdPosts.length - 1].postId);
    expect(receivedPosts[0].postId).toBe(post.postId);
    expect(receivedPosts[0].twist).toBe(0);
    expect(receivedPosts[0].writhe).toBe(0);
    expect(receivedPosts[0].linkingNumber).toBe(1);

    // bob independently recomputes and verifies, rather than trusting alice's claimed values
    const recomputedEntropy = calculate_entropy(receivedPost!.content);
    expect(recomputedEntropy).toBeCloseTo(receivedPost!.entropy, 10);
    expect(verifyGf4Checksum(receivedPost!.contentHashBase4, receivedPost!.gf4Checksum)).toBe(true);

    // bob's VDF clock, having only consumed alice's gossiped ticks, must have verified
    // and advanced to (at least) the tick the post anchors to
    await waitFor(() => bobClock.latestTick().tickIndex >= receivedPost!.vdfTickIndex);
    expect(bobClock.latestTick().tickIndex).toBeGreaterThanOrEqual(receivedPost!.vdfTickIndex);

    expect(genesisTad.tadId).toBeTruthy();

    // alice's first TAD closed after TAD_SIZE posts, folding its root into her MMR;
    // bob independently folded his own mirrored MMR from the same gossiped posts -
    // the two should agree on the resulting peak without bob ever trusting alice's claim.
    const aliceSyncState = getSyncState(aliceStore, genome.genome);
    const bobSyncState = bobMirroredMmr.getSyncState();
    expect(aliceSyncState.totalLeaves).toBe(1);
    expect(bobSyncState.totalLeaves).toBe(1);
    expect(bobSyncState.peaks).toEqual(aliceSyncState.peaks);
    expect(bobSyncState.syncHashHex).toBe(aliceSyncState.syncHashHex);

    // a full two-level proof (post -> TAD root -> MMR peak) for a post in the closed TAD verifies
    const { post: provenPost, tadMerkleRootHex, tadProof, mmrProof } = getMerkleProof(aliceStore, genome.genome, 3);
    expect(
      verifyPost(provenPost, tadMerkleRootHex, tadProof, mmrProof, aliceSyncState.peaks),
    ).toBe(true);
  });
});
