import { pushable, type Pushable } from "it-pushable";
import { TypedEventEmitter } from "main-event";
import { logger } from "@libp2p/logger";
// v13, not the top-level (v12) @multiformats/multiaddr - Helia's own nested libp2p
// stack (@libp2p/interface v3) expects v13-compatible Multiaddr instances (same
// reasoning as client.ts's existing multiaddrV13 use for ipfs.libp2p.dial()); a v12
// instance handed to Helia's own upgrader/AddressManager risks the exact class of
// cross-version duplicate-package mismatch this codebase has hit repeatedly elsewhere.
import { multiaddr, type Multiaddr } from "@multiformats/multiaddr-v13";
import { transportSymbol } from "@libp2p/interface";
import type { Uint8ArrayList } from "uint8arraylist";
import type { HelixNode } from "@helix/node/createNode.js";
import { openSignalStream, registerSignalHandler, type SignalMessage, type SignalWriter } from "@helix/node/webrtcSignal.js";

const log = logger("helix:webrtc-transport");

/**
 * Every function/method signature below that crosses into Helia's own (v3-pinned
 * @libp2p/interface) transport machinery - dial/createListener/listenFilter/
 * dialFilter, the Listener class, the MultiaddrConnection this produces - is typed
 * loosely (`any`/`unknown`) rather than against @libp2p/interface's real Transport/
 * Listener/MultiaddrConnection types. Those types are this project's top-level
 * (v2-pinned, for gossipsub compatibility - see src/ipfs/node.ts's class doc comment)
 * copies; Helia's TransportManager/AddressManager call these methods with ITS OWN v3
 * copies' instances, which are structurally identical at runtime but nominally
 * distinct (private-field-branded), the same cross-version duplicate-package
 * friction this codebase has hit everywhere else Helia's boundary is touched. The
 * object shapes here still fully satisfy the real interface-transport spec at
 * runtime - only the TypeScript checking is loosened, same as createIpfsNode's own
 * blockstore/datastore/extraTransports params.
 */

/** `webrtc` (multiaddr protocol code 281) is a real, registered multiaddr protocol - a
 *  bare flag like `/p2p-circuit`, no value of its own. Our multiaddrs are shaped
 *  `/p2p/<mainNodePeerId>/webrtc/p2p/<heliaPeerId>`: the first /p2p/ says which main
 *  Helix-node peer to open a signaling stream through (see webrtcSignal.ts); the
 *  trailing one is the target's Helia PeerId, same convention as a normal /p2p-circuit
 *  address naming the peer being circuited to. */
const P2P_CODE = 421;

/** True only where RTCPeerConnection actually exists and (per feature-detection, not
 *  just presence) can construct a real connection - WebKitGTK (Tauri's Linux desktop
 *  webview) declares no such global at all in a standard, non-custom-compiled build,
 *  unlike Android's Chromium webview, Windows' WebView2, or macOS/iOS's WebKit (which
 *  does support WebRTC, unlike the Linux GTK port). Checked once, lazily, rather than
 *  assumed - a browser build should never crash on `new RTCPeerConnection()` just
 *  because this transport was unconditionally registered. */
export function isWebrtcAvailable(): boolean {
  return typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection === "function";
}

function buildWebrtcMultiaddr(mainNodePeerId: string, heliaPeerId: string): Multiaddr {
  return multiaddr(`/p2p/${mainNodePeerId}/webrtc/p2p/${heliaPeerId}`);
}

function parseWebrtcMultiaddr(ma: Multiaddr): { mainNodePeerId: string; heliaPeerId: string } | undefined {
  const components = ma.getComponents();
  if (!components.some((c) => c.name === "webrtc")) return undefined;
  const p2pValues = components.filter((c) => c.code === P2P_CODE).map((c) => c.value).filter((v): v is string => v !== undefined);
  if (p2pValues.length < 2) return undefined;
  return { mainNodePeerId: p2pValues[0], heliaPeerId: p2pValues[p2pValues.length - 1] };
}

