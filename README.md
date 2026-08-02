# Helix

A prototype of "Helix," a decentralized social protocol whose data model is expressed as
DNA/genetics math, built on [libp2p](https://libp2p.io). Genome registration and post
creation run end-to-end over a real libp2p network — gossipsub for broadcast, no central
server — hardened by a protocol-evaluation pass that fixed four structural flaws found
in the original design.

## What's implemented

- **Math engine** (`src/math/`): `to_base4`/`from_base4`, `hamming_distance`,
  `calculate_entropy` (Shannon entropy), `calculate_linking_number` (Twist + Writhe).
- **GF(4) polynomial checksum** (`src/math/gf4.ts`): real Galois Field GF(2²) arithmetic
  replacing the original naive A↔T/C↔G swap with a CRC-style polynomial-remainder
  checksum. **Not a cryptographic hash** — see the module's doc comment for why. SHA-256
  is the only mechanism used for content addressing, Merkle roots, and identity.
- **libp2p node** (`src/node/`): TCP + yamux + noise + gossipsub + mDNS discovery.
- **`registerUser` / `createPost`** (`src/api/`): the two pseudocode endpoints
  implemented against real crypto, an in-memory store, and gossipsub broadcast.
- **Fractal Merkle Mountain Range** (`src/store/mmr.ts`): a per-genome MMR over closed
  TADs' Merkle roots — the moment a TAD closes at 10 posts, its root folds into a peak.
  `getSyncState()` returns an O(log N)-sized payload (peaks only) regardless of history
  size; `getMerkleProof`/`verifyPost` (`src/api/query.ts`) give a two-level proof (post
  is in its TAD, that TAD's root is under a peak) without needing the full history.
- **SimHash moderation engine** (`src/math/simhash.ts`, `src/moderation/spacerRegistry.ts`):
  replaces the original CRISPR design's exact SHA-256 matching — which structurally
  cannot catch paraphrased misinformation, since a cryptographic hash changes completely
  for a single changed character — with a real locality-sensitive fingerprint. A plain
  linear scan compares fingerprints, not a Bloom filter (see the module doc comment for
  why a Bloom filter can't answer this "fuzzy" query). Detection engine only; feed
  tagging/DAO voting stay deferred, as before.
- **Proof-of-work registration** (`src/crypto/pow.ts`): registering a genome now costs a
  Hashcash-style nonce search, enforced by every *receiver* re-verifying it (not just
  trusting the sender) before accepting a genesis broadcast. Replaces "no Sybil
  resistance at all" without needing a real blockchain.
- **Hybrid Logical Clock** (`src/clock/hlc.ts`): replaces the old single-producer VDF
  clock for post timestamps. Every peer runs its own instance — no producer role, no
  central point of control over "decentralized" time. Posts also carry `causalParents`
  (the author's own previous post, plus a reply's parent) as an auditable trail.
- **Social graph** (`src/social/followGraph.ts`, `src/api/follow.ts`): follow/follower
  relationships and a "followers of followers" 2nd-degree query, built on
  [`@0xx0lostcause0xx0/polypack`](https://github.com/imattau/polypack)'s property graph
  engine — the one place this project uses a library instead of hand-rolling the
  primitive, since typed nodes/edges and multi-hop traversal are a direct fit here
  (unlike the earlier non-fits identified for polypack's vector search / sync layer).
  Follow edges broadcast over a new `helix-follows` gossipsub topic; every receiver
  verifies both referenced genomes are known before mirroring the edge, same as every
  other "recompute, don't trust" check in this codebase.
- **Media & long-form attachments** (`src/crypto/postHash.ts`, `src/api/attachment.ts`):
  posts can reference an `Attachment` (SHA-256 hash + MIME type + size + source URL)
  instead of cramming long-form content into the tweet-length `content` field. The
  actual bytes never travel over gossipsub — only the reference does — so a reader
  fetches and verifies them independently via `fetchAndVerifyAttachment` before
  trusting them. The attachment's hash is folded into `contentHashBase4`
  (`computePostContentHash`), so it's covered by the same GF(4) checksum and two-level
  Merkle/MMR proof as everything else, not a side-channel outside the integrity chain.
  Known limitation: the entropy/SimHash spam and moderation checks still only look at
  the short `content` field, not attachment bytes (checking those would mean every post
  blocks on a synchronous external fetch) — flagged, not silently skipped.
- **Real IPFS transport for attachments** (`src/ipfs/node.ts`, additions to
  `src/api/attachment.ts`): a second, additive way to host/retrieve attachment bytes —
  `publishAttachmentToIpfs`/`fetchAndVerifyAttachmentFromIpfs`, backed by a real
  [Helia](https://github.com/ipfs/helia) node with real bitswap peer-to-peer transfer.
  Does not replace the URL-based transport; both are demonstrated side by side. Runs as
  a **fully independent** libp2p node per peer — Helia requires `@libp2p/interface` v3,
  which can't share a node with the gossipsub-based Helix node (pinned to v2, the same
  class of conflict that ruled out `@libp2p/kad-dht` earlier). The two subsystems only
  ever exchange CIDs and raw bytes, never libp2p objects. `Attachment.ipfsCid` is
  purely additive and opt-in — `createPost` stays IPFS-unaware, just like it already
  never validates `sourceUrl`.

Endpoints #3 (CRISPR feed filtering), #4 (CRISPR DAO voting), and #5 (recombination)
from the original spec are not implemented. ALS-based feed ranking and real
Proof-of-Stake were evaluated and deliberately not built — see the plan history for why
(no real interaction corpus to train on; a real chain is a different kind of project).

See the plan history for the full list of deviations from the original proposals
(dropped `@libp2p/kad-dht`; MMR indexes closed TADs, not individual posts; dropped the
Bloom filter and the redundant hash-tiebreak-on-top-of-HLC; PoW uses a nonce search, not
the sequential VDF; `src/vdf/` was retired once HLC replaced its role).

## Running the demo

```bash
npm install
npm run peer:a   # terminal 1 - prints its multiaddr, registers a genome, creates posts
npm run peer:b -- --bootstrap <alice-multiaddr-from-terminal-1>   # terminal 2
```

Both peers register a genome (real proof-of-work search). Alice publishes a forged
low-effort genesis (which Bob's receiver rejects), then creates 11 posts — one of which
paraphrases a pre-known piece of misinformation. Bob's terminal logs each received
genome/post, **independently recomputes** the entropy and GF(4) checksum, flags the
paraphrase via SimHash (something an exact-hash check would miss), and independently
mirrors his own MMR from the gossiped posts — his printed sync state matches Alice's
exactly, without ever trusting her claims. One post carries a long-form markdown
attachment, published both as a self-contained `data:` URL and to Alice's own IPFS
node; Bob independently fetches and verifies it via **both** transports — generic URL
fetch and real IPFS bitswap from Alice's separate Helia node — having never received
the bytes over gossipsub either way. Bob also follows Alice once her genesis arrives;
both peers print their mirrored follow-graph state at the end.

## Tests

```bash
npm test        # unit tests across math/GF(4)/SimHash/PoW/HLC/MMR/social graph/attachments/IPFS + in-process 2-node, 3-node, and 4-node integration tests
npm run typecheck
```
