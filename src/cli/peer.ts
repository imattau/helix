import { multiaddr } from '@multiformats/multiaddr';
import { multiaddr as multiaddrV13 } from '@multiformats/multiaddr-v13';
import { generateHelixIdentity } from '../crypto/keys.js';
import { createHelixNode } from '../node/createNode.js';
import { createIpfsNode, type IpfsNode } from '../ipfs/node.js';
import { MemoryStore } from '../store/memoryStore.js';
import { MerkleMountainRange } from '../store/mmr.js';
import { computeMerkleRoot } from '../store/merkle.js';
import { HybridLogicalClock } from '../clock/hlc.js';
import { registerUser, genomeProofInput } from '../api/registerUser.js';
import { createPost, SpamRejectedError, TAD_SIZE } from '../api/createPost.js';
import { followUser } from '../api/follow.js';
import { getSyncState } from '../api/query.js';
import { fetchAndVerifyAttachment, fetchAndVerifyAttachmentFromIpfs, publishAttachmentToIpfs, toDataUrl } from '../api/attachment.js';
import { SpacerRegistry } from '../moderation/spacerRegistry.js';
import { verifyProofOfWork, REGISTRATION_DIFFICULTY_BITS } from '../crypto/pow.js';
import { decodeGenesis, decodePost, decodeFollow, decodeIpfsAddr, encodeGenesis, encodeIpfsAddr } from '../node/messages.js';
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
  const ipfsNode: IpfsNode = await createIpfsNode();
  const store = new MemoryStore();
  const hlcClock = new HybridLogicalClock(node.peerId.toString());
  const spacerRegistry = new SpacerRegistry();
  spacerRegistry.submitSpacer(KNOWN_MISINFO, 'pre-existing-spacer', 'evidence-ref', 'dao-genesis');

  console.log(`[${name}] PeerId: ${node.peerId.toString()}`);
  for (const addr of node.getMultiaddrs()) {
    console.log(`[${name}] listening on: ${addr.toString()}`);
  }
  console.log(`[${name}] IPFS PeerId: ${ipfsNode.libp2p.peerId.toString()} (separate node - see src/ipfs/node.ts)`);

  node.services.pubsub.subscribe(TOPICS.GENESIS);
  node.services.pubsub.subscribe(TOPICS.POSTS);
  node.services.pubsub.subscribe(TOPICS.FOLLOWS);
  node.services.pubsub.subscribe(TOPICS.IPFS_ADDR);

  // the first OTHER peer's genome we observe - who this peer will follow in the demo
  let firstPeerGenome: string | undefined;

  // bob mirrors his own MMR purely from what he observes over gossipsub, to prove
  // he isn't just trusting alice's claimed sync state (see query.ts / mmr.ts).
  const mirroredMmrs = new Map<string, MerkleMountainRange>();
  const tadBuffers = new Map<string, Helix[]>();

  node.services.pubsub.addEventListener('message', (evt) => {
    try {
      handleMessage(evt);
    } catch (err) {
      console.error(`[${name}] [HANDLER-ERROR]`, err);
    }
  });

  function handleMessage(evt: { detail: { topic: string; data: Uint8Array } }) {
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
    } else if (evt.detail.topic === TOPICS.IPFS_ADDR) {
      const msg = decodeIpfsAddr(evt.detail.data);
      if (msg.peerId === ipfsNode.libp2p.peerId.toString()) return; // ignore our own announcement
      const dialable = msg.multiaddrs.find(
        (addr) => addr.includes('127.0.0.1') && addr.includes('/tcp/') && !addr.includes('/ws'),
      );
      if (!dialable) return;
      ipfsNode.libp2p
        .dial(multiaddrV13(dialable))
        .then(() => console.log(`[${name}] [IPFS] dialed peer's IPFS node at ${dialable}`))
        .catch((err) => console.error(`[${name}] [IPFS] failed to dial peer's IPFS node: ${err.message}`));
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

      if (post.attachment) {
        // the attachment's bytes never came over gossipsub - only this metadata did.
        // Independently fetch and verify them before trusting the content exists.
        // Both transports are demonstrated side by side: generic URL fetch (existing)
        // and real IPFS bitswap (additive, does not replace the URL path).
        fetchAndVerifyAttachment(post.attachment)
          .then((bytes) => {
            console.log(
              `[${name}] [ATTACHMENT-URL] verified ${post.attachment!.mimeType}, ${bytes.length} bytes, ` +
                `hash=${post.attachment!.hashHex.slice(0, 16)}...`,
            );
          })
          .catch((err) => {
            console.error(`[${name}] [ATTACHMENT-URL-REJECTED] ${err.message}`);
          });

        if (post.attachment.ipfsCid) {
          fetchAndVerifyAttachmentFromIpfs(ipfsNode, post.attachment)
            .then((bytes) => {
              console.log(
                `[${name}] [ATTACHMENT-IPFS] verified ${bytes.length} bytes via real bitswap, cid=${post.attachment!.ipfsCid}`,
              );
            })
            .catch((err) => {
              console.error(`[${name}] [ATTACHMENT-IPFS-REJECTED] ${err.message}`);
            });
        }
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
  }

  if (args.bootstrap) {
    // mDNS peer discovery (also active) can occasionally race this explicit dial and
    // disrupt an in-flight connection upgrade - intermittently a timeout, sometimes a
    // handshake failure, depending on timing luck. A bounded retry is the pragmatic
    // fix for a CLI demo already tuned around this class of timing sensitivity,
    // rather than disabling mDNS (which is otherwise a reasonable discovery bonus).
    const bootstrapTarget = multiaddr(args.bootstrap);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await node.dial(bootstrapTarget, { signal: AbortSignal.timeout(15_000) });
        console.log(`[${name}] dialed bootstrap peer ${args.bootstrap}`);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[${name}] dial attempt ${attempt}/3 failed: ${(err as Error).message} - retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (lastErr) throw lastErr;
  }

  // alice (isProducer) is the one who broadcasts time-sensitive things (genesis,
  // posts) early, so she's the one who needs to confirm bob's gossipsub mesh has
  // actually formed - not just a fixed sleep - before publishing. Mirrors the
  // reliable pattern already used throughout the automated test suite. Best-effort:
  // proceeds anyway if nobody's connected within the window, since a genuinely solo
  // node shouldn't wait forever.
  if (isProducer) {
    await waitFor(() => node.services.pubsub.getSubscribers(TOPICS.GENESIS).length > 0, 15_000).catch(() => {
      console.error(`[${name}] no gossipsub subscriber appeared within 15s - proceeding anyway`);
    });
  } else {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // announce this peer's separate IPFS node so the other side can dial it directly
  // (see TOPICS.IPFS_ADDR - mDNS auto-discovery between two independent Helia nodes
  // proved unreliable, so the already-connected Helix gossipsub mesh signals instead)
  await node.services.pubsub.publish(
    TOPICS.IPFS_ADDR,
    encodeIpfsAddr({
      peerId: ipfsNode.libp2p.peerId.toString(),
      multiaddrs: ipfsNode.libp2p.getMultiaddrs().map((addr) => addr.toString()),
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));

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
      displayName: 'attacker',
      publicKeyHex: genome.publicKeyHex,
      peerId: genome.peerId,
      powNonce: 0, // ~1/65536 chance of accidentally being valid at 16-bit difficulty
    };
    console.log(`[${name}] publishing a forged genesis (invalid PoW) to demonstrate receiver-side rejection...`);
    await node.services.pubsub.publish(TOPICS.GENESIS, encodeGenesis({ genome: forgedGenome, tadId: 'forged' }));

    await new Promise((resolve) => setTimeout(resolve, 500));

    const attachmentBytes = new TextEncoder().encode(
      '# A long-form article\n\nThis is far more text than would ever fit as tweet-length ' +
        'content - the whole reason attachments exist. Hosted outside the gossiped post, ' +
        'referenced by hash.',
    );
    const attachmentMimeType = 'text/markdown';
    const attachmentIpfsCid = await publishAttachmentToIpfs(ipfsNode, attachmentBytes);
    console.log(`[${name}] published attachment to IPFS: cid=${attachmentIpfsCid}`);

    // create enough posts (TAD_SIZE + 1) to close the first TAD and open a second,
    // so the demo actually exercises an MMR fold. One post paraphrases KNOWN_MISINFO
    // to demonstrate SimHash catching what an exact-hash CRISPR check would miss;
    // another carries a long-form markdown attachment.
    for (let i = 0; i < TAD_SIZE + 1; i++) {
      const content =
        i === 3
          ? 'Drinking bleach cures the common cold according to unnamed experts' // paraphrase of KNOWN_MISINFO
          : i === 5
            ? 'Just published a long-form piece - see the attached article.'
            : `Hello Helix network, post #${i}! GF4 self-checksum sanity: ${gf4Checksum('ACGT')}`;
      const attachment =
        i === 5
          ? {
              bytes: attachmentBytes,
              mimeType: attachmentMimeType,
              sourceUrl: toDataUrl(attachmentBytes, attachmentMimeType),
              ipfsCid: attachmentIpfsCid,
            }
          : undefined;
      try {
        const post = await createPost(node, store, hlcClock, { authorGenome: genome.genome, content, attachment });
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
      await followUser(node, store, hlcClock, genome.genome, firstPeerGenome);
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

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
