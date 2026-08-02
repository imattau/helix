import { multiaddr } from '@multiformats/multiaddr';
import { generateHelixIdentity } from '../crypto/keys.js';
import { createHelixNode } from '../node/createNode.js';
import { MemoryStore } from '../store/memoryStore.js';
import { MerkleMountainRange } from '../store/mmr.js';
import { computeMerkleRoot } from '../store/merkle.js';
import { HybridLogicalClock } from '../clock/hlc.js';
import { registerUser, genomeProofInput } from '../api/registerUser.js';
import { createPost, SpamRejectedError, TAD_SIZE } from '../api/createPost.js';
import { followUser } from '../api/follow.js';
import { getSyncState } from '../api/query.js';
import { SpacerRegistry } from '../moderation/spacerRegistry.js';
import { verifyProofOfWork, REGISTRATION_DIFFICULTY_BITS } from '../crypto/pow.js';
import { decodeGenesis, decodePost, decodeFollow, encodeGenesis } from '../node/messages.js';
import { TOPICS } from '../node/pubsubTopics.js';
import { calculate_entropy } from '../math/entropy.js';
import { to_base4, from_base4 } from '../math/base4.js';
import { derive_subkey } from '../crypto/keys.js';
import { fromHex } from '../crypto/hex.js';
import { gf4Checksum, verifyGf4Checksum } from '../math/gf4.js';
import type { Helix, Genome } from '../types/index.js';

