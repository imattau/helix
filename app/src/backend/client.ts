import { multiaddr } from "@multiformats/multiaddr";
import { createHelixNode, type HelixNode } from "@helix/node/createNode.js";
import { connectPublicDiscovery } from "@helix/node/rendezvous.js";
import { MemoryStore } from "@helix/store/memoryStore.js";
import { HybridLogicalClock } from "@helix/clock/hlc.js";
import { registerUser, genomeProofInput } from "@helix/api/registerUser.js";
import { createPost as createPostApi, SpamRejectedError } from "@helix/api/createPost.js";
import { followUser } from "@helix/api/follow.js";
import { TOPICS } from "@helix/node/pubsubTopics.js";
import { decodeGenesis, decodePost, decodeFollow } from "@helix/node/messages.js";
import { verifyProofOfWork, REGISTRATION_DIFFICULTY_BITS } from "@helix/crypto/pow.js";
import { fromHex } from "@helix/crypto/hex.js";
import type { Genome, Helix, HelixKind, Follow } from "@helix/types/index.js";
import { loadOrCreateIdentity, isPublicDiscoveryEnabled } from "./identity";
import { SearchIndex } from "./searchIndex";
import type { Notification, Post, User } from "../types";

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
 * Application-layer conventions for what goes inside a 'profile'/'like'/'boost'
 * post's otherwise-opaque `content` string - not a protocol change (see
 * src/types/index.ts's HelixKind doc comment). Other peers that don't know this
 * convention just see an opaque string, same as they don't render anything today.
 */
interface ProfileContent {
  displayName: string;
}

function encodeProfile(p: ProfileContent): string {
  return JSON.stringify(p);
}

function decodeProfile(content: string): ProfileContent | undefined {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed?.displayName === "string" ? { displayName: parsed.displayName } : undefined;
  } catch {
    return undefined;
  }
}

/** A like/boost is "on" or "off" via its current (possibly recombined) content -
 *  unliking is just recombining the same like post to `{ active: false }`, reusing
 *  the exact mechanism edits already use rather than a separate remove/undo path. */
interface ReactionContent {
  active: boolean;
}

function encodeReaction(r: ReactionContent): string {
  return JSON.stringify(r);
}

function decodeReaction(content: string): ReactionContent {
  try {
    const parsed = JSON.parse(content);
    return { active: parsed?.active !== false };
  } catch {
    return { active: true };
  }
}

/**
 * Wraps a real in-browser Helix libp2p peer: identity, registration, live
 * gossipsub feed, posting, and follows. Runs entirely inside the webview -
 * see the project plan for why (PWA/mobile support, not just desktop).
 */
export class HelixClient {
  private node!: HelixNode;
  private readonly store = new MemoryStore();
  private readonly searchIndex = new SearchIndex();
  private hlc!: HybridLogicalClock;
  private selfGenome?: Genome;
  private posts: Helix[] = [];
  /** Every follow event this peer has observed, self-initiated or gossiped in - see
   *  getNotifications(). Structural following/followers state itself still lives in
   *  MemoryStore's FollowGraph; this is purely the timestamped event log for notifications. */
  private followEvents: Follow[] = [];
  private readonly listeners = new Set<() => void>();
  private connectPromise?: Promise<void>;
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

  /** Identity/node/dial - doesn't need a display name. Idempotent. */
  connect(): Promise<void> {
    if (!this.connectPromise) this.connectPromise = this.doConnect();
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    const identity = await loadOrCreateIdentity();
    const publicDiscovery = isPublicDiscoveryEnabled();
    this.node = await createHelixNode({ port: 0, privateKey: identity.privateKey, browser: true, publicDiscovery });
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

    // Best-effort: find other Helix peers via the public IPFS/libp2p DHT (client-mode
    // only - see createNode.ts), beyond the single hardcoded bootstrap above. A browser
    // tab can't accept inbound connections at all, so this can only ever dial *into*
    // publicly-reachable Helix nodes (e.g. another peer:a/peer:b-style deployment) -
    // same one-directional constraint the hardcoded bootstrap already has. Doesn't
    // block startup on it - fires and forgets, since the public DHT can be slow.
    // User-controlled - see identity.ts's isPublicDiscoveryEnabled()/SettingsScreen.
    if (publicDiscovery) {
      connectPublicDiscovery(this.node).catch((err) => {
        console.warn(`[helix] DHT rendezvous discovery failed - continuing without it`, err);
      });
    }
  }

