import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { generateHelixIdentity } from '../../src/crypto/keys.js';
import { createHelixNode, type HelixNode } from '../../src/node/createNode.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { HybridLogicalClock } from '../../src/clock/hlc.js';
import { createPost } from '../../src/api/createPost.js';
import { resolveCurrentVersion } from '../../src/api/query.js';

describe('createPost recombination ("edit post")', () => {
  let node: HelixNode;
  let store: MemoryStore;
  let hlc: HybridLogicalClock;
  const authorGenome = 'ACGT';
  const otherGenome = 'TGCA';

  beforeEach(async () => {
    const identity = await generateHelixIdentity();
    node = await createHelixNode({ port: 0, privateKey: identity.privateKey, browser: true });
    store = new MemoryStore();
    hlc = new HybridLogicalClock(node.peerId.toString());
  });

  afterEach(async () => {
    await node.stop();
  });

  it('recombination changes the visible content while the original is untouched', async () => {
    const original = await createPost(node, store, hlc, { authorGenome, content: 'the original post content' });
    const edited = await createPost(node, store, hlc, {
      authorGenome,
      content: 'the edited post content',
      recombinesPostId: original.postId,
    });

    expect(edited.content).toBe('the edited post content');
    expect(edited.recombinesPostId).toBe(original.postId);

    const stillOriginal = store.getPost(original.postId);
    expect(stillOriginal?.content).toBe('the original post content');
  });

  it('getCurrentVersion / resolveCurrentVersion resolve to the new post', async () => {
    const original = await createPost(node, store, hlc, { authorGenome, content: 'version one content here' });
    const edited = await createPost(node, store, hlc, {
      authorGenome,
      content: 'version two content here',
      recombinesPostId: original.postId,
    });

    expect(store.getCurrentVersion(original.postId)?.postId).toBe(edited.postId);
    expect(resolveCurrentVersion(store, original.postId)?.postId).toBe(edited.postId);
    expect(store.isSuperseded(original.postId)).toBe(true);
    expect(store.isSuperseded(edited.postId)).toBe(false);
  });

  it('rejects recombining a post authored by a different genome', async () => {
    const original = await createPost(node, store, hlc, { authorGenome: otherGenome, content: 'someone elses post' });

    await expect(
      createPost(node, store, hlc, {
        authorGenome,
        content: 'trying to hijack this post',
        recombinesPostId: original.postId,
      }),
    ).rejects.toThrow(/different genome/);
  });

  it('rejects recombining a post that has already been recombined', async () => {
    const original = await createPost(node, store, hlc, { authorGenome, content: 'first version of the post' });
    await createPost(node, store, hlc, {
      authorGenome,
      content: 'second version of the post',
      recombinesPostId: original.postId,
    });

    await expect(
      createPost(node, store, hlc, {
        authorGenome,
        content: 'third version attempt here',
        recombinesPostId: original.postId,
      }),
    ).rejects.toThrow(/already been recombined/);
  });

  it('rejects passing both recombinesPostId and parentPostId', async () => {
    const original = await createPost(node, store, hlc, { authorGenome, content: 'a post to recombine later' });

    await expect(
      createPost(node, store, hlc, {
        authorGenome,
        content: 'conflicting options here',
        recombinesPostId: original.postId,
        parentPostId: original.postId,
      }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it('a recombined reply inherits parentPostId and writhe from the target, not a new depth', async () => {
    const root = await createPost(node, store, hlc, { authorGenome: otherGenome, content: 'a root level post' });
    const reply = await createPost(node, store, hlc, {
      authorGenome,
      content: 'first reply to the root post',
      parentPostId: root.postId,
    });
    expect(reply.writhe).toBe(1);

    const editedReply = await createPost(node, store, hlc, {
      authorGenome,
      content: 'edited reply to the root post',
      recombinesPostId: reply.postId,
    });

    expect(editedReply.parentPostId).toBe(root.postId);
    expect(editedReply.writhe).toBe(1);
  });
});
