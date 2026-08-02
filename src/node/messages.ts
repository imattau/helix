import { to_base4 } from '../math/base4.js';
import { sha256 } from '../crypto/hash.js';
import type { Follow, Genome, Helix } from '../types/index.js';

export interface GenesisMessage {
  genome: Genome;
  tadId: string;
}

export function encodeGenesis(msg: GenesisMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

export function decodeGenesis(data: Uint8Array): GenesisMessage {
  return JSON.parse(new TextDecoder().decode(data)) as GenesisMessage;
}

export function encodeFollow(follow: Follow): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(follow));
}

export function decodeFollow(data: Uint8Array): Follow {
  return JSON.parse(new TextDecoder().decode(data)) as Follow;
}

/** Wire form of a post omits `contentHashBase4` - it's fully determined by `content`
 * (contentHashBase4 = to_base4(sha256(content))), so every receiver recomputes it
 * locally instead of trusting a transmitted copy. This also saves 128 bytes/post on
 * the wire, since to_base4 quadruples a 32-byte SHA-256 digest into 128 ASCII chars. */
type WirePost = Omit<Helix, 'contentHashBase4'>;

export function encodePost(post: Helix): Uint8Array {
  const { contentHashBase4: _contentHashBase4, ...wire } = post;
  return new TextEncoder().encode(JSON.stringify(wire));
}

export function decodePost(data: Uint8Array): Helix {
  const wire = JSON.parse(new TextDecoder().decode(data)) as WirePost;
  const contentHashBase4 = to_base4(sha256(new TextEncoder().encode(wire.content)));
  return { ...wire, contentHashBase4 };
}
