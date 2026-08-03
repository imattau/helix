import { multiaddr } from "@multiformats/multiaddr";
import { createHelixNode, type HelixNode } from "@helix/node/createNode.js";
import { MemoryStore } from "@helix/store/memoryStore.js";
import { HybridLogicalClock } from "@helix/clock/hlc.js";
import { registerUser, genomeProofInput } from "@helix/api/registerUser.js";
import { createPost as createPostApi, SpamRejectedError } from "@helix/api/createPost.js";
import { followUser } from "@helix/api/follow.js";
import { TOPICS } from "@helix/node/pubsubTopics.js";
import { decodeGenesis, decodePost, decodeFollow } from "@helix/node/messages.js";
import { verifyProofOfWork, REGISTRATION_DIFFICULTY_BITS } from "@helix/crypto/pow.js";
import { fromHex } from "@helix/crypto/hex.js";
import type { Genome, Helix } from "@helix/types/index.js";
import { loadOrCreateIdentity } from "./identity";
import type { Post, User } from "../types";

export { SpamRejectedError };

/** Local dev default: `npm run peer:a` at the repo root logs this exact /ws multiaddr. */
const DEFAULT_BOOTSTRAP = "/ip4/127.0.0.1/tcp/9002/ws";

const AVATAR_PALETTE = ["#5e50f9", "#6366f1", "#d946ef", "#f59e0b", "#22c55e", "#ec4899", "#0ea5e9"];

function avatarColorFor(genome: string): string {
  let hash = 0;
  for (let i = 0; i < genome.length; i++) hash = (hash * 31 + genome.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function shortGenome(genome: string): string {
  return genome.length > 12 ? `${genome.slice(0, 6)}…${genome.slice(-4)}` : genome;
}

function formatTimeAgo(physicalMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - physicalMs) / 1000));
  if (diffSec < 60) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

/**
 * Wraps a real in-browser Helix libp2p peer: identity, registration, live
 * gossipsub feed, posting, and follows. Runs entirely inside the webview -
 * see the project plan for why (PWA/mobile support, not just desktop).
 */
export class HelixClient {
  private node!: HelixNode;
  private readonly store = new MemoryStore();
  private hlc!: HybridLogicalClock;
  private selfGenome?: Genome;
  private posts: Helix[] = [];
  private readonly listeners = new Set<() => void>();
  private started = false;
  private version = 0;

  /** Bumped on every state change - lets useSyncExternalStore detect updates. */
  getVersion(): number {
    return this.version;
  }

  get isRegistered(): boolean {
    return this.selfGenome !== undefined;
  }

