import { to_base4 } from '../math/base4.js';
import { derive_subkey } from '../crypto/keys.js';
import { toHex } from '../crypto/hex.js';
import { TOPICS } from '../node/pubsubTopics.js';
import { encodeGenesis } from '../node/messages.js';
import type { HelixNode } from '../node/createNode.js';
import type { HelixStore } from '../store/memoryStore.js';
import type { Genome, TAD } from '../types/index.js';

export interface RegisterUserResult {
  genome: Genome;
  genesisTad: TAD;
}

/**
 * Derives a genome address from the node's own Ed25519 identity (the same key that
 * IS the node's PeerId - "genome derived from public key" is literal here), creates
 * a genesis TAD, and broadcasts both over the `helix-genesis` gossipsub topic.
 *
 * `network.genome_exists` from the pseudocode is answered from the local store, which
 * is kept up to date by observing `helix-genesis` broadcasts from every peer (see
 * src/node/createNode.ts for why this replaces a DHT lookup in this prototype pass).
 */
export async function registerUser(
  node: HelixNode,
  store: HelixStore,
  displayName: string,
): Promise<RegisterUserResult> {
  const publicKeyBytes = node.peerId.publicKey?.raw;
  if (!publicKeyBytes) {
    throw new Error('registerUser: node identity has no inlined public key');
  }

  let genome = to_base4(derive_subkey(publicKeyBytes, `genome:${displayName}`));
  let attempt = 0;
  while (store.hasGenome(genome)) {
    attempt += 1;
    genome = to_base4(derive_subkey(publicKeyBytes, `genome:${displayName}:${attempt}`));
  }

  const genomeRecord: Genome = {
    genome,
    publicKeyHex: toHex(publicKeyBytes),
    peerId: node.peerId.toString(),
  };
  const genesisTad = store.createTad(genome);
  store.saveGenome(genomeRecord);

  await node.services.pubsub.publish(
    TOPICS.GENESIS,
    encodeGenesis({ genome: genomeRecord, tadId: genesisTad.tadId }),
  );

  return { genome: genomeRecord, genesisTad };
}
