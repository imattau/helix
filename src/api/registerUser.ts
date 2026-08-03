import { to_base4, from_base4 } from '../math/base4.js';
import { derive_subkey } from '../crypto/keys.js';
import { toHex } from '../crypto/hex.js';
import { findProofOfWork, REGISTRATION_DIFFICULTY_BITS } from '../crypto/pow.js';
import { TOPICS } from '../node/pubsubTopics.js';
import { encodeGenesis } from '../node/messages.js';
import type { HelixNode } from '../node/createNode.js';
import type { HelixStore } from '../store/memoryStore.js';
import type { Genome, TAD } from '../types/index.js';

export interface RegisterUserResult {
  genome: Genome;
  genesisTad: TAD;
}

/** The exact bytes the registration proof-of-work is computed over — shared so receivers can re-verify it. */
export function genomeProofInput(publicKeyBytes: Uint8Array, genome: string): Uint8Array {
  const genomeBytes = from_base4(genome);
  const out = new Uint8Array(publicKeyBytes.length + genomeBytes.length);
  out.set(publicKeyBytes, 0);
  out.set(genomeBytes, publicKeyBytes.length);
  return out;
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
  const publicKeyHex = toHex(publicKeyBytes);

  // A returning user's own genome is deterministically derived from (publicKey,
  // displayName) and is already in a persisted store - that's a restart, not a
  // collision, so reuse it instead of deriving a fresh `:1` genome (which would
  // silently fork the identity on every reload). Only a genome owned by a
  // DIFFERENT public key counts as a collision worth bumping past.
  let genome = to_base4(derive_subkey(publicKeyBytes, `genome:${displayName}`));
  let attempt = 0;
  let owned = store.getGenome(genome);
  while (store.hasGenome(genome) && owned?.publicKeyHex !== publicKeyHex) {
    attempt += 1;
    genome = to_base4(derive_subkey(publicKeyBytes, `genome:${displayName}:${attempt}`));
    owned = store.getGenome(genome);
  }

  if (owned) {
    // Re-registration after a restart: reuse the persisted genome record, make
    // sure an open TAD exists for future posts, and re-announce the genesis so
    // the mesh (and any fresh store) learns we're back. Not a fresh registration.
    const genesisTad = store.getOpenTad(owned.genome) ?? store.createTad(owned.genome);
    await node.services.pubsub.publish(TOPICS.GENESIS, encodeGenesis({ genome: owned, tadId: genesisTad.tadId }));
    return { genome: owned, genesisTad };
  }

  // Registration has a real cost: find a nonce over (pubkey ++ genome) whose hash meets
  // the network's difficulty target. Every receiver re-verifies this (see the genesis
  // handlers in src/cli/peer.ts and the integration test) - unlimited free identities
  // are no longer possible, replacing the "None" Sybil resistance from the original spec.
  const { nonce: powNonce } = findProofOfWork(genomeProofInput(publicKeyBytes, genome), REGISTRATION_DIFFICULTY_BITS);

  const genomeRecord: Genome = {
    genome,
    displayName,
    publicKeyHex: toHex(publicKeyBytes),
    peerId: node.peerId.toString(),
    powNonce,
  };
  const genesisTad = store.createTad(genome);
  store.saveGenome(genomeRecord);

  await node.services.pubsub.publish(
    TOPICS.GENESIS,
    encodeGenesis({ genome: genomeRecord, tadId: genesisTad.tadId }),
  );

  return { genome: genomeRecord, genesisTad };
}