  get selfGenomeAddress(): string | undefined {
    return this.selfGenome?.genome;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  async start(displayName: string): Promise<void> {
    if (this.started) return;
    this.started = true;

    const identity = await loadOrCreateIdentity();
    this.node = await createHelixNode({ port: 0, privateKey: identity.privateKey, browser: true });
    this.hlc = new HybridLogicalClock(this.node.peerId.toString());

    this.node.services.pubsub.subscribe(TOPICS.GENESIS);
    this.node.services.pubsub.subscribe(TOPICS.POSTS);
    this.node.services.pubsub.subscribe(TOPICS.FOLLOWS);
    this.node.services.pubsub.addEventListener("message", (evt) => this.handleMessage(evt));

    const bootstrap = import.meta.env.VITE_BOOTSTRAP_MULTIADDR ?? DEFAULT_BOOTSTRAP;
    try {
      await this.node.dial(multiaddr(bootstrap), { signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      console.warn(`[helix] couldn't dial bootstrap peer ${bootstrap} - continuing standalone`, err);
    }

    const { genome } = await registerUser(this.node, this.store, displayName);
    this.selfGenome = genome;
    this.notify();
  }

  private handleMessage(evt: { detail: { topic: string; data: Uint8Array } }): void {
    if (evt.detail.topic === TOPICS.GENESIS) {
      const msg = decodeGenesis(evt.detail.data);
      const proofInput = genomeProofInput(fromHex(msg.genome.publicKeyHex), msg.genome.genome);
      if (!verifyProofOfWork(proofInput, msg.genome.powNonce, REGISTRATION_DIFFICULTY_BITS)) return;
      this.store.saveGenome(msg.genome);
      this.notify();
    } else if (evt.detail.topic === TOPICS.FOLLOWS) {
      const follow = decodeFollow(evt.detail.data);
      if (!this.store.hasGenome(follow.followerGenome) || !this.store.hasGenome(follow.followeeGenome)) return;
      this.store.getFollowGraph().addFollow(follow.followerGenome, follow.followeeGenome);
      this.notify();
    } else if (evt.detail.topic === TOPICS.POSTS) {
      const post = decodePost(evt.detail.data);
      this.hlc.update(post.hlcTimestamp);
      this.posts.unshift(post);
      this.notify();
    }
  }

  /** True for a post's current (non-superseded) version - see the recombination handling. */
  private isCurrent(post: Helix): boolean {
    return !this.store.isSuperseded(post.postId);
  }

  /** Top-level posts only - replies are surfaced via getRepliesTo() in the thread view.
   *  Only current versions are shown; an edited post's earlier versions stay reachable
   *  by id (for provenance) but don't clutter the feed. */
  getFeedPosts(): Post[] {
    return this.posts.filter((post) => !post.parentPostId && this.isCurrent(post)).map((post) => this.toPost(post));
  }

  getRepliesTo(postId: string): Post[] {
    return this.posts
      .filter((post) => post.parentPostId === postId && this.isCurrent(post))
      .map((post) => this.toPost(post));
  }

  /** Resolves a possibly-superseded id to its current version before looking it up. */
  getPost(postId: string): Post | undefined {
    const resolvedId = this.store.getCurrentVersion(postId)?.postId ?? postId;
    const post = this.posts.find((p) => p.postId === resolvedId);
    return post ? this.toPost(post) : undefined;
  }

  getPostsByAuthor(genome: string): Post[] {
    return this.posts.filter((post) => post.genome === genome && this.isCurrent(post)).map((post) => this.toPost(post));
  }

  getUser(genome: string): User | undefined {
    const record = this.store.getGenome(genome);
    if (!record) return undefined;
    const graph = this.store.getFollowGraph();
    return {
      id: record.genome,
      displayName: record.displayName,
      handle: `@${shortGenome(record.genome)}`,
      verified: false,
      avatarColor: avatarColorFor(record.genome),
      followingCount: graph.getFollowing(record.genome).length,
      followerCount: graph.getFollowers(record.genome).length,
    };
  }

  getSelfUser(): User | undefined {
    return this.selfGenome ? this.getUser(this.selfGenome.genome) : undefined;
  }

  isFollowing(genome: string): boolean {
    if (!this.selfGenome) return false;
    return this.store.getFollowGraph().getFollowing(this.selfGenome.genome).includes(genome);
  }

  async publish(content: string, parentPostId?: string): Promise<Post> {
    if (!this.selfGenome) throw new Error("HelixClient.publish: not registered yet");
    const post = await createPostApi(this.node, this.store, this.hlc, {
      authorGenome: this.selfGenome.genome,
      content,
      parentPostId,
    });
    this.posts.unshift(post);
    this.notify();
    return this.toPost(post);
  }

  async follow(genome: string): Promise<void> {
    if (!this.selfGenome) throw new Error("HelixClient.follow: not registered yet");
    await followUser(this.node, this.store, this.selfGenome.genome, genome);
    this.notify();
  }

  /** "Edit" a post: publishes a new version that supersedes it. The original stays in
   *  the append-only log, unchanged and still provable - see src/api/createPost.ts. */
  async recombine(targetPostId: string, content: string): Promise<Post> {
    if (!this.selfGenome) throw new Error("HelixClient.recombine: not registered yet");
    const post = await createPostApi(this.node, this.store, this.hlc, {
      authorGenome: this.selfGenome.genome,
      content,
      recombinesPostId: targetPostId,
    });
    this.posts.unshift(post);
    this.notify();
    return this.toPost(post);
  }

  private toPost(post: Helix): Post {
    const author = this.getUser(post.genome) ?? {
      id: post.genome,
      displayName: shortGenome(post.genome),
      handle: `@${shortGenome(post.genome)}`,
      verified: false,
      avatarColor: avatarColorFor(post.genome),
    };
    return {
      id: post.postId,
      author,
      content: post.content,
      timeAgo: formatTimeAgo(post.hlcTimestamp.physical),
      sealed: true,
      replyCount: this.posts.filter((p) => p.parentPostId === post.postId && this.isCurrent(p)).length,
      // No like/boost action exists in the protocol yet - real posts always start at 0
      // rather than a fabricated number, unlike the mock-data pass this replaces.
      boostCount: 0,
      likeCount: 0,
      wasEdited: post.recombinesPostId !== undefined,
    };
  }
}
