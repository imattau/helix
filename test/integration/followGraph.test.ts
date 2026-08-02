import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { multiaddr } from '@multiformats/multiaddr';
import { generateHelixIdentity } from '../../src/crypto/keys.js';
import { createHelixNode, type HelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { registerUser, genomeProofInput } from '../../src/api/registerUser.js';
import { followUser } from '../../src/api/follow.js';
import { verifyProofOfWork, REGISTRATION_DIFFICULTY_BITS } from '../../src/crypto/pow.js';
import { decodeGenesis, decodeFollow, encodeFollow } from '../../src/node/messages.js';
import { TOPICS } from '../../src/node/pubsubTopics.js';
import { fromHex } from '../../src/crypto/hex.js';
import type { HelixStore } from '../../src/store/memoryStore.js';

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Wires up a node's genesis/follow receive handlers exactly as src/cli/peer.ts does. */
function wireReceiver(node: HelixNode, store: HelixStore, rejected: { genesis: number; follow: number }) {
  node.services.pubsub.subscribe(TOPICS.GENESIS);
  node.services.pubsub.subscribe(TOPICS.FOLLOWS);
  node.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic === TOPICS.GENESIS) {
      const msg = decodeGenesis(evt.detail.data);
      const proofInput = genomeProofInput(fromHex(msg.genome.publicKeyHex), msg.genome.genome);
      if (!verifyProofOfWork(proofInput, msg.genome.powNonce, REGISTRATION_DIFFICULTY_BITS)) {
        rejected.genesis++;
        return;
      }
      store.saveGenome(msg.genome);
    } else if (evt.detail.topic === TOPICS.FOLLOWS) {
      const follow = decodeFollow(evt.detail.data);
      if (!store.hasGenome(follow.followerGenome) || !store.hasGenome(follow.followeeGenome)) {
        rejected.follow++;
        return;
      }
      store.getFollowGraph().addFollow(follow.followerGenome, follow.followeeGenome);
    }
  });
}