// Pre-existing "network knowledge" both peers already agree on - stands in for a
// ratified spacer (out of scope: the DAO submission/voting flow itself, see the plan).
const KNOWN_MISINFO = 'Drinking bleach cures the common cold according to unnamed doctors';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name ?? 'peer';
  const port = Number(args.port ?? 0);
  const isProducer = name === 'alice';

  const identity = await generateHelixIdentity();
  const node = await createHelixNode({ port, privateKey: identity.privateKey });
  const store = new MemoryStore();
  const hlcClock = new HybridLogicalClock(node.peerId.toString());
  const spacerRegistry = new SpacerRegistry();
  spacerRegistry.submitSpacer(KNOWN_MISINFO, 'pre-existing-spacer', 'evidence-ref', 'dao-genesis');

  console.log(`[${name}] PeerId: ${node.peerId.toString()}`);
  for (const addr of node.getMultiaddrs()) {
    console.log(`[${name}] listening on: ${addr.toString()}`);
  }

  node.services.pubsub.subscribe(TOPICS.GENESIS);
  node.services.pubsub.subscribe(TOPICS.POSTS);
  node.services.pubsub.subscribe(TOPICS.FOLLOWS);

  // the first OTHER peer's genome we observe - who this peer will follow in the demo
  let firstPeerGenome: string | undefined;

  // bob mirrors his own MMR purely from what he observes over gossipsub, to prove
  // he isn't just trusting alice's claimed sync state (see query.ts / mmr.ts).
  const mirroredMmrs = new Map<string, MerkleMountainRange>();
  const tadBuffers = new Map<string, Helix[]>();

  node.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic === TOPICS.GENESIS) {
      const msg = decodeGenesis(evt.detail.data);
      const proofInput = genomeProofInput(fromHex(msg.genome.publicKeyHex), msg.genome.genome);
      if (!verifyProofOfWork(proofInput, msg.genome.powNonce, REGISTRATION_DIFFICULTY_BITS)) {
        console.log(`[${name}] [GENESIS-REJECTED] genome=${msg.genome.genome} failed proof-of-work verification - discarded`);
        return;
      }
      store.saveGenome(msg.genome);
      console.log(`[${name}] [GENESIS] accepted genome=${msg.genome.genome} from peer=${msg.genome.peerId} (PoW verified)`);
      if (msg.genome.peerId !== node.peerId.toString() && !firstPeerGenome) {
        firstPeerGenome = msg.genome.genome;
      }
    } else if (evt.detail.topic === TOPICS.FOLLOWS) {
      const follow = decodeFollow(evt.detail.data);
      if (!store.hasGenome(follow.followerGenome) || !store.hasGenome(follow.followeeGenome)) {
        console.log(`[${name}] [FOLLOW-REJECTED] references an unknown genome - discarded`);
        return;
      }
      store.getFollowGraph().addFollow(follow.followerGenome, follow.followeeGenome);
      console.log(`[${name}] [FOLLOW] mirrored ${follow.followerGenome} -> ${follow.followeeGenome}`);
    } else if (evt.detail.topic === TOPICS.POSTS) {
      const post = decodePost(evt.detail.data);
      const recomputedEntropy = calculate_entropy(post.content);
      const checksumOk = verifyGf4Checksum(post.contentHashBase4, post.gf4Checksum);
      hlcClock.update(post.hlcTimestamp);
      console.log(
        `[${name}] [POST] id=${post.postId} twist=${post.twist} writhe=${post.writhe} ` +
          `linkingNumber=${post.linkingNumber} entropy=${post.entropy.toFixed(2)} ` +
          `gf4Checksum=${post.gf4Checksum} hlc=${JSON.stringify(post.hlcTimestamp)}`,
      );
      console.log(
        `[${name}] [VERIFY] recomputed entropy=${recomputedEntropy.toFixed(2)} ` +
          `(matches=${Math.abs(recomputedEntropy - post.entropy) < 1e-9}) checksum valid=${checksumOk}`,
      );

      const misinfoCheck = spacerRegistry.checkContent(post.content);
      if (misinfoCheck.isMisinfo) {
        console.log(
          `[${name}] [CRISPR] post ${post.postId} flagged as near-duplicate of spacer ` +
            `${misinfoCheck.matchedSpacer?.postId} (Hamming distance ${misinfoCheck.distance})`,
        );
      }

      // mirror: buffer posts per genome, fold a TAD root into our own MMR the moment
      // it reaches TAD_SIZE - exactly what the author's own createPost does locally.
      const buffer = tadBuffers.get(post.genome) ?? [];
      buffer.push(post);
      tadBuffers.set(post.genome, buffer);
      if (buffer.length === TAD_SIZE) {
        const tadRoot = computeMerkleRoot(buffer.map((p) => from_base4(p.contentHashBase4)));
        let mmr = mirroredMmrs.get(post.genome);
        if (!mmr) {
          mmr = new MerkleMountainRange();
          mirroredMmrs.set(post.genome, mmr);
        }
        const leafIndex = mmr.append(tadRoot);
        console.log(
          `[${name}] [MMR-MIRROR] independently folded a TAD for genome=${post.genome} into leaf index=${leafIndex}`,
        );
        console.log(`[${name}] [MMR-MIRROR] my sync state:`, JSON.stringify(mmr.getSyncState()));
        tadBuffers.set(post.genome, []);
      }
    }
  });

  if (args.bootstrap) {
    await node.dial(multiaddr(args.bootstrap));
    console.log(`[${name}] dialed bootstrap peer ${args.bootstrap}`);
  }

  // give mDNS/dial a moment to establish the mesh before publishing
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(`[${name}] searching for a registration proof-of-work nonce (difficulty=${REGISTRATION_DIFFICULTY_BITS} bits)...`);
  const registerStart = Date.now();
  const { genome } = await registerUser(node, store, name);
  console.log(`[${name}] registered genome=${genome.genome} (PoW took ${Date.now() - registerStart}ms, nonce=${genome.powNonce})`);

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (isProducer) {
    // demonstrate receiver-side PoW enforcement: publish a forged genesis with an
    // almost-certainly-invalid nonce and let bob's own handler reject it.
    const forgedGenome: Genome = {
      genome: to_base4(derive_subkey(fromHex(genome.publicKeyHex), 'genome:attacker')),
      publicKeyHex: genome.publicKeyHex,
      peerId: genome.peerId,
      powNonce: 0, // ~1/65536 chance of accidentally being valid at 16-bit difficulty
    };
    console.log(`[${name}] publishing a forged genesis (invalid PoW) to demonstrate receiver-side rejection...`);
    await node.services.pubsub.publish(TOPICS.GENESIS, encodeGenesis({ genome: forgedGenome, tadId: 'forged' }));

    await new Promise((resolve) => setTimeout(resolve, 500));

    // create enough posts (TAD_SIZE + 1) to close the first TAD and open a second,
    // so the demo actually exercises an MMR fold. One post paraphrases KNOWN_MISINFO
    // to demonstrate SimHash catching what an exact-hash CRISPR check would miss.
    for (let i = 0; i < TAD_SIZE + 1; i++) {
      const content =
        i === 3
          ? 'Drinking bleach cures the common cold according to unnamed experts' // paraphrase of KNOWN_MISINFO
          : `Hello Helix network, post #${i}! GF4 self-checksum sanity: ${gf4Checksum('ACGT')}`;
      try {
        const post = await createPost(node, store, hlcClock, { authorGenome: genome.genome, content });
        console.log(
          `[${name}] created post #${i} id=${post.postId} twist=${post.twist} writhe=${post.writhe} linkingNumber=${post.linkingNumber}`,
        );
      } catch (err) {
        if (err instanceof SpamRejectedError) {
          console.error(`[${name}] post #${i} rejected: ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    const syncState = getSyncState(store, genome.genome);
    console.log(`[${name}] my sync state:`, JSON.stringify(syncState));
  } else {
    // bob follows the first peer he observed (alice) once her genesis has arrived
    await waitFor(() => firstPeerGenome !== undefined, 5000).catch(() => {});
    if (firstPeerGenome) {
      await followUser(node, store, genome.genome, firstPeerGenome);
      console.log(`[${name}] followed genome=${firstPeerGenome}`);
    }
  }

  if (isProducer) {
    // bob's follow (sent after his own registration + posting-loop-length delay on
    // alice's side) may not have arrived yet - give it a real chance before printing
    await waitFor(() => store.getFollowGraph().getFollowers(genome.genome).length > 0, 5000).catch(() => {});
  } else {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`[${name}] following:`, store.getFollowGraph().getFollowing(genome.genome));
  console.log(`[${name}] followers:`, store.getFollowGraph().getFollowers(genome.genome));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
