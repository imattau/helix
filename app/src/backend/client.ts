import { multiaddr } from "@multiformats/multiaddr";
import { multiaddr as multiaddrV13 } from "@multiformats/multiaddr-v13";
import { createHelixNode, type HelixNode } from "@helix/node/createNode.js";
import { createIpfsNode, type IpfsNode } from "@helix/ipfs/node.js";
import { connectPublicDiscovery, isHelixPeer } from "@helix/node/rendezvous.js";
import { MemoryStore } from "@helix/store/memoryStore.js";
import { HybridLogicalClock } from "@helix/clock/hlc.js";
import { registerUser, genomeProofInput } from "@helix/api/registerUser.js";
import { createPost as createPostApi, SpamRejectedError } from "@helix/api/createPost.js";
import { ingestPost, PostRejectedError } from "@helix/api/ingestPost.js";
import { followUser, unfollowUser } from "@helix/api/follow.js";
import {
  fetchAndVerifyAttachment,
  fetchAndVerifyAttachmentFromIpfs,
  publishAttachmentToIpfs,
  toDataUrl,
  AttachmentVerificationError,
  INLINE_MAX_BYTES,
} from "@helix/api/attachment.js";
import { CID } from "multiformats/cid";
import { TOPICS } from "@helix/node/pubsubTopics.js";
import {
  decodeGenesis,
  decodePost,
  decodeFollow,
  decodeIpfsAddr,
  encodeIpfsAddr,
} from "@helix/node/messages.js";
import {
  buildDirectorySnapshot,
  decodeDirectory,
  encodeDirectory,
  ingestDirectory,
  registerDirectoryHandler,
  requestDirectory,
  DIRECTORY_BROADCAST_INTERVAL_MS,
  DIRECTORY_BROADCAST_MAX_GENOMES,
  DIRECTORY_BROADCAST_POSTS_PER_GENOME,
} from "@helix/node/directory.js";
import { verifyProofOfWork, REGISTRATION_DIFFICULTY_BITS } from "@helix/crypto/pow.js";
import { fromHex } from "@helix/crypto/hex.js";
import type { Attachment, Genome, Helix, Follow } from "@helix/types/index.js";
import { loadOrCreateIdentity, isPublicDiscoveryEnabled } from "./identity";
import { createBrowserPolyPackAdapters } from "./polypackPersistence";
import { SearchIndex } from "./searchIndex";
import { isTauri } from "./platform";
import { createPersistentIpfsStorage, loadOrCreateIpfsPrivateKey, type FileIoBlockstore } from "./ipfsPersistence";
import {
  isWebrtcAvailable,
  webrtcTransport,
  registerIncomingWebrtcSignals,
  buildWebrtcMultiaddr,
} from "./webrtcTransport";
import type { Notification, Post, PostAttachment, User } from "../types";

/** Public STUN only, no TURN - enough for NAT traversal between two peers that aren't
 *  both behind symmetric/CGNAT-style NAT (the common residential/mobile case), but a
 *  peer on a stricter network simply won't connect via this path; it still falls back
 *  to relay for the main node and to the URL/single-source IPFS path for attachments,
 *  same as before this existed. Standing up a TURN relay (bandwidth cost, its own
 *  infrastructure) is a real option later but out of scope for this pass. */
const WEBRTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/** Candidate listen ports for TauriTcpTransport (see findAvailablePort there) - an
 *  arbitrary high, unassigned range; the first free one is used, so a second Helix
 *  instance on the same device (or anything else already bound to the first choice)
 *  doesn't prevent startup. */
const TAURI_TCP_CANDIDATE_PORTS = [4737, 4738, 4739, 4740, 4741, 4742, 4743, 4744, 4745, 4746];

/** Candidate listen ports for Helia's own real-TCP transport (heliaTcpTransport.ts) -
 *  a distinct range from TAURI_TCP_CANDIDATE_PORTS above since both the main node and
 *  Helia bind a listener in the same process and must not collide. */
const HELIA_TCP_CANDIDATE_PORTS = [4747, 4748, 4749, 4750, 4751, 4752, 4753, 4754, 4755, 4756];

export { SpamRejectedError };

/** How often to re-run DHT rendezvous discovery so peers that announce later are found. */
const REDISCOVERY_INTERVAL_MS = 3 * 60_000;

const AVATAR_PALETTE = ["#5e50f9", "#6366f1", "#d946ef", "#f59e0b", "#22c55e", "#ec4899", "#0ea5e9"];