describe('four-peer follow graph over libp2p', () => {
  let alice: HelixNode;
  let bob: HelixNode;
  let carol: HelixNode;
  let charlie: HelixNode;

  beforeEach(async () => {
    const [aliceIdentity, bobIdentity, carolIdentity, charlieIdentity] = await Promise.all([
      generateHelixIdentity(),
      generateHelixIdentity(),
      generateHelixIdentity(),
      generateHelixIdentity(),
    ]);
    [alice, bob, carol, charlie] = await Promise.all([
      createHelixNode({ port: 0, privateKey: aliceIdentity.privateKey }),
      createHelixNode({ port: 0, privateKey: bobIdentity.privateKey }),
      createHelixNode({ port: 0, privateKey: carolIdentity.privateKey }),
      createHelixNode({ port: 0, privateKey: charlieIdentity.privateKey }),
    ]);
    // fully connect all four so gossipsub doesn't depend on multi-hop forwarding timing
    await alice.dial(multiaddr(bob.getMultiaddrs()[0]));
    await alice.dial(multiaddr(carol.getMultiaddrs()[0]));
    await alice.dial(multiaddr(charlie.getMultiaddrs()[0]));
    await bob.dial(multiaddr(carol.getMultiaddrs()[0]));
    await bob.dial(multiaddr(charlie.getMultiaddrs()[0]));
    await carol.dial(multiaddr(charlie.getMultiaddrs()[0]));
  });

  afterEach(async () => {
    await Promise.all([alice.stop(), bob.stop(), carol.stop(), charlie.stop()]);
  });

  it('propagates follows so every peer independently mirrors the same follow graph', async () => {
    const aliceStore = new MemoryStore();
    const bobStore = new MemoryStore();
    const carolStore = new MemoryStore();
    const charlieStore = new MemoryStore();
    const aliceRejected = { genesis: 0, follow: 0 };
    const bobRejected = { genesis: 0, follow: 0 };
    const carolRejected = { genesis: 0, follow: 0 };
    const charlieRejected = { genesis: 0, follow: 0 };

    wireReceiver(alice, aliceStore, aliceRejected);
    wireReceiver(bob, bobStore, bobRejected);
    wireReceiver(carol, carolStore, carolRejected);
    wireReceiver(charlie, charlieStore, charlieRejected);

    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.GENESIS).length >= 3);
    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.FOLLOWS).length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const { genome: aliceGenome } = await registerUser(alice, aliceStore, 'alice');
    await waitFor(
      () =>
        bobStore.hasGenome(aliceGenome.genome) &&
        carolStore.hasGenome(aliceGenome.genome) &&
        charlieStore.hasGenome(aliceGenome.genome),
    );

    const { genome: bobGenome } = await registerUser(bob, bobStore, 'bob');
    await waitFor(
      () =>
        aliceStore.hasGenome(bobGenome.genome) &&
        carolStore.hasGenome(bobGenome.genome) &&
        charlieStore.hasGenome(bobGenome.genome),
    );

    const { genome: carolGenome } = await registerUser(carol, carolStore, 'carol');
    await waitFor(
      () =>
        aliceStore.hasGenome(carolGenome.genome) &&
        bobStore.hasGenome(carolGenome.genome) &&
        charlieStore.hasGenome(carolGenome.genome),
    );

    // charlie registers like everyone else but never follows anyone, and no one follows him
    const { genome: charlieGenome } = await registerUser(charlie, charlieStore, 'charlie');
    await waitFor(
      () =>
        aliceStore.hasGenome(charlieGenome.genome) &&
        bobStore.hasGenome(charlieGenome.genome) &&
        carolStore.hasGenome(charlieGenome.genome),
    );

    // bob follows alice; carol follows bob -> carol is alice's follower-of-follower
    await followUser(bob, bobStore, bobGenome.genome, aliceGenome.genome);
    await waitFor(
      () =>
        aliceStore.getFollowGraph().getFollowers(aliceGenome.genome).length === 1 &&
        carolStore.getFollowGraph().getFollowers(aliceGenome.genome).length === 1 &&
        charlieStore.getFollowGraph().getFollowers(aliceGenome.genome).length === 1,
    );

    await followUser(carol, carolStore, carolGenome.genome, bobGenome.genome);
    await waitFor(
      () =>
        aliceStore.getFollowGraph().getFollowers(bobGenome.genome).length === 1 &&
        bobStore.getFollowGraph().getFollowers(bobGenome.genome).length === 1 &&
        charlieStore.getFollowGraph().getFollowers(bobGenome.genome).length === 1,
    );

    for (const store of [aliceStore, bobStore, carolStore, charlieStore]) {
      expect(store.getFollowGraph().getFollowers(aliceGenome.genome)).toEqual([bobGenome.genome]);
      expect(store.getFollowGraph().getFollowing(bobGenome.genome)).toEqual(
        expect.arrayContaining([aliceGenome.genome]),
      );
      expect(store.getFollowGraph().getFollowersOfFollowers(aliceGenome.genome)).toEqual([carolGenome.genome]);

      // charlie registered on every peer (they all know his genome) but never touched
      // a follow edge - he must not leak into alice's followers-of-followers, and every
      // peer's own view of his follow graph must be empty, not just his own
      expect(store.getFollowGraph().getFollowersOfFollowers(aliceGenome.genome)).not.toContain(
        charlieGenome.genome,
      );
      expect(store.getFollowGraph().getFollowers(charlieGenome.genome)).toEqual([]);
      expect(store.getFollowGraph().getFollowing(charlieGenome.genome)).toEqual([]);
    }

    // a follow message referencing an unregistered genome must be rejected by every receiver
    await alice.services.pubsub.publish(
      TOPICS.FOLLOWS,
      encodeFollow({ followerGenome: 'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT', followeeGenome: aliceGenome.genome }),
    );
    await waitFor(() => bobRejected.follow > 0 && carolRejected.follow > 0 && charlieRejected.follow > 0);
    expect(bobStore.getFollowGraph().getFollowers(aliceGenome.genome)).toEqual([bobGenome.genome]);
    expect(carolStore.getFollowGraph().getFollowers(aliceGenome.genome)).toEqual([bobGenome.genome]);
    expect(charlieStore.getFollowGraph().getFollowers(aliceGenome.genome)).toEqual([bobGenome.genome]);
  });
});
