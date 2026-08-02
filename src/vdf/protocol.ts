import type { VDFTickMessage } from '../types/index.js';

/** Wire encoding for VDFTickMessage — plain JSON over the gossipsub topic payload. */
export function encodeTick(tick: VDFTickMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(tick));
}

export function decodeTick(data: Uint8Array): VDFTickMessage {
  return JSON.parse(new TextDecoder().decode(data)) as VDFTickMessage;
}