  /** Registers under `displayName` once connect() has finished, then creates the
   *  one-time "profile record" post - see editProfile() for how it's later edited. */
  async register(displayName: string): Promise<void> {
    if (this.selfGenome) return;
    await this.connect();
    const { genome } = await registerUser(this.node, this.store, displayName);
    this.selfGenome = genome;

    const profilePost = await createPostApi(this.node, this.store, this.hlc, {
      authorGenome: genome.genome,
      kind: "profile",
      content: encodeProfile({ displayName }),
    });
    this.posts.unshift(profilePost);
    this.indexForSearch(profilePost);
    this.notify();
  }

  private handleMessage(evt: { detail: { topic: string; data: Uint8Array } }): void {
    if (evt.detail.topic === TOPICS.GENESIS) {
      const msg = decodeGenesis(evt.detail.data);
      const proofInput = genomeProofInput(fromHex(msg.genome.publicKeyHex), msg.genome.genome);
      if (!verifyProofOfWork(proofInput, msg.genome.powNonce, REGISTRATION_DIFFICULTY_BITS)) return;
      this.store.saveGenome(msg.genome);
      // Immutable fallback name until (if ever) a 'profile' post overrides it - see getUser().
      void this.searchIndex.indexUser(msg.genome.genome, msg.genome.displayName);
      this.notify();
    } else if (evt.detail.topic === TOPICS.FOLLOWS) {
      const follow = decodeFollow(evt.detail.data);
      if (!this.store.hasGenome(follow.followerGenome) || !this.store.hasGenome(follow.followeeGenome)) return;
      this.hlc.update(follow.hlcTimestamp);
      this.store.getFollowGraph().addFollow(follow.followerGenome, follow.followeeGenome);
      this.followEvents.push(follow);
      this.notify();
    } else if (evt.detail.topic === TOPICS.POSTS) {
      const post = decodePost(evt.detail.data);
      this.hlc.update(post.hlcTimestamp);
      this.posts.unshift(post);
      this.indexForSearch(post);
      this.notify();
    }
  }

  /** True for a post's current (non-superseded) version - see the recombination handling. */
  private isCurrent(post: Helix): boolean {
    return !this.store.isSuperseded(post.postId);
  }

  /** Feeds every newly-seen post into the search index - ordinary posts by content,
   *  profile posts by their (app-layer, decoded) display name. Called alongside every
   *  `this.posts.unshift(post)`, whether self-authored or received over gossip - see
   *  src/backend/searchIndex.ts. Fire-and-forget: search results just lag briefly. */
  private indexForSearch(post: Helix): void {
    if (post.kind === "post") {
      void this.searchIndex.indexPost(post.postId, post.content);
    } else if (post.kind === "profile") {
      const profile = decodeProfile(post.content);
      if (profile) void this.searchIndex.indexUser(post.genome, profile.displayName);
    }
  }

  /** Top-level posts only - replies are surfaced via getRepliesTo() in the thread view.
   *  Only current versions are shown; an edited post's earlier versions stay reachable
   *  by id (for provenance) but don't clutter the feed. Likes/boosts/profile records
   *  are a different `kind` and never show up as ordinary posts. */
  getFeedPosts(): Post[] {
    return this.posts
      .filter((post) => post.kind === "post" && !post.parentPostId && this.isCurrent(post))
      .map((post) => this.toPost(post));
  }

  getRepliesTo(postId: string): Post[] {
    return this.posts
      .filter((post) => post.kind === "post" && post.parentPostId === postId && this.isCurrent(post))
      .map((post) => this.toPost(post));
  }

  /** Resolves a possibly-superseded id to its current version before looking it up. */
  getPost(postId: string): Post | undefined {
    const resolvedId = this.store.getCurrentVersion(postId)?.postId ?? postId;
    const post = this.posts.find((p) => p.postId === resolvedId);
    return post ? this.toPost(post) : undefined;
  }

