import { sha256 } from './hash.js';
import type { Attachment } from '../types/index.js';

/**
 * The single source of truth for what a post's `contentHashBase4` covers. When an
 * attachment is present, its hash is folded in too - otherwise someone could swap
 * `attachment.hashHex`/`sourceUrl` after the fact without invalidating the post's
 * existing GF(4) checksum or Merkle/MMR proof. Used identically by the sender
 * (src/api/createPost.ts), every receiver (src/node/messages.ts's decodePost), and
 * proof verification (src/api/query.ts's verifyPost) - they must never drift apart.
 */
export function computePostContentHash(content: string, attachment?: Attachment): Uint8Array {
  const text = attachment ? `${content}\n${attachment.hashHex}` : content;
  return sha256(new TextEncoder().encode(text));
}
