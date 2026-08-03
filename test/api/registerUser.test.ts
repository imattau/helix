import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { BinaryStoreAdapter } from '@0xx0lostcause0xx0/polypack/persistence/node';
import { generateHelixIdentity, derive_subkey } from '../../src/crypto/keys.js';
import { createHelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { registerUser } from '../../src/api/registerUser.js';
import { to_base4 } from '../../src/math/base4.js';
import { toHex } from '../../src/crypto/hex.js';
import type { Genome } from '../../src/types/index.js';

describe('registerUser restart semantics', () => {
  it('reuses the same genome (and open TAD) when re-registering after a restart, instead of forking a new identity', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'helix-register-restart-'));
    const identity = await generateHelixIdentity();
    try {
      // First "session": register against a persisted store.
      const storeA = new MemoryStore({ storeAdapter: new BinaryStoreAdapter({ storeDir: dir }) });
      await storeA.loadPersistentGraphs();
      const nodeA = await createHelixNode({ port: 0, privateKey: identity.privateKey });
      const { genome: firstGenome, genesisTad: firstTad } = await registerUser(nodeA, storeA, 'alice');
      await storeA.flushPersistentGraphs();
      await storeA.disposePersistentGraphs();
      await nodeA.stop();

      // Second "session": the same identity and the persisted store are loaded again.
      const storeB = new MemoryStore({ storeAdapter: new BinaryStoreAdapter({ storeDir: dir }) });
      await storeB.loadPersistentGraphs();
      const nodeB = await createHelixNode({ port: 0, privateKey: identity.privateKey });
      const { genome: restartedGenome, genesisTad: restartedTad } = await registerUser(nodeB, storeB, 'alice');

      // A restart must NOT fork the identity into a `:1` genome.
      expect(restartedGenome.genome).toBe(firstGenome.genome);
      expect(restartedGenome.publicKeyHex).toBe(firstGenome.publicKeyHex);
      // The still-open TAD from the first session is resumed, not recreated.
      expect(restartedTad.tadId).toBe(firstTad.tadId);

      await storeB.disposePersistentGraphs();
      await nodeB.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('still bumps past a genome genuinely owned by a different public key (real collision)', async () => {
    const store = new MemoryStore();
    const identity = await generateHelixIdentity();
    const node = await createHelixNode({ port: 0, privateKey: identity.privateKey });
    try {
      // The address this node would derive for 'alice'.
      const publicKeyBytes = node.peerId.publicKey?.raw!;
      const derivedGenome = to_base4(derive_subkey(publicKeyBytes, 'genome:alice'));

      // A DIFFERENT identity claims that exact address first - a real collision,
      // not our own persisted registration.
      const otherIdentity = await generateHelixIdentity();
      const collidingRecord: Genome = {
        genome: derivedGenome,
        displayName: 'alice',
        publicKeyHex: toHex(otherIdentity.publicKeyBytes),
        peerId: 'someone-else',
        powNonce: 1,
      };
      store.saveGenome(collidingRecord);
      expect(store.hasGenome(derivedGenome)).toBe(true);

      const { genome } = await registerUser(node, store, 'alice');
      // Must not reuse the other peer's genome, and must not crash - it bumps to a
      // `:1` address that is still provably ours.
      expect(genome.genome).not.toBe(derivedGenome);
      expect(genome.publicKeyHex).toBe(toHex(publicKeyBytes));
      expect(store.hasGenome(genome.genome)).toBe(true);
    } finally {
      await node.stop();
    }
  });
});
