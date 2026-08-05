import { useEffect, useState } from "react";
import { ArrowLeft, ScanQrCode } from "lucide-react";
import { multiaddr } from "@multiformats/multiaddr";
import { getCustomBootstrapMultiaddr, setCustomBootstrapMultiaddr } from "../backend/identity";

/**
 * Lets a user point their bootstrap/relay dial at a server they control instead of
 * whatever VITE_BOOTSTRAP_MULTIADDR was baked in at build time (client.ts's
 * connect()) - see identity.ts's getCustomBootstrapMultiaddr() doc comment for why
 * this matters at all: a browser tab has no LAN-capable transport of its own (no raw
 * TCP, no mDNS), so it's only ever reachable through whichever relay it bootstraps
 * through, regardless of physical proximity to the peer it's trying to reach.
 */
export function BootstrapServerScreen({
  onBack,
  initialAddr,
}: {
  onBack: () => void;
  /** Pre-fills the field (never auto-saves) when this screen was opened from a
   *  helix://bootstrap deep link - see deepLink.ts's doc comment for why a deep link
   *  never saves on its own. */
  initialAddr?: string;
}) {
  const [value, setValue] = useState(() => initialAddr ?? getCustomBootstrapMultiaddr() ?? "");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [scanSupported, setScanSupported] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    // See QrPairingScreen.tsx's ScanCode for why this checks checkPermissions()
    // rather than just whether the dynamic import() resolves - the latter is true
    // even in a plain browser tab or Tauri desktop build, neither of which actually
    // has this plugin reachable.
    import("@tauri-apps/plugin-barcode-scanner")
      .then(({ checkPermissions }) => checkPermissions())
      .then(() => setScanSupported(true))
      .catch(() => setScanSupported(false));
  }, []);

  // Same reasoning as QrPairingScreen.tsx's ScanCode: windowed: true makes the native
  // *webview* transparent so the camera preview shows through from behind it - our
  // own opaque backgrounds have to get out of the way too, via index.css's
  // html.qr-scanning rule.
  useEffect(() => {
    if (!scanning) return;
    document.documentElement.classList.add("qr-scanning");
    return () => document.documentElement.classList.remove("qr-scanning");
  }, [scanning]);

  const validate = (candidate: string): boolean => {
    try {
      multiaddr(candidate); // throws on anything that isn't a well-formed multiaddr
      return true;
    } catch {
      return false;
    }
  };

  const save = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setCustomBootstrapMultiaddr(null);
      setError(undefined);
      setSaved(true);
      return;
    }
    if (!validate(trimmed)) {
      setError("That doesn't look like a valid multiaddr (e.g. /dns4/relay.example.com/tcp/443/wss/p2p/<peerId>).");
      setSaved(false);
      return;
    }
    setCustomBootstrapMultiaddr(trimmed);
    setError(undefined);
    setSaved(true);
  };

  const reset = () => {
    setCustomBootstrapMultiaddr(null);
    setValue("");
    setError(undefined);
    setSaved(true);
  };

  const startScan = async () => {
    setScanning(true);
    try {
      const { scan, Format, requestPermissions } = await import("@tauri-apps/plugin-barcode-scanner");
      const permission = await requestPermissions();
      if (permission !== "granted") {
        setError("Camera permission denied - enable it in system settings to scan.");
        setScanning(false);
        return;
      }
      const result = await scan({ formats: [Format.QRCode], windowed: true });
      const scanned = result.content.trim();
      if (!validate(scanned)) {
        setError("That QR code doesn't contain a valid multiaddr.");
        setScanning(false);
        return;
      }
      setValue(scanned);
      setError(undefined);
      setSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't scan that code.");
    } finally {
      setScanning(false);
    }
  };

  const cancelScan = async () => {
    const { cancel } = await import("@tauri-apps/plugin-barcode-scanner");
    await cancel().catch(() => {});
    setScanning(false);
  };

  if (scanning) {
    // No card/background here at all - the screen is transparent right now so the
    // native camera preview is what's actually visible; a bg-surface card would just
    // hide it again.
    return (
      <button
        type="button"
        onClick={cancelScan}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-ink/60 px-4 py-3 text-sm font-bold text-white backdrop-blur"
      >
        Cancel
      </button>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:mx-0 lg:max-w-[1088px] lg:px-10">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-12 pt-2 lg:px-0">
        <div className="flex w-full items-center gap-3 pt-2">
          <button type="button" onClick={onBack} className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-xl font-bold text-ink">Bootstrap Server</span>
        </div>

        <div className="flex w-full flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            placeholder="/dns4/relay.example.com/tcp/443/wss/p2p/<peerId>"
            className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-faint"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          {saved && !error && <p className="text-sm text-accent">Saved. Restart the app for this to take effect.</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white"
            >
              Save
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-ink"
            >
              Use default
            </button>
          </div>
          {scanSupported && (
            <button
              type="button"
              onClick={startScan}
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-ink"
            >
              <ScanQrCode size={16} />
              Scan a QR code
            </button>
          )}
        </div>
        <p className="px-1 text-xs leading-relaxed text-ink-faint">
          A browser tab can't open its own connections - it can only ever be reached through a relay it
          bootstraps through, even for someone on the same network. Point this at a relay you control (see the
          project README's NAT traversal section) for a known-good path instead of relying on the app's built-in
          default. Leave blank to use the default.
        </p>
      </div>
    </div>
  );
}
