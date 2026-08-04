import { to_base4 } from '../math/base4.js';
import { computePostContentHash } from '../crypto/postHash.js';
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

/**
 * Older broadcasts (before the `action` field) carry no action - treat them as
 * 'follow' so pre-existing messages and stores stay compatible.
 */
export function decodeFollow(data: Uint8Array): Follow {
  const wire = JSON.parse(new TextDecoder().decode(data)) as Partial<Follow> & Pick<Follow, 'followerGenome' | 'followeeGenome' | 'hlcTimestamp'>;
  return { ...wire, action: wire.action ?? 'follow' } as Follow;
}

export interface IpfsAddrMessage {
  peerId: string;
  multiaddrs: string[];
}

export function encodeIpfsAddr(msg: IpfsAddrMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

export function decodeIpfsAddr(data: Uint8Array): IpfsAddrMessage {
  return JSON.parse(new TextDecoder().decode(data)) as IpfsAddrMessage;
}

/** Wire form of a post omits `contentHashBase4` - it's fully determined by `content`
 * and `attachment` via computePostContentHash (src/crypto/postHash.ts), so every
 * receiver recomputes it locally instead of trusting a transmitted copy. This also
 * saves 128 bytes/post on the wire, since to_base4 quadruples a 32-byte SHA-256
 * digest into 128 ASCII chars. Attachment *metadata* (hash/MIME/size/URL) still
 * travels on the wire as-is - only the attachment's actual bytes never do. */
type WirePost = Omit<Helix, 'contentHashBase4'>;

export function encodePost(post: Helix): Uint8Array {
  const { contentHashBase4: _contentHashBase4, ...wire } = post;
  return new TextEncoder().encode(JSON.stringify(wire));
}

export function decodePost(data: Uint8Array): Helix {
  const wire = JSON.parse(new TextDecoder().decode(data)) as WirePost;
  const contentHashBase4 = to_base4(computePostContentHash(wire.content, wire.attachment));
  return { ...wire, contentHashBase4 };
}