/** Always copies into a fresh, plain-ArrayBuffer-backed Uint8Array - RTCDataChannel.send's
 *  TS typing rejects a view that could be backed by a SharedArrayBuffer, which a
 *  Uint8ArrayList's chunks or a pooled buffer elsewhere in the pipeline could in
 *  principle be. The copy is cheap relative to a network send either way. */
function toUint8Array(chunk: Uint8Array | Uint8ArrayList): Uint8Array {
  return new Uint8Array(chunk instanceof Uint8Array ? chunk : chunk.subarray());
}

const CONNECT_TIMEOUT_MS = 15_000;

/** Wraps an already-open RTCDataChannel as a MultiaddrConnection - once signaling has
 *  produced a connected channel, the libp2p stream used to negotiate it is no longer
 *  involved; this is the actual data path bitswap runs over. */
interface LooseMultiaddrConnection {
  sink: (source: AsyncIterable<Uint8Array | Uint8ArrayList>) => Promise<void>;
  source: AsyncIterable<Uint8Array>;
  remoteAddr: Multiaddr;
  timeline: { open: number; close?: number };
  close: () => Promise<void>;
  abort: (err: Error) => void;
  log: unknown;
}

function dataChannelToMultiaddrConnection(opts: {
  channel: RTCDataChannel;
  pc: RTCPeerConnection;
  remoteAddr: Multiaddr;
}): LooseMultiaddrConnection {
  const { channel, pc } = opts;
  channel.binaryType = "arraybuffer";
  const source: Pushable<Uint8Array> = pushable<Uint8Array>();

  channel.onmessage = (evt: MessageEvent) => {
    source.push(new Uint8Array(evt.data as ArrayBuffer));
  };
  channel.onclose = () => {
    source.end();
  };
  channel.onerror = () => {
    source.end(new Error("webrtc data channel error"));
  };

  let closed = false;
  const maConn = {
    async sink(streamSource: AsyncIterable<Uint8Array | Uint8ArrayList>) {
      try {
        for await (const chunk of streamSource) {
          // Cast: TS's DOM lib types RTCDataChannel.send's ArrayBufferView overload as
          // specifically ArrayBuffer-backed, but Uint8Array's own constructor types its
          // result as the more general ArrayBufferLike (which also covers
          // SharedArrayBuffer) even though toUint8Array() always allocates a plain one.
          channel.send(toUint8Array(chunk) as Uint8Array<ArrayBuffer>);
        }
      } finally {
        await maConn.close();
      }
    },
    source,
    remoteAddr: opts.remoteAddr,
    timeline: { open: Date.now() } as { open: number; close?: number },
    async close() {
      if (closed) return;
      closed = true;
      maConn.timeline.close = Date.now();
      source.end();
      channel.close();
      pc.close();
    },
    abort(err: Error) {
      source.end(err);
      void maConn.close();
    },
    log: logger("helix:webrtc-transport:connection"),
  };
  return maConn;
}

/** Wires local ICE candidates to the signaling writer - must be called immediately
 *  after constructing `pc`, *before* createOffer/createAnswer/setLocalDescription,
 *  never inside pumpSignalMessages: setLocalDescription is what starts ICE gathering,
 *  and a candidate that fires before a handler is attached is just gone - WebRTC
 *  doesn't buffer/replay events for a listener added later. Every candidate a peer
 *  gathers (including the first, often-fastest "host" one) matters for how quickly
 *  (or whether) a direct connection forms. */
function wireLocalIceCandidates(pc: RTCPeerConnection, writer: SignalWriter): void {
  pc.onicecandidate = (evt: RTCPeerConnectionIceEvent) => {
    if (evt.candidate) writer.send({ type: "ice", candidate: evt.candidate.toJSON() });
  };
}

