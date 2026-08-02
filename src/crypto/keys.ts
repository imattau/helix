import { hkdfSync } from 'node:crypto';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { Ed25519PrivateKey, PeerId } from '@libp2p/interface';

export interface HelixIdentity {
  privateKey: Ed25519PrivateKey;
  peerId: PeerId;
  publicKeyBytes: Uint8Array;
}

export async function generateHelixIdentity(): Promise<HelixIdentity> {
  const privateKey = await generateKeyPair('Ed25519');
  const peerId = peerIdFromPrivateKey(privateKey);
  return { privateKey, peerId, publicKeyBytes: privateKey.publicKey.raw };
}

const GENOME_HKDF_INFO = new TextEncoder().encode('helix-genome-v1');

/**
 * Derives a fixed-length byte sequence from a public key via HKDF, used as the
 * seed fed into to_base4() for genome generation. Keeps genome derivation an
 * intentional, versioned transform rather than "just the raw public key re-encoded".
 */
export function derive_subkey(publicKeyBytes: Uint8Array, salt: string, lengthBytes = 8): Uint8Array {
  const derived = hkdfSync(
    'sha256',
    publicKeyBytes,
    new TextEncoder().encode(salt),
    GENOME_HKDF_INFO,
    lengthBytes,
  );
  return new Uint8Array(derived);
}
