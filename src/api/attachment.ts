import { sha256 } from '../crypto/hash.js';
import { toHex } from '../crypto/hex.js';
import type { Attachment } from '../types/index.js';

export class AttachmentVerificationError extends Error {}

/** Convenience for building a self-contained (no external host needed) attachment source. */
export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
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
  if (bytes.length !== attachment.sizeBytes) {
    throw new AttachmentVerificationError(
      `fetchAndVerifyAttachment: size mismatch (expected ${attachment.sizeBytes}, got ${bytes.length})`,
    );
  }

  const hashHex = toHex(sha256(bytes));
  if (hashHex !== attachment.hashHex) {
    throw new AttachmentVerificationError(
      `fetchAndVerifyAttachment: hash mismatch (expected ${attachment.hashHex}, got ${hashHex}) - tampered or wrong URL`,
    );
  }

  return bytes;
}
