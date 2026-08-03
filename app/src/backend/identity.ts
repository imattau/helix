import { generateKeyPair, privateKeyFromRaw } from "@libp2p/crypto/keys";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
import type { Ed25519PrivateKey, PeerId } from "@libp2p/interface";
import { toHex, fromHex } from "@helix/crypto/hex.js";

const STORAGE_KEY = "helix.identity.privateKeyHex";
const DISPLAY_NAME_KEY = "helix.identity.displayName";
const PUBLIC_DISCOVERY_KEY = "helix.identity.publicDiscoveryEnabled";

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
 * The raw Ed25519 private key as hex, for the user to back up themselves - this is
 * the ONLY copy of their identity; there's no server-side account to recover it
 * from, and localStorage can be cleared (or never synced to a new device) without
 * warning. Idempotent with loadOrCreateIdentity() - reads the existing key if one
 * is already stored, generates one otherwise.
 */
export async function exportPrivateKeyHex(): Promise<string> {
  const { privateKey } = await loadOrCreateIdentity();
  return toHex(privateKey.raw);
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

/**
 * Whether to join the public IPFS/libp2p DHT for peer rendezvous beyond the single
 * hardcoded bootstrap (see src/node/rendezvous.ts) - announcing on it makes this
 * node's presence visible to the wider public IPFS/libp2p swarm, not just other
 * Helix users, so it's a real user-facing privacy choice, not just an internal
 * flag. Defaults to enabled (unset reads as true) since that's today's behavior.
 *
 * Only read once, at connect() time - the underlying libp2p node's service set is
 * fixed at construction, so changing this mid-session doesn't hot-swap a running
 * node. The Settings toggle that calls setPublicDiscoveryEnabled() reloads the
 * page to apply it.
 */
export function isPublicDiscoveryEnabled(): boolean {
  return localStorage.getItem(PUBLIC_DISCOVERY_KEY) !== "false";
}

export function setPublicDiscoveryEnabled(enabled: boolean): void {
  localStorage.setItem(PUBLIC_DISCOVERY_KEY, String(enabled));
}
