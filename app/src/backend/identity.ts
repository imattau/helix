import { generateKeyPair, privateKeyFromRaw } from "@libp2p/crypto/keys";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
import type { Ed25519PrivateKey, PeerId } from "@libp2p/interface";
import { toHex, fromHex } from "@helix/crypto/hex.js";

const STORAGE_KEY = "helix.identity.privateKeyHex";
const DISPLAY_NAME_KEY = "helix.identity.displayName";

export interface HelixIdentity {
  privateKey: Ed25519PrivateKey;
  peerId: PeerId;
  publicKeyBytes: Uint8Array;
}

/**
 * Loads the persisted Ed25519 identity from localStorage, generating and
 * saving a fresh one on first run. Keeps the genome/peerId stable across
 * page reloads instead of regenerating (and losing) it every session.
 */
export async function loadOrCreateIdentity(): Promise<HelixIdentity> {
  const storedHex = localStorage.getItem(STORAGE_KEY);
  const privateKey = storedHex
    ? (privateKeyFromRaw(fromHex(storedHex)) as Ed25519PrivateKey)
    : await generateKeyPair("Ed25519");

  if (!storedHex) {
    localStorage.setItem(STORAGE_KEY, toHex(privateKey.raw));
  }

  const peerId = peerIdFromPrivateKey(privateKey);
  return { privateKey, peerId, publicKeyBytes: privateKey.publicKey.raw };
}

/**
 * The genome address is deterministically derived from (publicKey, displayName) -
 * see registerUser() - so a returning user must be re-registered with the exact
 * name they originally chose, or they'd silently get a different genome on every
 * reload. Whether this is set is also literally what "has onboarded" means.
 */
export function getStoredDisplayName(): string | null {
  return localStorage.getItem(DISPLAY_NAME_KEY);
}

export function saveDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name);
}
