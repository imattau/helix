import { sha256 } from '../crypto/hash.js';
import { toHex, fromHex } from '../crypto/hex.js';
import { computeVdf, verifyVdf, DEFAULT_DIFFICULTY } from './toyVdf.js';
import { decodeTick, encodeTick } from './protocol.js';
import { TOPICS } from '../node/pubsubTopics.js';
import type { VDFTickMessage } from '../types/index.js';
import type { HelixNode } from '../node/createNode.js';

const GENESIS_SEED = sha256(new TextEncoder().encode('helix-genesis-vdf-seed-v1'));

/**
 * Decentralized timestamp clock built on a libp2p gossipsub topic.
 *
 * One or more peers ("producers") run tickLoop(), chaining
 * seed_{n+1} = output_n through the toy VDF and gossiping each tick.
 * All peers (producers and consumers) verify every tick they receive by
 * recomputing it, then extend their local chain tip.
 *
 * `network_clock.now()` from the original pseudocode maps to latestTick():
 * posts anchor their timestamp to the latest known tick, not wall-clock time.
 *
 * Multi-producer race/fork-choice is NOT handled here — only a single producer
 * is used in the demo. This is called out as future work in the project plan.
 */
export class VDFClock {
  private tickIndex = -1; // -1 = genesis, no tick computed yet
  private latestOutput: Uint8Array = GENESIS_SEED;
  private listeners: Array<(tick: VDFTickMessage) => void> = [];
  private producing = false;

  constructor(
    private readonly node: HelixNode,
    private readonly difficulty: number = DEFAULT_DIFFICULTY,
  ) {}

  start(): void {
    const pubsub = this.node.services.pubsub;
    pubsub.subscribe(TOPICS.VDF_TICK);
    pubsub.addEventListener('message', (evt) => {
      if (evt.detail.topic !== TOPICS.VDF_TICK) return;
      this.handleIncomingTick(decodeTick(evt.detail.data));
    });
  }

  startProducing(): void {
    if (this.producing) return;
    this.producing = true;
    void this.tickLoop();
  }

  stopProducing(): void {
    this.producing = false;
  }

  onTick(cb: (tick: VDFTickMessage) => void): void {
    this.listeners.push(cb);
  }

  latestTick(): { tickIndex: number; outputHex: string } {
    return { tickIndex: this.tickIndex, outputHex: toHex(this.latestOutput) };
  }

  private async tickLoop(): Promise<void> {
    while (this.producing) {
      const seed = this.latestOutput;
      const output = computeVdf(seed, this.difficulty);
      const tick: VDFTickMessage = {
        tickIndex: this.tickIndex + 1,
        seedHex: toHex(seed),
        outputHex: toHex(output),
        difficulty: this.difficulty,
        prevTickHashHex: toHex(seed),
      };
      this.applyTick(tick);
      try {
        await this.node.services.pubsub.publish(TOPICS.VDF_TICK, encodeTick(tick));
      } catch {
        // no peers subscribed yet - fine, keep ticking locally
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private handleIncomingTick(tick: VDFTickMessage): void {
    const isBootstrapping = this.tickIndex === -1;

    // A freshly-joined consumer has no chain history yet (gossipsub commonly drops the
    // earliest messages while its mesh is still forming - see the demo/plan notes on
    // this being prototype-grade). Rather than get permanently stuck waiting for tick 0
    // specifically, trust the first verified tick observed as the join point, then
    // enforce strict sequential chaining from there on.
    if (!isBootstrapping) {
      if (tick.tickIndex !== this.tickIndex + 1) return; // out of order or duplicate
      if (tick.seedHex !== toHex(this.latestOutput)) return; // doesn't chain from our tip
    }

    const seed = fromHex(tick.seedHex);
    const output = fromHex(tick.outputHex);
    if (!verifyVdf(seed, output, tick.difficulty)) return; // reject invalid proof
    this.applyTick(tick);
  }

  private applyTick(tick: VDFTickMessage): void {
    this.tickIndex = tick.tickIndex;
    this.latestOutput = fromHex(tick.outputHex);
    for (const cb of this.listeners) cb(tick);
  }
}