function avatarColorFor(genome: string): string {
  let hash = 0;
  for (let i = 0; i < genome.length; i++) hash = (hash * 31 + genome.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function shortGenome(genome: string): string {
  return genome.length > 12 ? `${genome.slice(0, 6)}…${genome.slice(-4)}` : genome;
}

/** Promise.any() equivalent (app/'s tsconfig targets ES2020, which predates it) -
 *  resolves with the first fulfilled promise, rejects only once every candidate has. */
function raceFulfilled<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let remaining = promises.length;
    promises.forEach((p) =>
      p.then(resolve).catch(() => {
        remaining -= 1;
        if (remaining === 0) reject(new Error("every dial attempt failed"));
      }),
    );
  });
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
  private store = new MemoryStore();
  private searchIndex = new SearchIndex();
  private hlc!: HybridLogicalClock;
  private selfGenome?: Genome;
  /** Every follow event this peer has observed, self-initiated or gossiped in - see
   *  getNotifications(). Structural following/followers state itself still lives in
   *  MemoryStore's FollowGraph; this is purely the timestamped event log for notifications. */
  private followEvents: Follow[] = [];
  private readonly listeners = new Set<() => void>();
  private connectPromise?: Promise<void>;
  private version = 0;
  /** Lazily-created real Helia node for attachment bytes - see getIpfsNode(). */
  private ipfsNodePromise?: Promise<IpfsNode>;
  /** The raw FileIoBlockstore backing ipfsNodePromise, kept directly rather than
   *  fished back out of Helia's own `.blockstore` (a wrapping BlockStorage with
   *  pinning/GC semantics of its own, not the raw instance passed into createIpfsNode)
   *  - needed to call FileIoBlockstore's own pin() (see buildAttachment). */
  private ipfsBlockstorePromise?: Promise<FileIoBlockstore>;
  /** Same namespace used for the main store's PolyPack adapters (identity.peerId) -
   *  set once in doConnect(), read by getIpfsNode() so the IPFS node's own persisted
   *  key/blockstore/datastore are scoped to this identity too. */
  private identityNamespace?: string;
  /** IPFS peer IDs we've successfully dialed via the IPFS_ADDR gossipsub signal. */
  private dialedIpfsPeers = new Set<string>();
  /** Verified attachment bytes by hashHex, so the feed and thread views never refetch. */
  private attachmentCache = new Map<string, Uint8Array>();
  /** Peers we've already asked for their directory - one request per peer, ever. */
  private directoryRequestedPeers = new Set<string>();
  /** True once we've made connection with any peer - drives the "Finding peers…" state. */
  private peerContact = false;
  /** Captured at connect() time - the node's service set is fixed at construction. */
  private publicDiscoveryEnabled = false;

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
    this.identityNamespace = identity.peerId.toString();
    const adapters = await createBrowserPolyPackAdapters(this.identityNamespace);
    this.store = new MemoryStore({
      storeAdapter: adapters.storeAdapter,
      followGraphAdapter: adapters.followGraphAdapter,
      blockGraphAdapter: adapters.blockGraphAdapter,
      peakGraphAdapter: adapters.peakGraphAdapter,
    });
    this.searchIndex = new SearchIndex(adapters.searchIndexAdapter);
    await Promise.all([this.store.loadPersistentGraphs(), this.searchIndex.load()]);
    const publicDiscovery = isPublicDiscoveryEnabled();
    this.publicDiscoveryEnabled = publicDiscovery;
    const nativeTcpTransport = publicDiscovery ? await this.createNativeTcpTransport() : undefined;
    this.node = await createHelixNode({
      port: 0,
      privateKey: identity.privateKey,
      browser: true,
      publicDiscovery,
      nativeTcpTransport,
    });
    this.hlc = new HybridLogicalClock(this.node.peerId.toString());

    this.node.services.pubsub.subscribe(TOPICS.GENESIS);
    this.node.services.pubsub.subscribe(TOPICS.POSTS);
    this.node.services.pubsub.subscribe(TOPICS.FOLLOWS);
    this.node.services.pubsub.subscribe(TOPICS.IPFS_ADDR);
    this.node.services.pubsub.subscribe(TOPICS.DIRECTORY);
    this.node.services.pubsub.addEventListener("message", (evt) => this.handleMessage(evt));
    registerDirectoryHandler(this.node, this.store);
    if (isWebrtcAvailable()) registerIncomingWebrtcSignals(this.node, WEBRTC_ICE_SERVERS);

    // Ask every peer we connect to (bootstrap or DHT-discovered) for its directory
    // exactly once - a fresh user's Discover is populated by this, not by waiting for
    // whatever happens to be broadcast while they're online. publicDiscovery connects
    // to plenty of non-Helix peers too (the public bootstrap swarm itself, and any
    // other provider of discoverRendezvousPeers' fixed CID - DHT crawlers, etc. - see
    // rendezvous.ts) - isHelixPeer gates the request on the same "does it actually
    // speak our directory protocol" signal filterHelixPeers already uses, so those
    // connections don't turn into a directory dial-and-fail against a peer that was
    // never going to answer, spamming the console with requests to unrelated addresses.
    this.node.addEventListener("peer:connect", (evt) => {
      const peerId = evt.detail.toString();
      this.peerContact = true;
      this.notify();
      if (this.directoryRequestedPeers.has(peerId)) return;
      this.directoryRequestedPeers.add(peerId);
      isHelixPeer(this.node, evt.detail)
        .then((isHelix) => {
          if (!isHelix) {
            this.directoryRequestedPeers.delete(peerId);
            return;
          }
          return this.requestDirectoryFrom(peerId);
        })
        .catch((err) => {
          this.directoryRequestedPeers.delete(peerId);
          console.warn(`[helix] [DIRECTORY] request to ${peerId} failed: ${err instanceof Error ? err.message : err}`);
        });
      this.announceIpfsAddr();
    });

    const bootstrap = import.meta.env.VITE_BOOTSTRAP_MULTIADDR;
    if (bootstrap) {
      try {
        await this.node.dial(multiaddr(bootstrap), { signal: AbortSignal.timeout(15_000) });
      } catch (err) {
        console.warn(`[helix] couldn't dial bootstrap peer ${bootstrap} - continuing standalone`, err);
      }
    }

    // Best-effort: find other Helix peers via the public IPFS/libp2p DHT (client-mode
    // only - see createNode.ts), beyond a hardcoded bootstrap. A browser tab can't
    // accept inbound connections at all, so this can only ever dial *into*
    // publicly-reachable Helix nodes (e.g. another peer:a/peer:b-style deployment).
    // Doesn't block startup on it - fires and forgets, since the public DHT can be
    // slow. User-controlled - see identity.ts's isPublicDiscoveryEnabled()/SettingsScreen.
    if (publicDiscovery) {
      this.discoverAndSync().catch(() => {});
      // Keep finding peers as they announce - the one-shot at startup misses anyone
      // that comes online later, and the public DHT is slow on a cold start.
      setInterval(() => {
        if (!this.publicDiscoveryEnabled) return;
        this.discoverAndSync().catch((err) => {
          console.warn(`[helix] DHT rendezvous rediscovery failed - continuing without it`, err);
        });
      }, REDISCOVERY_INTERVAL_MS);
    }

    // Passive directory propagation: re-announce a capped snapshot on the
    // `helix-directory` topic so peers that connect to *us* don't need a request.
    setInterval(() => this.broadcastDirectory(), DIRECTORY_BROADCAST_INTERVAL_MS);
  }

  /** A real TCP listen address for a Tauri webview (desktop or Android - see
   *  isTauri()/tauriTcpTransport.ts), so this node doesn't depend purely on an
   *  opportunistic circuit-relay reservation to be dialable - see createNode.ts's
   *  nativeTcpTransport NOTE. undefined for a literal browser tab, which has no IPC
   *  bridge to a native host capable of raw sockets at all, and undefined (with a
   *  warning, not a thrown error) if every candidate port is somehow unavailable -
   *  the node still starts up fine on webSockets()+circuitRelayTransport() alone.
   */
  private async createNativeTcpTransport() {
    if (!isTauri()) return undefined;
    try {
      const { tauriTcp, findAvailablePort } = await import("./tauriTcpTransport");
      const listenPort = await findAvailablePort(TAURI_TCP_CANDIDATE_PORTS);
      return { transport: tauriTcp(), listenPort };
    } catch (err) {
      console.warn("[helix] native TCP transport unavailable - falling back to relay-only", err);
      return undefined;
    }
  }

  /** Registers under `displayName` once connect() has finished, then creates the
   *  one-time "profile record" post - see editProfile() for how it's later edited.
   *  On a restart the genome is reused (registerUser returns the persisted record),
   *  so the profile post from the previous session is kept rather than re-created. */
  async register(displayName: string): Promise<void> {
    if (this.selfGenome) return;
    await this.connect();
    const { genome } = await registerUser(this.node, this.store, displayName);
    this.selfGenome = genome;

    if (!this.getCurrentProfilePost(genome.genome)) {
      const profilePost = await createPostApi(this.node, this.store, this.hlc, {
        authorGenome: genome.genome,
        kind: "profile",
        content: encodeProfile({ displayName }),
      });
      this.indexForSearch(profilePost);
    }
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
      if (follow.action === "unfollow") {
        this.store.getFollowGraph().removeFollow(follow.followerGenome, follow.followeeGenome);
      } else {
        this.store.getFollowGraph().addFollow(follow.followerGenome, follow.followeeGenome);
      }
      this.followEvents.push(follow);
      this.notify();
    } else if (evt.detail.topic === TOPICS.POSTS) {
      const post = decodePost(evt.detail.data);
      try {
        ingestPost(this.store, post);
      } catch (err) {
        if (err instanceof PostRejectedError) {
          console.warn(`[helix] rejected post ${post.postId}: ${err.message}`);
          return;
        }
        throw err;
      }
      this.hlc.update(post.hlcTimestamp);
      this.indexForSearch(post);
      this.notify();
    } else if (evt.detail.topic === TOPICS.IPFS_ADDR) {
      this.dialIpfsPeer(decodeIpfsAddr(evt.detail.data));
    } else if (evt.detail.topic === TOPICS.DIRECTORY) {
      try {
        const snapshot = decodeDirectory(evt.detail.data);
        const { genomesAccepted, postsAccepted } = ingestDirectory(this.store, snapshot);
        if (genomesAccepted > 0 || postsAccepted > 0) this.notify();
      } catch (err) {
        console.warn("[helix] [DIRECTORY] rejected message", err instanceof Error ? err.message : err);
      }
    }
  }

  /** Asks one connected peer for its directory and verifies/saves every entry locally.
   *  Everything is validated on receipt (PoW for genomes, ingestPost for posts) - a
   *  malicious peer can only waste a little local CPU, never inject unverified data. */
  private async requestDirectoryFrom(peerId: string): Promise<void> {
    const snapshot = await requestDirectory(this.node, peerId, {}, AbortSignal.timeout(15_000));
    const { genomesAccepted, postsAccepted } = ingestDirectory(this.store, snapshot);
    if (genomesAccepted > 0 || postsAccepted > 0) {
      console.log(`[helix] [DIRECTORY] synced ${genomesAccepted} genomes / ${postsAccepted} posts from ${peerId}`);
    }
    this.notify();
  }

  /** Dial into the public DHT, rendezvous to find Helix peers, and dial them - each
   *  dial fires `peer:connect`, which triggers the directory request. Best-effort;
   *  fire-and-forget at the call site so a slow DHT cold start never blocks the UI. */
  private async discoverAndSync(): Promise<void> {
    await connectPublicDiscovery(this.node);
    this.notify();
  }

  /** Passive directory announcement on the `helix-directory` topic. Capped well below
   *  a full response since it reaches every peer in the mesh. */
  private broadcastDirectory(): void {
    const snapshot = buildDirectorySnapshot(this.store, {
      limit: DIRECTORY_BROADCAST_MAX_GENOMES,
      recentPostsPerGenome: DIRECTORY_BROADCAST_POSTS_PER_GENOME,
    });
    if (snapshot.entries.length === 0) return;
    void this.node.services.pubsub
      .publish(TOPICS.DIRECTORY, encodeDirectory(snapshot))
      .catch((err) => {
        console.warn("[helix] [DIRECTORY] broadcast failed", err instanceof Error ? err.message : err);
      });
  }

  /** Best-effort: broadcasts this device's own Helia node's dialable multiaddrs (if
   *  any - real once either createHeliaTcpTransport() (Tauri desktop/Android) or
   *  isWebrtcAvailable() (browser tab/iOS) gave it a listen address; a plain
   *  dial-out-only Helia node has nothing worth announcing, caught by the
   *  multiaddrs.length check below). Fired on every peer:connect rather than once,
   *  both because a fresh connection is exactly when a peer needs this and because
   *  Helia is created lazily - the first few calls may have nothing to announce yet
   *  until getIpfsNode() has actually resolved once. */
  private announceIpfsAddr(): void {
    this.getIpfsNode()
      .then((ipfs) => {
        const multiaddrs = ipfs.libp2p.getMultiaddrs().map((a: { toString(): string }) => a.toString());
        if (multiaddrs.length === 0) return;
        return this.node.services.pubsub.publish(
          TOPICS.IPFS_ADDR,
          encodeIpfsAddr({ peerId: ipfs.libp2p.peerId.toString(), multiaddrs }),
        );
      })
      .catch((err) => {
        console.warn("[helix] [IPFS] failed to announce own IPFS address", err instanceof Error ? err.message : err);
      });
  }

  /** Mirrors the CLI's IPFS rendezvous (src/cli/peer.ts): a peer announces its separate
   *  Helia node's multiaddrs over gossipsub so we can dial it directly for bitswap.
   *  Accepts a WebSocket address (the webview can always dial out), a plain `/tcp/`
   *  one (heliaTcpTransport.ts - only actually dialable if this device also has the
   *  Tauri TCP bridge, checked inside the transport itself), or a `/webrtc/` one
   *  (webrtcTransport.ts - only actually dialable if this device supports WebRTC) -
   *  a failed dial here just falls through to the catch below, best-effort like
   *  everything else in this method - and skips anything already dialed. Best-effort
   *  throughout: attachment URL fetching never depends on this succeeding. */
  private dialIpfsPeer(msg: { peerId: string; multiaddrs: string[] }): void {
    if (this.dialedIpfsPeers.has(msg.peerId)) return;
    const dialable = msg.multiaddrs.find(
      (addr) => addr.includes("/ws") || addr.includes("/wss") || addr.includes("/webrtc/") || addr.includes("/tcp/"),
    );
    if (!dialable) return;
    this.dialedIpfsPeers.add(msg.peerId);
    this.getIpfsNode()
      .then((ipfs) => ipfs.libp2p.dial(multiaddrV13(dialable)))
      .then(() => console.log(`[helix] [IPFS] dialed peer's IPFS node at ${dialable}`))
      .catch((err) => {
        this.dialedIpfsPeers.delete(msg.peerId);
        console.warn(`[helix] [IPFS] failed to dial peer's IPFS node: ${err instanceof Error ? err.message : err}`);
      });
  }

  /** A real TCP listen address for Helia on a Tauri webview (desktop or Android),
   *  reusing the exact same @kuyoonjo/tauri-plugin-tcp bridge as the main node's own
   *  createNativeTcpTransport() above - a Tauri host process can already open raw
   *  sockets, so Helia doesn't need WebRTC's NAT-traversal/signaling machinery at all
   *  on these platforms. undefined for a literal browser tab (no IPC bridge to a
   *  native host) or if every candidate port is somehow unavailable, in which case
   *  getIpfsNode() falls back to WebRTC where available. */
  private async createHeliaTcpTransport() {
    if (!isTauri()) return undefined;
    try {
      const { heliaTauriTcp, findAvailablePort, multiaddr: multiaddrHelia } = await import("./heliaTcpTransport");
      const listenPort = await findAvailablePort(HELIA_TCP_CANDIDATE_PORTS);
      return {
        transport: heliaTauriTcp(),
        listenAddress: multiaddrHelia(`/ip4/0.0.0.0/tcp/${listenPort}`).toString(),
      };
    } catch (err) {
      console.warn("[helix] Helia TCP transport unavailable - falling back to webrtc/dial-out-only", err);
      return undefined;
    }
  }

  /** Lazily creates the single browser Helia node, reusing the protocol's lean
   *  createIpfsNode() (no bootstrap discovery, just identify - see src/ipfs/node.ts).
   *  Can always dial out (ws/wss); can also now accept inbound connections:
   *  - On a Tauri webview (desktop or Android), via a real TCP listener
   *    (heliaTcpTransport.ts) - the same raw-socket bridge already built for the main
   *    node, so no NAT-traversal/signaling dance is needed at all.
   *  - Otherwise, where isWebrtcAvailable() (see webrtcTransport.ts) - a literal
   *    browser tab or iOS, neither of which has that IPC bridge - by signaling
   *    through the main Helix node (already connected peer-to-peer) to negotiate a
   *    direct RTCDataChannel, no relay or raw socket needed.
   *  Where neither applies (Linux desktop's WebKitGTK has no RTCPeerConnection, and
   *  isn't reached here since isTauri() is true there and TCP is tried first), this
   *  stays exactly what it always was: a dial-out-only fetch/host client. Reseeding
   *  (see fetchAttachmentBytes) is what makes any of these cases worth having
   *  persistent storage for.
   *
   *  Persisted key + FileIO-backed blockstore/datastore (ipfsPersistence.ts) so
   *  published/fetched attachment bytes survive a restart instead of the in-memory
   *  default - same identity-namespaced pattern as the main store's PolyPack adapters. */
  getIpfsNode(): Promise<IpfsNode> {
    if (!this.ipfsNodePromise) {
      const namespace = this.identityNamespace ?? "anonymous";
      const storagePromise = createPersistentIpfsStorage(namespace);
      this.ipfsBlockstorePromise = storagePromise.then((s) => s.blockstore);
      this.ipfsNodePromise = (async () => {
        const [identity, storage, tcp] = await Promise.all([
          loadOrCreateIpfsPrivateKey(namespace),
          storagePromise,
          this.createHeliaTcpTransport(),
        ]);
        const transport = tcp
          ? { extraTransports: [tcp.transport], listenAddresses: [tcp.listenAddress] }
          : isWebrtcAvailable()
            ? {
                extraTransports: [webrtcTransport(this.node, WEBRTC_ICE_SERVERS)],
                listenAddresses: [buildWebrtcMultiaddr(this.node.peerId.toString(), identity.peerId).toString()],
              }
            : undefined;
        return createIpfsNode({
          privateKey: identity.privateKey,
          blockstore: storage.blockstore,
          datastore: storage.datastore,
          ...transport,
        });
      })();
    }
    return this.ipfsNodePromise;
  }

  /** The raw FileIoBlockstore backing getIpfsNode(), for pinning this device's own
   *  published attachments (see buildAttachment) - see the field doc comment above
   *  for why this isn't fished out of the Helia node itself. */
  private getIpfsBlockstore(): Promise<FileIoBlockstore> {
    void this.getIpfsNode(); // ensures ipfsBlockstorePromise is initialized
    return this.ipfsBlockstorePromise!;
  }

  /** True for a post's current (non-superseded) version - see the recombination handling. */
  private isCurrent(post: Helix): boolean {
    return !this.store.isSuperseded(post.postId);
  }

  /** App-layer ordering: newest first by HLC (the graph doesn't index timestamps). */
  private sortNewestFirst(posts: Helix[]): Helix[] {
    return [...posts].sort((a, b) => HybridLogicalClock.compare(b.hlcTimestamp, a.hlcTimestamp));
  }

  /** Feeds every newly-seen post into the search index - ordinary posts by content,
   *  profile posts by their (app-layer, decoded) display name. Called for every new post,
   *  whether self-authored or received over gossip - see src/backend/searchIndex.ts.
   *  Fire-and-forget: search results just lag briefly. */
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
    return this.sortNewestFirst(this.store.getAllPosts())
      .filter((post) => post.kind === "post" && !post.parentPostId && this.isCurrent(post))
      .map((post) => this.toPost(post));
  }

  getRepliesTo(postId: string): Post[] {
    return this.sortNewestFirst(this.store.getRepliesTo(postId)).map((post) => this.toPost(post));
  }

  /** Resolves a possibly-superseded id to its current version before looking it up. */
  getPost(postId: string): Post | undefined {
    const post = this.store.getCurrentVersion(postId);
    return post ? this.toPost(post) : undefined;
  }

  getPostsByAuthor(genome: string): Post[] {
    return this.sortNewestFirst(this.store.getPostsByGenome(genome))
      .filter((post) => post.kind === "post" && this.isCurrent(post))
      .map((post) => this.toPost(post));
  }

  private getCurrentProfilePost(genome: string): Helix | undefined {
    return this.store.getProfilePost(genome);
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

  /** For QrPairingScreen's post-dial fallback: dialPeerAddrs() above already waits up
   *  to 8s for the genome to resolve, but directory sync can take longer than that -
   *  this lets the screen keep re-checking (on whatever re-render eventually fires from
   *  a later notify()) without duplicating the peerId->genome lookup. */
  getUserByPeerId(peerId: string): User | undefined {
    const genome = this.store.getKnownGenomes().find((g) => g.peerId === peerId)?.genome;
    return genome ? this.getUser(genome) : undefined;
  }

  isFollowing(genome: string): boolean {
    if (!this.selfGenome) return false;
    return this.store.getFollowGraph().getFollowing(this.selfGenome.genome).includes(genome);
  }

  /** True once this peer has made connection with any other peer - a fresh user whose
   *  Discover/feed is still empty can be told "still finding peers…" instead of "nothing
   *  exists." */
  get hasNetworkContact(): boolean {
    return this.peerContact;
  }

  /** How many genomes this peer has observed (live gossip + directory sync). */
  getKnownGenomeCount(): number {
    return this.store.getKnownGenomes().length;
  }

  /**
   * "People you might want to follow": the existing 2nd-degree followers-of-followers
   * query first, then every other known genome the user doesn't follow yet, ranked by
   * most recent activity. Pure local derivation from the store - see the plan for why
   * the DHT finds peers, not users, so directory data (via getKnownGenomes) is what
   * makes this useful to a brand-new user.
   */
  getSuggestedUsers(limit = 20): User[] {
    if (!this.selfGenome) return [];
    const self = this.selfGenome.genome;
    const graph = this.store.getFollowGraph();
    const followed = new Set(graph.getFollowing(self));
    const suggested = new Set<string>(graph.getFollowersOfFollowers(self));

    for (const genome of this.store.getKnownGenomes()) {
      if (genome.genome === self || followed.has(genome.genome)) continue;
      suggested.add(genome.genome);
    }

    const latestActivity = (genome: string): number => {
      let max = 0;
      for (const post of this.store.getPostsByGenome(genome)) {
        max = Math.max(max, post.hlcTimestamp.physical);
      }
      return max;
    };

    return [...suggested]
      .sort((a, b) => latestActivity(b) - latestActivity(a))
      .slice(0, limit)
      .map((genome) => this.getUser(genome))
      .filter((u): u is User => u !== undefined);
  }

  /** Recent top-level posts from people the user doesn't follow yet - the content half
   *  of the Discover section. */
  getDiscoverFeed(limit = 20): Post[] {
    if (!this.selfGenome) return [];
    const self = this.selfGenome.genome;
    const followed = new Set(this.store.getFollowGraph().getFollowing(self));
    const posts = this.store
      .getAllPosts()
      .filter((p) => p.kind === "post" && !p.parentPostId && this.isCurrent(p) && p.genome !== self && !followed.has(p.genome));
    return this.sortNewestFirst(posts)
      .slice(0, limit)
      .map((p) => this.toPost(p));
  }

  /** Re-runs DHT rendezvous discovery + dials any newly-found peers (whose directories
   *  are then requested via peer:connect) - turns the startup one-shot into an on-demand
   *  refresh from the Discover screen. */
  async requestDirectoryRefresh(): Promise<void> {
    if (!this.publicDiscoveryEnabled) return;
    await this.discoverAndSync();
  }

  /**
   * This node's own dialable addresses, for showing in a QR pairing code (see
   * QrPairingScreen.tsx). Two kinds, both filtered in:
   *
   * - `/p2p-circuit/` addresses: a circuit-relay reservation, which only exists once
   *   publicDiscovery has landed one (not instant - see the NAT traversal notes in
   *   createNode.ts).
   * - Real `/ip4/<lan-ip>/tcp/<port>/` addresses from TauriTcpTransport (Tauri
   *   desktop/Android only - see doConnect()'s createNativeTcpTransport(); a literal
   *   browser tab never has one, per createNode.ts's "browser" NOTE). These resolve
   *   almost immediately (no relay reservation to wait for) and, for same-LAN pairing
   *   specifically, work with zero dependency on any relay or internet access at all.
   *   Loopback is excluded since nothing off-device could ever dial it.
   *
   * Empty until at least one of these exists; callers show a waiting state, not an
   * error.
   */
  getOwnConnectAddrs(): string[] {
    if (!this.publicDiscoveryEnabled) return [];
    return this.node
      .getMultiaddrs()
      .map((a) => a.toString())
      .filter((a) => a.includes("/p2p-circuit/") || (a.includes("/tcp/") && !a.includes("/ip4/127.0.0.1/")));
  }

  /**
   * Dials every candidate address from a scanned QR code (first success wins - same
   * race-and-take-the-first-connection shape as connectPublicDiscovery in
   * rendezvous.ts), then does a short bounded wait for the peer's genome to resolve.
   * Connecting itself already fires the existing peer:connect -> requestDirectoryFrom
   * flow above; this just waits for that to catch up rather than duplicating it, since
   * a scanned multiaddr's `/p2p/<peerId>` suffix means libp2p's noise handshake already
   * authenticates *which* peer we connected to - the only gap left is HOW LONG it takes
   * for its genome to arrive via directory sync.
   */
  async dialPeerAddrs(addrs: string[], signal?: AbortSignal): Promise<{ peerId: string; genome?: string }> {
    const dialSignal = signal ?? AbortSignal.timeout(20_000);
    const connection = await raceFulfilled(addrs.map((addr) => this.node.dial(multiaddr(addr), { signal: dialSignal })));
    const peerId = connection.remotePeer.toString();

    const genomeForPeer = (): string | undefined =>
      this.store.getKnownGenomes().find((g) => g.peerId === peerId)?.genome;

    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const genome = genomeForPeer();
      if (genome) return { peerId, genome };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { peerId, genome: genomeForPeer() };
  }

  /** Attachment to attach to a new post. `ipfsCid` is opt-in: if the caller already
   *  published to their own IPFS node (see getIpfsNode), it's passed through as-is. */
  async publish(
    content: string,
    parentPostId?: string,
    attachment?: { bytes: Uint8Array; mimeType: string; ipfsCid?: string },
  ): Promise<Post> {
    if (!this.selfGenome) throw new Error("HelixClient.publish: not registered yet");
    const post = await createPostApi(this.node, this.store, this.hlc, {
      authorGenome: this.selfGenome.genome,
      content,
      parentPostId,
      attachment: await this.buildAttachment(attachment),
    });
    this.indexForSearch(post);
    this.notify();
    return this.toPost(post);
  }

  /** Attachments at or under INLINE_MAX_BYTES get a data: URL - fast, and needs no
   *  network at all, but every peer that ever receives the post downloads and
   *  permanently stores it, so it's reserved for small media. Above that, only
   *  ipfsCid is set (unless the caller pre-supplied one): the post carries just a
   *  reference, and this device pins its own copy (see FileIoBlockstore's pin/evict
   *  doc comment) so the author stays a durable source regardless of local eviction
   *  pressure from other peers' content it's reseeded (see fetchAttachmentBytes).
   *
   *  A large attachment whose IPFS publish fails has no fallback at all - it would be
   *  a permanently unfetchable reference, including to its own author - so that's a
   *  hard failure here rather than the best-effort warning a small (inlined) one gets. */
  private async buildAttachment(
    attachment?: { bytes: Uint8Array; mimeType: string; ipfsCid?: string },
  ): Promise<{ bytes: Uint8Array; mimeType: string; sourceUrl?: string; ipfsCid?: string } | undefined> {
    if (!attachment) return undefined;
    const inline = attachment.bytes.length <= INLINE_MAX_BYTES;
    const base = {
      bytes: attachment.bytes,
      mimeType: attachment.mimeType,
      sourceUrl: inline ? toDataUrl(attachment.bytes, attachment.mimeType) : undefined,
      ipfsCid: attachment.ipfsCid,
    };
    if (attachment.ipfsCid) return base;
    try {
      const [ipfs, blockstore] = await Promise.all([this.getIpfsNode(), this.getIpfsBlockstore()]);
      const ipfsCid = await publishAttachmentToIpfs(ipfs, attachment.bytes);
      await blockstore.pin(ipfsCid);
      return { ...base, ipfsCid };
    } catch (err) {
      if (!inline) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to publish attachment: IPFS is unreachable and the attachment is too large to inline (${message})`,
        );
      }
      console.warn("[helix] [IPFS] failed to publish attachment to local IPFS node - data: URL only", err);
      return base;
    }
  }

  /** Fetches and verifies an attachment's bytes, caching by hashHex so the feed and
   *  thread views never refetch. `sourceUrl` (present only for small/inlined
   *  attachments, or pre-existing posts from before the size threshold existed) is
   *  always tried first when present - it's instant and needs no network. Otherwise
   *  (or if that fails) falls to real IPFS via `ipfsCid`, when reachable. Throws on
   *  verification failure or an unreachable source - callers render the error state. */
  async fetchAttachmentBytes(attachment: PostAttachment): Promise<Uint8Array> {
    const cached = this.attachmentCache.get(attachment.hashHex);
    if (cached) return cached;

    const protocolAttachment: Attachment = {
      hashHex: attachment.hashHex,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sourceUrl: attachment.sourceUrl,
      ipfsCid: attachment.ipfsCid,
    };

    let bytes: Uint8Array;
    if (attachment.sourceUrl) {
      try {
        bytes = await fetchAndVerifyAttachment(protocolAttachment);
      } catch (urlErr) {
        bytes = await this.fetchAttachmentViaIpfs(protocolAttachment, urlErr);
      }
    } else {
      bytes = await this.fetchAttachmentViaIpfs(protocolAttachment);
    }

    this.attachmentCache.set(attachment.hashHex, bytes);
    void this.reseedAttachment(attachment.ipfsCid, bytes);
    return bytes;
  }

  private async fetchAttachmentViaIpfs(attachment: Attachment, urlErr?: unknown): Promise<Uint8Array> {
    if (!attachment.ipfsCid || this.dialedIpfsPeers.size === 0) {
      throw urlErr ?? new AttachmentVerificationError("fetchAttachmentBytes: no sourceUrl, and no reachable IPFS peer");
    }
    try {
      const ipfs = await this.getIpfsNode();
      return await fetchAndVerifyAttachmentFromIpfs(ipfs, attachment);
    } catch (ipfsErr) {
      if (urlErr) console.warn(`[helix] [ATTACHMENT] URL fetch failed (${urlErr}) and IPFS fallback also failed (${ipfsErr})`);
      throw urlErr ?? ipfsErr;
    }
  }

  /** Best-effort: after fetching an attachment via *either* transport, make sure this
   *  device's own persistent blockstore has the bytes too, so it becomes a source, not
   *  just a sink - reading a post shouldn't be a one-way trip. A bitswap-fetched block
   *  already lands in the local blockstore automatically as a side effect of the fetch
   *  itself; this only adds something for the sourceUrl (data: URL) path, which never
   *  otherwise touches the blockstore. Never lets a reseed failure affect the read that
   *  triggered it. See getIpfsNode()'s doc comment for what reseeding can/can't achieve
   *  without a dialable transport of this device's own. */
  private async reseedAttachment(ipfsCid: string | undefined, bytes: Uint8Array): Promise<void> {
    if (!ipfsCid) return;
    try {
      const blockstore = await this.getIpfsBlockstore();
      if (await blockstore.has(CID.parse(ipfsCid))) return;
      const ipfs = await this.getIpfsNode();
      await publishAttachmentToIpfs(ipfs, bytes);
    } catch {
      // best-effort only
    }
  }

  /** Verifies and returns an attachment's bytes as a display-ready data: URL. */
  async fetchAttachmentDataUrl(attachment: PostAttachment): Promise<string> {
    const bytes = await this.fetchAttachmentBytes(attachment);
    return toDataUrl(bytes, attachment.mimeType);
  }

  async follow(genome: string): Promise<void> {
    if (!this.selfGenome) throw new Error("HelixClient.follow: not registered yet");
    const follow = await followUser(this.node, this.store, this.hlc, this.selfGenome.genome, genome);
    this.followEvents.push(follow);
    this.notify();
  }

  async unfollow(genome: string): Promise<void> {
    if (!this.selfGenome) throw new Error("HelixClient.unfollow: not registered yet");
    const unfollow = await unfollowUser(this.node, this.store, this.hlc, this.selfGenome.genome, genome);
    this.followEvents.push(unfollow);
    this.notify();
  }

  /** Unlike follow/unfollow, this never touches the network - blocking is purely local
   *  (see src/social/blockGraph.ts for why), just a graph edge persisted the same way
   *  as follows so it survives restarts without a bespoke localStorage key. */
  blockUser(genome: string): void {
    if (!this.selfGenome) throw new Error("HelixClient.blockUser: not registered yet");
    this.store.getBlockGraph().addBlock(this.selfGenome.genome, genome);
    this.notify();
  }

  unblockUser(genome: string): void {
    if (!this.selfGenome) throw new Error("HelixClient.unblockUser: not registered yet");
    this.store.getBlockGraph().removeBlock(this.selfGenome.genome, genome);
    this.notify();
  }

  isBlocked(genome: string): boolean {
    if (!this.selfGenome) return false;
    return this.store.getBlockGraph().isBlocked(this.selfGenome.genome, genome);
  }

  getBlockedGenomes(): string[] {
    if (!this.selfGenome) return [];
    return this.store.getBlockGraph().getBlocked(this.selfGenome.genome);
  }

  /** "Edit" a post: publishes a new version that supersedes it. The original stays in
   *  the append-only log, unchanged and still provable - see src/api/createPost.ts. */
  async recombine(
    targetPostId: string,
    content: string,
    attachment?: { bytes: Uint8Array; mimeType: string; ipfsCid?: string },
  ): Promise<Post> {
    if (!this.selfGenome) throw new Error("HelixClient.recombine: not registered yet");
    const post = await createPostApi(this.node, this.store, this.hlc, {
      authorGenome: this.selfGenome.genome,
      content,
      recombinesPostId: targetPostId,
      attachment: await this.buildAttachment(attachment),
    });
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
    return this.store.getReactionsTo(targetPostId, kind).find((p) => p.genome === this.selfGenome!.genome);
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
      await createPostApi(this.node, this.store, this.hlc, {
        authorGenome: this.selfGenome.genome,
        content: encodeReaction({ active }),
        recombinesPostId: existing.postId,
      });
    } else {
      if (!active) return; // nothing to turn off if it was never on
      await createPostApi(this.node, this.store, this.hlc, {
        authorGenome: this.selfGenome.genome,
        kind,
        content: encodeReaction({ active: true }),
        parentPostId: targetPostId,
      });
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
   *  from the store's RELATES_TO traversals plus `this.followEvents` rather than a
   *  separate persisted log, same as every other view in this client. Excludes your
   *  own reactions to your own posts and only counts each reaction/reply chain's
   *  current (non-superseded) version, so toggling a like off and back on doesn't
   *  produce two notifications. */
  getNotifications(): Notification[] {
    if (!this.selfGenome) return [];
    const selfGenome = this.selfGenome.genome;
    const myPostIds = new Set(this.store.getPostsByGenome(selfGenome).filter((p) => p.kind === "post").map((p) => p.postId));

    type Item = { kind: Notification["kind"]; actorGenome: string; hlcTimestamp: Helix["hlcTimestamp"]; targetPostId?: string };
    const items: Item[] = [];

    for (const p of this.store.getAllPosts()) {
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
      if (f.followeeGenome === selfGenome && f.followerGenome !== selfGenome && f.action === "follow") {
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
   *  Search hits are resolved back against the store/`getUser` and filtered to current
   *  (non-superseded) versions here, same as every other post-listing getter. */
  async search(query: string, limit = 20): Promise<{ posts: Post[]; users: User[] }> {
    const { postIds, genomes } = await this.searchIndex.search(query, limit);

    const posts = postIds
      .map((id) => this.store.getPost(id))
      .filter((p): p is Helix => p !== undefined && p.kind === "post" && this.isCurrent(p))
      .map((p) => this.toPost(p));

    const users = genomes.map((g) => this.getUser(g)).filter((u): u is User => u !== undefined);

    return { posts, users };
  }

  /** Distinct authoring genomes with an active (not toggled-off) reaction - not raw
   *  post count, so an accidental double-click or a toggle-off/on cycle never
   *  double-counts (there's no protocol-level duplicate rejection). */
  private countActiveReactions(kind: "like" | "boost", targetPostId: string): number {
    const genomes = new Set<string>();
    for (const p of this.store.getReactionsTo(targetPostId, kind)) {
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
      replyCount: this.store.getRepliesTo(post.postId).length,
      boostCount: this.countActiveReactions("boost", post.postId),
      likeCount: this.countActiveReactions("like", post.postId),
      wasEdited: post.recombinesPostId !== undefined,
      attachment: post.attachment,
    };
  }
}
