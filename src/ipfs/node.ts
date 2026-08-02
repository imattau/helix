import { createHelia, type Helia } from 'helia';
import { MemoryBlockstore } from 'blockstore-core';
import { MemoryDatastore } from 'datastore-core';
import type { HeliaWithLibp2p } from '@helia/libp2p';

/** createHelia()'s declared return type doesn't reflect that it's always libp2p-backed internally - see @helia/libp2p's HeliaWithLibp2p. */
export type IpfsNode = Helia & HeliaWithLibp2p;

/**
 * A Helia (real IPFS) node, fully independent from the Helix gossipsub node in
 * src/node/createNode.ts. Helia requires @libp2p/interface v3; our Helix node is
 * pinned to v2 for gossipsub compatibility - the two can't share a libp2p instance
 * (see the project plan for the full explanation), so this is its own node with its
 * own identity. Only CIDs and raw bytes ever cross between the two subsystems, never
 * libp2p objects, so the version difference never needs reconciling.
 *
 * Storage is in-memory (MemoryBlockstore/MemoryDatastore), matching this project's
 * existing no-persistence philosophy - nothing survives process restart.
 */
export async function createIpfsNode(): Promise<IpfsNode> {
  const helia = (await createHelia({
    blockstore: new MemoryBlockstore(),
    datastore: new MemoryDatastore(),
  })) as IpfsNode;
  await helia.start(); // createHelia() does not start the node itself - .libp2p is unusable until this runs
  return helia;
}
