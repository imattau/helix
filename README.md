# Helix

A prototype of "Helix," a decentralized social protocol whose data model is expressed as
DNA/genetics math, built on [libp2p](https://libp2p.io). This pass implements genome
registration and post creation end-to-end over a real libp2p network — gossipsub for
broadcast, a from-scratch GF(4) polynomial checksum, and a toy VDF-based decentralized
clock — with no central server.

## What's implemented

- **Math engine** (`src/math/`): `to_base4`/`from_base4`, `hamming_distance`,
  `calculate_entropy` (Shannon entropy), `calculate_linking_number` (Twist + Writhe).
- **GF(4) polynomial checksum** (`src/math/gf4.ts`): real Galois Field GF(2²) arithmetic
  replacing the original naive A↔T/C↔G swap with a CRC-style polynomial-remainder
  checksum. **Not a cryptographic hash** — see the module's doc comment for why. SHA-256
  is the only mechanism used for content addressing, Merkle roots, and identity.
- **VDF clock** (`src/vdf/`): a toy iterated-SHA256 sequential clock, gossiped over the
  `helix-vdf-tick` pubsub topic, answering `network_clock.now()` from the original
  pseudocode without any central timestamp server. Explicitly prototype-grade — see the
  module's doc comment for the gap vs. a production Wesolowski/Pietrzak VDF.
- **libp2p node** (`src/node/`): TCP + yamux + noise + gossipsub + mDNS discovery.
- **`registerUser` / `createPost`** (`src/api/`): the two pseudocode endpoints
  implemented against real crypto, an in-memory store, and gossipsub broadcast.
- **Fractal Merkle Mountain Range** (`src/store/mmr.ts`): a per-genome MMR over closed
  TADs' Merkle roots — the moment a TAD closes at 10 posts, its root folds into a peak.
  `getSyncState()` returns an O(log N)-sized payload (peaks only) regardless of history
  size; `getMerkleProof`/`verifyPost` (`src/api/query.ts`) give a two-level proof (post
  is in its TAD, that TAD's root is under a peak) without needing the full history.
  Not implemented: the "XOR zipper" tail-fold from the original proposal — it doesn't
  actually reduce storage (you need both the folded value and the head to reconstruct
  anything), so it was left out. See the module doc comments and the plan history for
  the correctness fix made to the original pseudocode's peak-lookup order.

Endpoints #3 (CRISPR feed filtering), #4 (CRISPR moderation/DAO), and #5 (recombination)
from the original spec are not implemented in this pass.

See `plan.md`-equivalent history for the deviations made during implementation (dropped
`@libp2p/kad-dht` due to an unresolvable dependency conflict with gossipsub; the VDF
clock bootstraps to the first verified tick instead of requiring strict genesis-anchored
chaining, to survive gossipsub's mesh warm-up message drops; the MMR indexes closed TADs
rather than individual posts, and fixes a peak-lookup bug in the original pseudocode).

## Running the demo

```bash
npm install
npm run peer:a   # terminal 1 - prints its multiaddr, registers a genome, creates a post
npm run peer:b -- --bootstrap <alice-multiaddr-from-terminal-1>   # terminal 2
```

Alice registers a genome and creates 11 posts (closing her first TAD). Bob's terminal
logs each received genome/post, **independently recomputes** the entropy and GF(4)
checksum, and independently mirrors his own MMR from the gossiped posts — his printed
sync state matches Alice's exactly, without ever trusting her claims.

## Tests

```bash
npm test        # unit tests for the math/GF(4)/VDF modules + an in-process 2-node integration test
npm run typecheck
```
