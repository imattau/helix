import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { multiaddr } from '@multiformats/multiaddr';
import { generateHelixIdentity } from '../../src/crypto/keys.js';
import { createHelixNode, type HelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { HybridLogicalClock } from '../../src/clock/hlc.js';
import { registerUser, genomeProofInput } from '../../src/api/registerUser.js';
import { createPost, TAD_SIZE } from '../../src/api/createPost.js';
import { getSyncState, getMerkleProof, verifyPost } from '../../src/api/query.js';
import { SpacerRegistry } from '../../src/moderation/spacerRegistry.js';
import { verifyProofOfWork, REGISTRATION_DIFFICULTY_BITS } from '../../src/crypto/pow.js';
import { decodeGenesis, decodePost, encodeGenesis } from '../../src/node/messages.js';
import { TOPICS } from '../../src/node/pubsubTopics.js';
import { calculate_entropy } from '../../src/math/entropy.js';
import { verifyGf4Checksum } from '../../src/math/gf4.js';
import { computeMerkleRoot } from '../../src/store/merkle.js';
import { MerkleMountainRange } from '../../src/store/mmr.js';
import { from_base4, to_base4 } from '../../src/math/base4.js';
import { fromHex } from '../../src/crypto/hex.js';
import { derive_subkey } from '../../src/crypto/keys.js';
import type { Genome, Helix, HLCTimestamp } from '../../src/types/index.js';

const KNOWN_MISINFO = 'Drinking bleach cures the common cold according to unnamed doctors';

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
    const aliceClock = new HybridLogicalClock(alice.peerId.toString());
    const bobClock = new HybridLogicalClock(bob.peerId.toString());
    const bobSpacerRegistry = new SpacerRegistry();
    bobSpacerRegistry.submitSpacer(KNOWN_MISINFO, 'pre-existing-spacer', 'evidence-ref', 'dao-genesis');

    let receivedGenome: Genome | undefined;
    let rejectedGenomeCount = 0;
    let receivedPost: Helix | undefined;
    let bobLastMergedTimestamp: HLCTimestamp | undefined;
    let misinfoFlagged = false;
    const receivedPosts: Helix[] = [];
    // bob mirrors his own MMR purely from what he observes over gossipsub
    const bobMirroredMmr = new MerkleMountainRange();

    bob.services.pubsub.subscribe(TOPICS.GENESIS);
    bob.services.pubsub.subscribe(TOPICS.POSTS);
    bob.services.pubsub.addEventListener('message', (evt) => {
      if (evt.detail.topic === TOPICS.GENESIS) {
        const msg = decodeGenesis(evt.detail.data);
        const proofInput = genomeProofInput(fromHex(msg.genome.publicKeyHex), msg.genome.genome);
        if (!verifyProofOfWork(proofInput, msg.genome.powNonce, REGISTRATION_DIFFICULTY_BITS)) {
          rejectedGenomeCount++;
          return; // receiver-side enforcement: an invalid proof-of-work is discarded, not stored
        }
        bobStore.saveGenome(msg.genome);
        receivedGenome = msg.genome;
      } else if (evt.detail.topic === TOPICS.POSTS) {
        const post = decodePost(evt.detail.data);
        receivedPost = post;
        receivedPosts.push(post);
        bobLastMergedTimestamp = bobClock.update(post.hlcTimestamp);
        if (bobSpacerRegistry.checkContent(post.content).isMisinfo) misinfoFlagged = true;

        if (receivedPosts.length % TAD_SIZE === 0) {
          const tadPosts = receivedPosts.slice(receivedPosts.length - TAD_SIZE);
          const tadRoot = computeMerkleRoot(tadPosts.map((p) => from_base4(p.contentHashBase4)));
          bobMirroredMmr.append(tadRoot);
        }
      }
    });

    alice.services.pubsub.subscribe(TOPICS.GENESIS);
    alice.services.pubsub.subscribe(TOPICS.POSTS);

    // wait for the gossipsub mesh to form between the two directly-dialed peers before
    // publishing, so bob doesn't miss the earliest messages
    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.GENESIS).length > 0);
    await waitFor(() => alice.services.pubsub.getSubscribers(TOPICS.POSTS).length > 0);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const { genome, genesisTad } = await registerUser(alice, aliceStore, 'alice');
    await waitFor(() => receivedGenome !== undefined);

    expect(receivedGenome?.genome).toBe(genome.genome);
    expect(receivedGenome?.peerId).toBe(alice.peerId.toString());

    // a forged genesis with an invalid proof-of-work nonce must be rejected by bob's
    // own receiver, not merely by whether alice bothered to compute one honestly
    const forgedGenome: Genome = {
      genome: to_base4(derive_subkey(fromHex(genome.publicKeyHex), 'genome:attacker')),
      publicKeyHex: genome.publicKeyHex,
      peerId: genome.peerId,
      powNonce: 0, // ~1/65536 chance of accidentally satisfying the 16-bit difficulty
    };
    await alice.services.pubsub.publish(TOPICS.GENESIS, encodeGenesis({ genome: forgedGenome, tadId: 'forged' }));
    await waitFor(() => rejectedGenomeCount > 0);
    expect(bobStore.hasGenome(forgedGenome.genome)).toBe(false);

    const createdPosts: Helix[] = [];
    for (let i = 0; i < TAD_SIZE + 1; i++) {
      const content =
        i === 3
          ? 'Drinking bleach cures the common cold according to unnamed experts' // paraphrase of KNOWN_MISINFO
          : `Hello Helix network, sufficiently diverse test post number ${i}!`;
      const post = await createPost(alice, aliceStore, aliceClock, { authorGenome: genome.genome, content });
      createdPosts.push(post);
    }
    const post = createdPosts[0];
    await waitFor(() => receivedPosts.length >= createdPosts.length);

    expect(receivedPost?.postId).toBe(createdPosts[createdPosts.length - 1].postId);
    expect(receivedPosts[0].postId).toBe(post.postId);
    expect(receivedPosts[0].twist).toBe(0);
    expect(receivedPosts[0].writhe).toBe(0);
    expect(receivedPosts[0].linkingNumber).toBe(1);
    expect(receivedPosts[0].hlcTimestamp.peerId).toBe(alice.peerId.toString());
    expect(receivedPosts[0].causalParents).toEqual([]);

    // bob's SimHash check flagged the paraphrase (post #3) that an exact-hash CRISPR
    // check (the original design) would have missed entirely
    expect(misinfoFlagged).toBe(true);

    // bob independently recomputes and verifies, rather than trusting alice's claimed values
    const recomputedEntropy = calculate_entropy(receivedPost!.content);
    expect(recomputedEntropy).toBeCloseTo(receivedPost!.entropy, 10);
    expect(verifyGf4Checksum(receivedPost!.contentHashBase4, receivedPost!.gf4Checksum)).toBe(true);

    // bob's own Hybrid Logical Clock, having only merged observed post timestamps
    // (no producer role, unlike the old VDF clock), stays causally consistent with alice
    expect(HybridLogicalClock.compare(bobLastMergedTimestamp!, receivedPost!.hlcTimestamp)).not.toBe(-1);

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
    expect(verifyPost(provenPost, tadMerkleRootHex, tadProof, mmrProof, aliceSyncState.peaks)).toBe(true);
  });
});