/** Drives one side of a signaling exchange to completion, feeding incoming
 *  offer/answer/ICE messages into `pc` as they arrive, until `pc`'s own data channel
 *  opens or `signal` aborts. Shared by both the offerer (dial) and answerer
 *  (incoming signal) - they differ only in who creates the offer/answer, not in how
 *  incoming messages get applied. Callers must call wireLocalIceCandidates() first. */
async function pumpSignalMessages(
  pc: RTCPeerConnection,
  writer: SignalWriter,
  messages: AsyncGenerator<SignalMessage>,
  signal: AbortSignal,
): Promise<void> {
  const abortListener = () => void messages.return(undefined);
  signal.addEventListener("abort", abortListener);
  try {
    for await (const message of messages) {
      if (message.type === "answer") {
        await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
      } else if (message.type === "offer") {
        await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        writer.send({ type: "answer", sdp: answer.sdp ?? "" });
      } else if (message.type === "ice") {
        await pc.addIceCandidate(message.candidate as RTCIceCandidateInit).catch((err: unknown) => {
          log.error("failed to add remote ICE candidate - %o", err);
        });
      } else if (message.type === "done") {
        break;
      }
      if (pc.connectionState === "connected") break;
    }
  } finally {
    signal.removeEventListener("abort", abortListener);
  }
}

function waitForOpenChannel(channel: RTCDataChannel, signal: AbortSignal): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("webrtc data channel failed to open"));
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("webrtc dial aborted"));
    };
    const cleanup = () => {
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    channel.addEventListener("open", onOpen);
    channel.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort);
  });
}

class WebrtcListener extends TypedEventEmitter<Record<"listening" | "error" | "close", CustomEvent>> {
  private listeningAddr: Multiaddr | undefined;

  constructor(
    private readonly options: { upgrader: { upgradeInbound: (maConn: unknown) => Promise<unknown> } },
    private readonly heliaPeerId: string,
  ) {
    super();
  }

  async listen(ma: Multiaddr): Promise<void> {
    this.listeningAddr = ma;
    this.safeDispatchEvent("listening");
  }

  /** Called by the module-level signal handler (see registerIncomingWebrtcSignals)
   *  for every inbound offer, regardless of which mainNodePeerId sent it - this
   *  transport answers anyone who signals it, the same trust posture as accepting any
   *  inbound TCP connection on a listening port. */
  async handleIncomingOffer(
    iceServers: RTCIceServer[],
    mainNodePeerId: string,
    writer: SignalWriter,
    messages: AsyncGenerator<SignalMessage>,
    signal: AbortSignal,
  ): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers });
    wireLocalIceCandidates(pc, writer);
    const channelPromise = new Promise<RTCDataChannel>((resolve) => {
      pc.ondatachannel = (evt: RTCDataChannelEvent) => resolve(evt.channel);
    });

    await pumpSignalMessages(pc, writer, messages, signal);
    const channel = await channelPromise;
    await waitForOpenChannel(channel, signal);

    const remoteAddr = buildWebrtcMultiaddr(mainNodePeerId, this.heliaPeerId);
    const maConn = dataChannelToMultiaddrConnection({ channel, pc, remoteAddr });
    await this.options.upgrader.upgradeInbound(maConn).catch((err: unknown) => {
      maConn.abort(err instanceof Error ? err : new Error(String(err)));
    });
  }

  getAddrs(): Multiaddr[] {
    return this.listeningAddr ? [this.listeningAddr] : [];
  }

  updateAnnounceAddrs(): void {}

  async close(): Promise<void> {
    this.safeDispatchEvent("close");
  }
}

/** One transport instance's active listener, if any - set by createListener()/listen(),
 *  read by the signal handler registered separately (see registerIncomingWebrtcSignals)
 *  so an inbound signal can be routed to whichever listener is currently up. There's
 *  only ever one Helia node (and one listen address) per app instance, so a single
 *  module-level slot (not per-factory-call state) is simplest and matches that reality. */
