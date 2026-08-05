import { pushable, type Pushable } from 'it-pushable';
import { peerIdFromString } from '@libp2p/peer-id';
import type { HelixNode } from './createNode.js';
import type { Stream } from '@libp2p/interface';

/**
 * WebRTC signaling: exchanges SDP offer/answer and trickled ICE candidates between two
 * peers so their (separate, v3-@libp2p/interface-pinned) Helia nodes can establish a
 * direct RTCDataChannel - see app/src/backend/webrtcTransport.ts, which is where the
 * actual RTCPeerConnection lives. Kept platform-agnostic here (no RTCPeerConnection
 * reference at all) so this file stays usable from the Node CLI's tsconfig, same as
 * directory.ts - only the wire format and stream I/O plumbing live here.
 *
 * Unlike directory.ts's one-shot request-response, this keeps a single stream open for
 * a back-and-forth of several small messages (the offer, then answer, then however many
 * ICE candidates trickle in on each side) - framed as newline-delimited JSON rather than
 * a length-prefixed codec, since messages are small and this is far simpler to get right.
 * The stream is closed once both sides are done signaling; the resulting data channel is
 * independent of it from that point on.
 */
export const WEBRTC_SIGNAL_PROTOCOL = '/helix/webrtc-signal/1.0.0';

export type SignalMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: unknown }
  | { type: 'done' };

/** A line-buffered NDJSON writer over a libp2p Stream's sink - one send() call per
 *  message, safe to call repeatedly as candidates trickle in over time (unlike calling
 *  `stream.sink()` itself more than once, which isn't how it's meant to be used - sink()
 *  is called exactly once here, fed by this pushable). */
export class SignalWriter {
  private readonly out: Pushable<Uint8Array> = pushable();
  private readonly sinkPromise: Promise<void>;

  constructor(stream: Stream) {
    this.sinkPromise = stream.sink(this.out);
  }

  send(message: SignalMessage): void {
    this.out.push(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  }

  /** Ends the write side and waits for the underlying sink to finish flushing. */
  async end(): Promise<void> {
    this.out.end();
    await this.sinkPromise.catch(() => {});
  }
}

/** Yields each newline-delimited JSON message from a libp2p Stream's source as it
 *  arrives, tolerating messages split across chunk boundaries (a chunk is not
 *  guaranteed to end on a message boundary). Malformed lines are skipped, not thrown -
 *  a signaling peer sending garbage should end the exchange, not crash it. */
export async function* readSignalMessages(stream: Stream): AsyncGenerator<SignalMessage> {
  let buffer = '';
  for await (const chunk of stream.source) {
    const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray();
    buffer += new TextDecoder().decode(bytes);
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as SignalMessage;
      } catch {
        // malformed line - skip it rather than aborting the whole exchange
      }
    }
  }
}

type DialablePeer = Parameters<HelixNode['dialProtocol']>[0];
export type SignalPeer = DialablePeer | string;

function toDialable(peer: SignalPeer): DialablePeer {
  return typeof peer === 'string' ? peerIdFromString(peer) : peer;
}

/** Opens a signaling stream to a connected peer - the caller (the WebRTC offerer) drives
 *  the exchange from here via the returned reader/writer pair. */
export async function openSignalStream(
  node: HelixNode,
  peer: SignalPeer,
  signal?: AbortSignal,
): Promise<{ stream: Stream; writer: SignalWriter; messages: AsyncGenerator<SignalMessage> }> {
  const stream = await node.dialProtocol(toDialable(peer), WEBRTC_SIGNAL_PROTOCOL, { signal });
  return { stream, writer: new SignalWriter(stream), messages: readSignalMessages(stream) };
}

/** Registers the responder side: an incoming signaling stream gets handed to `onIncoming`
 *  (the WebRTC answerer logic - see webrtcTransport.ts), which reads offer/ICE messages
 *  via the given reader and sends answer/ICE messages via the given writer. Best-effort:
 *  a handler that throws just closes the stream, same posture as registerDirectoryHandler. */
export function registerSignalHandler(
  node: HelixNode,
  onIncoming: (writer: SignalWriter, messages: AsyncGenerator<SignalMessage>) => Promise<void>,
): void {
  node
    .handle(WEBRTC_SIGNAL_PROTOCOL, async ({ stream }) => {
      const writer = new SignalWriter(stream);
      try {
        await onIncoming(writer, readSignalMessages(stream));
      } catch (err) {
        console.warn('[helix] [WEBRTC] signal handler failed', err instanceof Error ? err.message : err);
      } finally {
        await writer.end().catch(() => {});
        await stream.close().catch(() => {});
      }
    })
    .catch((err) => {
      console.warn('[helix] failed to register webrtc signal handler', err instanceof Error ? err.message : err);
    });
}
