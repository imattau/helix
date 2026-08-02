import { multiaddr } from '@multiformats/multiaddr';
import { generateHelixIdentity } from '../crypto/keys.js';
import { createHelixNode } from '../node/createNode.js';
import { MemoryStore } from '../store/memoryStore.js';
import { MerkleMountainRange } from '../store/mmr.js';
import { computeMerkleRoot } from '../store/merkle.js';
import { VDFClock } from '../vdf/clock.js';
import { registerUser } from '../api/registerUser.js';
import { createPost, SpamRejectedError, TAD_SIZE } from '../api/createPost.js';
import { getSyncState } from '../api/query.js';
import { decodeGenesis, decodePost } from '../node/messages.js';
import { TOPICS } from '../node/pubsubTopics.js';
import { calculate_entropy } from '../math/entropy.js';
import { from_base4 } from '../math/base4.js';
import { gf4Checksum, verifyGf4Checksum } from '../math/gf4.js';
import type { Helix } from '../types/index.js';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name ?? 'peer';
  const port = Number(args.port ?? 0);
  const isProducer = name === 'alice';

  const identity = await generateHelixIdentity();
  const node = await createHelixNode({ port, privateKey: identity.privateKey });
  const store = new MemoryStore();
  const vdfClock = new VDFClock(node);

  console.log(`[${name}] PeerId: ${node.peerId.toString()}`);
  for (const addr of node.getMultiaddrs()) {
    console.log(`[${name}] listening on: ${addr.toString()}`);
  }

  node.services.pubsub.subscribe(TOPICS.GENESIS);
  node.services.pubsub.subscribe(TOPICS.POSTS);
  vdfClock.start();

  // bob mirrors his own MMR purely from what he observes over gossipsub, to prove
  // he isn't just trusting alice's claimed sync state (see query.ts / mmr.ts).
  const mirroredMmrs = new Map<string, MerkleMountainRange>();
  const tadBuffers = new Map<string, Helix[]>();

  node.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic === TOPICS.GENESIS) {
      const msg = decodeGenesis(evt.detail.data);
      store.saveGenome(msg.genome);
      console.log(`[${name}] [GENESIS] received genome=${msg.genome.genome} from peer=${msg.genome.peerId}`);
    } else if (evt.detail.topic === TOPICS.POSTS) {
      const post = decodePost(evt.detail.data);
      const recomputedEntropy = calculate_entropy(post.content);
      const checksumOk = verifyGf4Checksum(post.contentHashBase4, post.gf4Checksum);
      console.log(
        `[${name}] [POST] id=${post.postId} twist=${post.twist} writhe=${post.writhe} ` +
          `linkingNumber=${post.linkingNumber} entropy=${post.entropy.toFixed(2)} ` +
          `gf4Checksum=${post.gf4Checksum} vdfTick=${post.vdfTickIndex}`,
      );
      console.log(
        `[${name}] [VERIFY] recomputed entropy=${recomputedEntropy.toFixed(2)} ` +
          `(matches=${Math.abs(recomputedEntropy - post.entropy) < 1e-9}) checksum valid=${checksumOk}`,
      );

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

  if (isProducer) {
    vdfClock.startProducing();
    // give mDNS/dial a moment to establish the mesh before publishing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const { genome } = await registerUser(node, store, name);
    console.log(`[${name}] registered genome=${genome.genome}`);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // create enough posts (TAD_SIZE + 1) to close the first TAD and open a second,
    // so the demo actually exercises an MMR fold.
    for (let i = 0; i < TAD_SIZE + 1; i++) {
      try {
        const post = await createPost(node, store, vdfClock, {
          authorGenome: genome.genome,
          content: `Hello Helix network, post #${i}! GF4 self-checksum sanity: ${gf4Checksum('ACGT')}`,
        });
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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