  getPostsByAuthor(genome: string): Post[] {
    return this.posts
      .filter((post) => post.kind === "post" && post.genome === genome && this.isCurrent(post))
      .map((post) => this.toPost(post));
  }

  private getCurrentProfilePost(genome: string): Helix | undefined {
    return this.posts.find((p) => p.genome === genome && p.kind === "profile" && this.isCurrent(p));
  }

  getUser(genome: string): User | undefined {
    const record = this.store.getGenome(genome);
    if (!record) return undefined;
    const graph = this.store.getFollowGraph();
    // The profile post (if observed) is the current, editable name; Genesis's
    // displayName is the immutable fallback used before one has propagated yet.
    const profile = decodeProfile(this.getCurrentProfilePost(genome)?.content ?? "");
    return {
      id: record.genome,
      displayName: profile?.displayName ?? record.displayName,
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
    this.indexForSearch(post);
    this.notify();
    return this.toPost(post);
  }

  async follow(genome: string): Promise<void> {
    if (!this.selfGenome) throw new Error("HelixClient.follow: not registered yet");
    const follow = await followUser(this.node, this.store, this.hlc, this.selfGenome.genome, genome);
    this.followEvents.push(follow);
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
    this.indexForSearch(post);
    this.notify();
    return this.toPost(post);
  }

  /** Edits the caller's own profile post (created once at register()) via the same
   *  recombination path posts already use - the genome address itself never changes. */
  async editProfile(displayName: string): Promise<void> {
    if (!this.selfGenome) throw new Error("HelixClient.editProfile: not registered yet");
    const current = this.getCurrentProfilePost(this.selfGenome.genome);
    if (!current) throw new Error("HelixClient.editProfile: no profile post found");
    await this.recombine(current.postId, encodeProfile({ displayName }));
  }

  private findOwnReaction(kind: "like" | "boost", targetPostId: string): Helix | undefined {
    if (!this.selfGenome) return undefined;
    return this.posts.find(
      (p) => p.kind === kind && p.parentPostId === targetPostId && p.genome === this.selfGenome!.genome && this.isCurrent(p),
    );
  }

  /** Sets the caller's like/boost state on a post to `active`. If a reaction already
   *  exists (on or off), recombines it in place instead of creating a new one - one
   *  linear edit chain per (author, target) pair, same rule createPost already enforces
   *  for ordinary edits. A no-op if already in the requested state. */
  private async react(kind: "like" | "boost", targetPostId: string, active: boolean): Promise<void> {
    if (!this.selfGenome) throw new Error(`HelixClient.react: not registered yet`);
    const existing = this.findOwnReaction(kind, targetPostId);
    if (existing) {
      if (decodeReaction(existing.content).active === active) return;
      const post = await createPostApi(this.node, this.store, this.hlc, {
        authorGenome: this.selfGenome.genome,
        content: encodeReaction({ active }),
        recombinesPostId: existing.postId,
      });
      this.posts.unshift(post);
    } else {
      if (!active) return; // nothing to turn off if it was never on
      const post = await createPostApi(this.node, this.store, this.hlc, {
        authorGenome: this.selfGenome.genome,
        kind,
        content: encodeReaction({ active: true }),
        parentPostId: targetPostId,
      });
      this.posts.unshift(post);
    }
    this.notify();
  }

  like(postId: string): Promise<void> {
    return this.react("like", postId, true);
  }

  unlike(postId: string): Promise<void> {
    return this.react("like", postId, false);
  }

  boost(postId: string): Promise<void> {
    return this.react("boost", postId, true);
  }

  unboost(postId: string): Promise<void> {
    return this.react("boost", postId, false);
  }

  hasLiked(postId: string): boolean {
    const r = this.findOwnReaction("like", postId);
    return r !== undefined && decodeReaction(r.content).active;
  }

  hasBoosted(postId: string): boolean {
    const r = this.findOwnReaction("boost", postId);
    return r !== undefined && decodeReaction(r.content).active;
  }

  /** Likes/boosts/replies on your posts, plus new followers - newest first. Derived
   *  entirely from `this.posts`/`this.followEvents` rather than a separate persisted
   *  log, same as every other view in this client. Excludes your own reactions to your
   *  own posts and only counts each reaction/reply chain's current (non-superseded)
   *  version, so toggling a like off and back on doesn't produce two notifications. */
  getNotifications(): Notification[] {
    if (!this.selfGenome) return [];
    const selfGenome = this.selfGenome.genome;
    const myPostIds = new Set(this.posts.filter((p) => p.kind === "post" && p.genome === selfGenome).map((p) => p.postId));

    type Item = { kind: Notification["kind"]; actorGenome: string; hlcTimestamp: Helix["hlcTimestamp"]; targetPostId?: string };
    const items: Item[] = [];

    for (const p of this.posts) {
      if (p.genome === selfGenome || !this.isCurrent(p) || !p.parentPostId || !myPostIds.has(p.parentPostId)) continue;
      if (p.kind === "like" || p.kind === "boost") {
        if (decodeReaction(p.content).active) {
          items.push({ kind: p.kind, actorGenome: p.genome, hlcTimestamp: p.hlcTimestamp, targetPostId: p.parentPostId });
        }
      } else if (p.kind === "post") {
        items.push({ kind: "reply", actorGenome: p.genome, hlcTimestamp: p.hlcTimestamp, targetPostId: p.postId });
      }
    }

    for (const f of this.followEvents) {
      if (f.followeeGenome === selfGenome && f.followerGenome !== selfGenome) {
        items.push({ kind: "follow", actorGenome: f.followerGenome, hlcTimestamp: f.hlcTimestamp });
      }
    }

    items.sort((a, b) => HybridLogicalClock.compare(b.hlcTimestamp, a.hlcTimestamp));

    return items
      .map((item, index) => {
        const actor = this.getUser(item.actorGenome);
        if (!actor) return undefined;
        const target = item.targetPostId ? this.getPost(item.targetPostId) : undefined;
        const notification: Notification = {
          id: `${item.kind}:${item.actorGenome}:${item.targetPostId ?? index}`,
          kind: item.kind,
          actor,
          timeAgo: formatTimeAgo(item.hlcTimestamp.physical),
          targetPostId: item.targetPostId,
          targetExcerpt: target?.content,
        };
        return notification;
      })
      .filter((n): n is Notification => n !== undefined);
  }

  /** Full-text search over post content and display names - see src/backend/searchIndex.ts.
   *  Search hits are resolved back against `this.posts`/`getUser` and filtered to current
   *  (non-superseded) versions here, same as every other post-listing getter. */
  async search(query: string, limit = 20): Promise<{ posts: Post[]; users: User[] }> {
    const { postIds, genomes } = await this.searchIndex.search(query, limit);

    const posts = postIds
      .map((id) => this.posts.find((p) => p.postId === id))
      .filter((p): p is Helix => p !== undefined && p.kind === "post" && this.isCurrent(p))
      .map((p) => this.toPost(p));

    const users = genomes.map((g) => this.getUser(g)).filter((u): u is User => u !== undefined);

    return { posts, users };
  }

  /** Distinct authoring genomes with an active (not toggled-off) reaction - not raw
   *  post count, so an accidental double-click or a toggle-off/on cycle never
   *  double-counts (there's no protocol-level duplicate rejection). */
  private countActiveReactions(kind: HelixKind, targetPostId: string): number {
    const genomes = new Set<string>();
    for (const p of this.posts) {
      if (p.kind !== kind || p.parentPostId !== targetPostId || !this.isCurrent(p)) continue;
      if (decodeReaction(p.content).active) genomes.add(p.genome);
    }
    return genomes.size;
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
      replyCount: this.posts.filter((p) => p.kind === "post" && p.parentPostId === post.postId && this.isCurrent(p)).length,
      boostCount: this.countActiveReactions("boost", post.postId),
      likeCount: this.countActiveReactions("like", post.postId),
      wasEdited: post.recombinesPostId !== undefined,
    };
  }
}
