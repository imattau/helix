/**
 * Wire format for the QR direct-pairing payload (see QrPairingScreen.tsx). Each entry
 * in `addrs` is already a complete multiaddr string ending in `/p2p/<peerId>` (as
 * returned by `HelixClient.getOwnConnectAddrs()`), so no separate PeerId field is
 * needed - dialing a multiaddr with a `/p2p/` suffix already makes libp2p's noise
 * handshake enforce that identity, the same authentication the existing bootstrap
 * dial (`client.ts`'s `VITE_BOOTSTRAP_MULTIADDR` path) already relies on.
 */
export interface QrPairingPayload {
  v: 1;
  addrs: string[];
}

export function encodeQrPairingPayload(addrs: string[]): string {
  return JSON.stringify({ v: 1, addrs } satisfies QrPairingPayload);
}

/** Throws on anything that isn't a well-formed payload - a mis-scanned or foreign QR. */
export function decodeQrPairingPayload(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("not a Helix pairing code");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    !Array.isArray((parsed as { addrs?: unknown }).addrs) ||
    !(parsed as { addrs: unknown[] }).addrs.every((a) => typeof a === "string") ||
    (parsed as { addrs: string[] }).addrs.length === 0
  ) {
    throw new Error("not a Helix pairing code");
  }
  return (parsed as QrPairingPayload).addrs;
}