let activeListener: WebrtcListener | undefined;

/** DialTransportOptions's real shape includes progress-event options this transport
 *  doesn't use - only `signal` and `upgrader` matter here. */
interface LooseDialOptions {
  signal: AbortSignal;
  upgrader: { upgradeOutbound: (maConn: unknown, options: unknown) => Promise<unknown> };
}

export function webrtcTransport(mainNode: HelixNode, iceServers: RTCIceServer[]): () => unknown {
  return () => ({
    [transportSymbol]: true,
    [Symbol.toStringTag]: "@helix/webrtc",

    async dial(ma: Multiaddr, options: LooseDialOptions): Promise<unknown> {
      const parsed = parseWebrtcMultiaddr(ma);
      if (!parsed) throw new Error(`webrtc transport: cannot dial ${ma.toString()}`);

      const pc = new RTCPeerConnection({ iceServers });
      const channel = pc.createDataChannel("helix-ipfs");
      const { writer, messages } = await openSignalStream(mainNode, parsed.mainNodePeerId, options.signal);
      // Safe this late (only) because nothing before setLocalDescription below triggers
      // ICE gathering - see wireLocalIceCandidates's doc comment for why the ordering
      // matters at all.
      wireLocalIceCandidates(pc, writer);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        writer.send({ type: "offer", sdp: offer.sdp ?? "" });

        await Promise.race([
          pumpSignalMessages(pc, writer, messages, options.signal),
          waitForOpenChannel(channel, options.signal),
        ]);
        await waitForOpenChannel(channel, options.signal);
      } finally {
        await writer.end().catch(() => {});
      }

      const maConn = dataChannelToMultiaddrConnection({ channel, pc, remoteAddr: ma });
      try {
        return await options.upgrader.upgradeOutbound(maConn, options);
      } catch (err) {
        maConn.abort(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },

    createListener(options: { upgrader: { upgradeInbound: (maConn: unknown) => Promise<unknown> } }): WebrtcListener {
      // The Helia peerId is encoded into every listen address we're ever given (see
      // client.ts's construction of it), so any one of them tells us who we are.
      const heliaPeerId = mainNode.peerId.toString();
      const listener = new WebrtcListener(options, heliaPeerId);
      activeListener = listener;
      return listener;
    },

    listenFilter(multiaddrs: Multiaddr[]): Multiaddr[] {
      return multiaddrs.filter((ma) => parseWebrtcMultiaddr(ma) !== undefined);
    },

    dialFilter(multiaddrs: Multiaddr[]): Multiaddr[] {
      return multiaddrs.filter((ma) => parseWebrtcMultiaddr(ma) !== undefined);
    },
  });
}

/** Registers the responder side of signaling on the *main* Helix node - answers any
 *  incoming offer by handing it to whichever WebrtcListener is currently active (there
 *  is at most one per app instance). A signal that arrives before any listener exists
 *  (Helia node not yet constructed) is dropped; the offerer's dial will simply time out
 *  and can retry, same as any other best-effort path in this codebase. */
export function registerIncomingWebrtcSignals(mainNode: HelixNode, iceServers: RTCIceServer[]): void {
  registerSignalHandler(mainNode, async (writer, messages) => {
    if (!activeListener) {
      log("dropping incoming webrtc signal - no active listener yet");
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      // The offerer's own PeerId on the main node isn't in the signal payload itself,
      // but registerSignalHandler's underlying libp2p stream is already scoped to
      // exactly one remote peer (that's what dialProtocol/handle connect); the
      // remoteAddr this produces is cosmetic (used only for logging/inspection, not
      // for dialing back), so an exact peerId isn't required here - "unknown" is fine.
      await activeListener.handleIncomingOffer(iceServers, "unknown", writer, messages, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  });
}

/** Re-exported for client.ts. */
export { buildWebrtcMultiaddr };
