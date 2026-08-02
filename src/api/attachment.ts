import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';
import type { Helia } from 'helia';
import { sha256 } from '../crypto/hash.js';
import { toHex } from '../crypto/hex.js';
import type { Attachment } from '../types/index.js';

export class AttachmentVerificationError extends Error {}

/** Convenience for building a self-contained (no external host needed) attachment source. */
export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * The single verification check shared by every attachment transport - size then hash,
 * against the attachment's own claimed values. Whichever transport fetched the bytes
 * (generic HTTP, real IPFS), this is what actually earns "recompute, don't trust."
 */
function verifyAttachmentBytes(bytes: Uint8Array, attachment: Attachment): void {
  if (bytes.length !== attachment.sizeBytes) {
    throw new AttachmentVerificationError(
      `attachment verification: size mismatch (expected ${attachment.sizeBytes}, got ${bytes.length})`,
    );
  }

  const hashHex = toHex(sha256(bytes));
  if (hashHex !== attachment.hashHex) {
    throw new AttachmentVerificationError(
      `attachment verification: hash mismatch (expected ${attachment.hashHex}, got ${hashHex}) - tampered or wrong source`,
    );
  }
}

/**
 * Fetches an attachment's bytes from `sourceUrl` and verifies them against `hashHex`/
 * `sizeBytes` before returning - the reader-side half of the "recompute, don't trust"
 * pattern used everywhere else in this codebase. `sourceUrl` is never trusted merely
 * for existing; only bytes that hash-match are ever returned.
 *
 * Deliberately not called during createPost - see the project plan for why attachment
 * content isn't fetched/moderation-checked synchronously at post-creation time.
 */
export async function fetchAndVerifyAttachment(attachment: Attachment): Promise<Uint8Array> {
  const response = await fetch(attachment.sourceUrl);
  if (!response.ok) {
    throw new AttachmentVerificationError(`fetchAndVerifyAttachment: fetch failed with status ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyAttachmentBytes(bytes, attachment);
  return bytes;
}

/**
 * Pushes attachment bytes to a local Helia (real IPFS) node, returning the resulting
 * CID as a string. Opt-in, separate from createPost - see the project plan for why
 * IPFS publishing isn't automatic.
 */
export async function publishAttachmentToIpfs(helia: Helia, bytes: Uint8Array): Promise<string> {
  const cid = await unixfs(helia).addBytes(bytes);
  return cid.toString();
}

/**
 * Fetches an attachment's bytes over real IPFS (via bitswap, from whichever peer has
 * them) and verifies them the same way fetchAndVerifyAttachment does - a second,
 * additive transport, not a replacement for the URL-based path.
 */
export async function fetchAndVerifyAttachmentFromIpfs(helia: Helia, attachment: Attachment): Promise<Uint8Array> {
  if (!attachment.ipfsCid) {
    throw new AttachmentVerificationError('fetchAndVerifyAttachmentFromIpfs: attachment has no ipfsCid');
  }

  const cid = CID.parse(attachment.ipfsCid);
  const chunks: Uint8Array[] = [];
  for await (const chunk of unixfs(helia).cat(cid)) {
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(Buffer.concat(chunks));

  verifyAttachmentBytes(bytes, attachment);
  return bytes;
}
