import { useEffect, useRef, useState } from "react";
import { ArrowLeft, QrCode, ScanQrCode, Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { useHelixState } from "../backend/HelixProvider";
import { encodeQrPairingPayload, decodeQrPairingPayload } from "../backend/qrPairing";
import { isPublicDiscoveryEnabled } from "../backend/identity";

/** How often "Show" mode re-checks getOwnConnectAddrs() while waiting for a relay
 *  reservation - there's no event to subscribe to for it (see client.ts), so this
 *  polls, same as any other "wait for an async thing with no notify() hook" spot. */
const ADDR_POLL_MS = 2_000;

/** getOwnConnectAddrs() can return one circuit-relay address per observed local
 *  network interface (WiFi + hotspot + VPN, etc.) plus any raw /tcp/ ones - each
 *  multiaddr is long (a relay peer ID plus our own), and encodeQrPairingPayload's
 *  JSON wrapping adds more on top; a handful of them together can exceed a QR
 *  code's ~2.9KB max capacity ("The amount of data is too big to be stored in a QR
 *  Code"). dialPeerAddrs races every candidate and only needs one to succeed, so
 *  capping well below that ceiling costs nothing but headroom. */
const MAX_QR_ADDRS = 4;

/** How long ScanCode's "Connected - waiting for their profile" state waits before
 *  showing a hint that directory sync may have stalled - see the useEffect that uses
 *  this for why the wait itself has no hard upper bound. */
const STALLED_HINT_MS = 12_000;

/**
 * Direct peer pairing via QR code - skips the public DHT's discovery timing/luck
 * entirely by encoding a specific peer's dialable address(es) (see client.ts's
 * getOwnConnectAddrs/dialPeerAddrs and the plan for why this only works via a
 * circuit-relay address, never a same-room/offline LAN connection, for this
 * browser-mode node). "Scan" is mobile-only - the official Tauri barcode-scanner
 * plugin has no desktop support, so its availability is feature-detected rather
 * than assumed, and the tab is simply absent everywhere else (including a plain
 * browser preview with no Tauri runtime at all).
 */
export function QrPairingScreen({
  initialMode,
  onDone,
  onOpenAuthor,
}: {
  initialMode: "show" | "scan";
  onDone: () => void;
  onOpenAuthor: (userId: string) => void;
}) {
  const client = useHelixState();
  const [scanSupported, setScanSupported] = useState(false);
  const [mode, setMode] = useState<"show" | "scan">(initialMode);

  useEffect(() => {
    // A dynamic import() always resolves once bundled - it says nothing about
    // whether the *native* plugin is actually reachable (a plain browser tab has no
    // Tauri IPC bridge at all, and Tauri desktop builds never register this plugin
    // in the first place - see src-tauri/src/lib.rs's #[cfg(mobile)] gate). Calling
    // checkPermissions() (side-effect-free - it only reads current state, never
    // prompts) is what actually distinguishes "mobile Tauri, plugin registered" from
    // both of those: it throws on both, confirmed by testing this exact screen in a
    // plain browser tab, where the old import()-only check incorrectly left the
    // Scan tab visible.
    import("@tauri-apps/plugin-barcode-scanner")
      .then(({ checkPermissions }) => checkPermissions())
      .then(() => setScanSupported(true))
      .catch(() => setScanSupported(false));
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center bg-bg px-6 py-8 text-ink">
      <div className="flex w-full max-w-[420px] flex-1 flex-col gap-5">
        <div className="flex items-center justify-between">
          <button type="button" onClick={onDone} className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
            <ArrowLeft size={16} />
            Back
          </button>
          {scanSupported && (
            <div className="flex rounded-full border border-border p-0.5">
              <button
                type="button"
                onClick={() => setMode("show")}
                className={`rounded-full px-3 py-1 text-xs font-bold ${mode === "show" ? "bg-accent text-white" : "text-ink-muted"}`}
              >
                My code
              </button>
              <button
                type="button"
                onClick={() => setMode("scan")}
                className={`rounded-full px-3 py-1 text-xs font-bold ${mode === "scan" ? "bg-accent text-white" : "text-ink-muted"}`}
              >
                Scan
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-bold text-ink">{mode === "show" ? "Your connect code" : "Scan a code"}</h1>
          <p className="text-sm text-ink-muted">
            {mode === "show"
              ? "Anyone who scans this connects to you directly, without waiting to be found on the network."
              : "Point the camera at someone else's connect code to add them directly."}
          </p>
        </div>

        {mode === "show" ? <ShowCode client={client} /> : <ScanCode client={client} onOpenAuthor={onOpenAuthor} />}
      </div>
    </div>
  );
}

function ShowCode({ client }: { client: ReturnType<typeof useHelixState> }) {
  const [addrs, setAddrs] = useState<string[]>(() => client.getOwnConnectAddrs());
  const [qrDataUrl, setQrDataUrl] = useState<string>();
  const [qrError, setQrError] = useState<string>();

  useEffect(() => {
    if (addrs.length > 0) return;
    const interval = setInterval(() => setAddrs(client.getOwnConnectAddrs()), ADDR_POLL_MS);
    return () => clearInterval(interval);
  }, [client, addrs.length]);

  useEffect(() => {
    if (addrs.length === 0) {
      setQrDataUrl(undefined);
      return;
    }
    setQrError(undefined);
    // errorCorrectionLevel "L" (not the library's default "M") maximizes raw
    // capacity - see MAX_QR_ADDRS's doc comment for why every byte here matters.
    QRCode.toDataURL(encodeQrPairingPayload(addrs.slice(0, MAX_QR_ADDRS)), {
      width: 280,
      margin: 1,
      errorCorrectionLevel: "L",
    })
      .then(setQrDataUrl)
      .catch(() => setQrError("Couldn't generate a code - too many addresses to encode."));
  }, [addrs]);

  if (!isPublicDiscoveryEnabled()) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        Enable public discovery in Settings to get a connectable code.
      </p>
    );
  }

  if (qrError) {
    return <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-danger">{qrError}</p>;
  }

  if (!qrDataUrl) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8">
        <Loader2 size={28} className="animate-spin text-ink-muted" />
        <p className="text-center text-sm text-ink-muted">Waiting for a connectable address…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6">
      <img src={qrDataUrl} alt="Your Helix connect code" width={280} height={280} className="rounded-lg" />
      <QrCode size={16} className="text-ink-muted" />
    </div>
  );
}

type ScanState =
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: "connecting" }
  | { phase: "connected"; peerId: string }
  | { phase: "error"; message: string };

function ScanCode({
  client,
  onOpenAuthor,
}: {
  client: ReturnType<typeof useHelixState>;
  onOpenAuthor: (userId: string) => void;
}) {
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const opened = useRef(false);
  const [stalled, setStalled] = useState(false);

  // Once connected, keep re-checking for the resolved profile on every re-render this
  // component gets (any HelixClient notify() bumps useHelixState's version) - covers
  // directory sync resolving after dialPeerAddrs()'s own 8s wait already gave up.
  useEffect(() => {
    if (state.phase !== "connected" || opened.current) return;
    const user = client.getUserByPeerId(state.peerId);
    if (user) {
      opened.current = true;
      onOpenAuthor(user.id);
    }
  }, [state, client, onOpenAuthor]);

  // The wait above has no upper bound of its own - directory sync (client.ts's
  // requestDirectoryFrom, fired on peer:connect) is best-effort and can fail
  // silently (a relay resource limit, a slow/never-completing stream, the other
  // device going offline mid-sync). Without this, a stall here looks identical to
  // "still working" forever, with nothing for the user to act on - flip to a visible
  // hint (not an error - the connection itself is still fine and might yet resolve)
  // after a generous wait, and offer a manual way out instead of a silent hang.
  useEffect(() => {
    setStalled(false);
    if (state.phase !== "connected") return;
    const timer = setTimeout(() => setStalled(true), STALLED_HINT_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // windowed: true makes the native *webview* transparent so the camera preview
  // shows through from behind it - our own opaque backgrounds (body, this screen's
  // bg-bg wrapper, this card's bg-surface) still have to get out of the way for that
  // to actually be visible - see index.css's html.qr-scanning rule.
  useEffect(() => {
    if (state.phase !== "scanning") return;
    document.documentElement.classList.add("qr-scanning");
    return () => document.documentElement.classList.remove("qr-scanning");
  }, [state.phase]);

  const startScan = async () => {
    setState({ phase: "scanning" });
    try {
      const { scan, Format, requestPermissions } = await import("@tauri-apps/plugin-barcode-scanner");
      // The plugin never requests this itself - scan() just throws if it's missing.
      // Android 6+ (and iOS) require this explicit runtime request even though the
      // CAMERA permission is already declared in the manifest. requestPermissions()
      // is a no-op prompt-wise if already granted/denied, so it's safe to call
      // unconditionally rather than checkPermissions()-then-request.
      const permission = await requestPermissions();
      if (permission !== "granted") {
        setState({ phase: "error", message: "Camera permission denied - enable it in system settings to scan." });
        return;
      }
      const result = await scan({ formats: [Format.QRCode], windowed: true });
      const addrs = decodeQrPairingPayload(result.content);
      setState({ phase: "connecting" });
      const { peerId, genome } = await client.dialPeerAddrs(addrs);
      if (genome) {
        onOpenAuthor(genome);
      } else {
        setState({ phase: "connected", peerId });
      }
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : "Couldn't connect" });
    }
  };

  const cancelScan = async () => {
    const { cancel } = await import("@tauri-apps/plugin-barcode-scanner");
    await cancel().catch(() => {});
    setState({ phase: "idle" });
  };

  if (state.phase === "scanning") {
    // No card/background here at all - see the useEffect above, this screen (and
    // body/#root) are transparent right now so the native camera preview is what's
    // actually visible; a bg-surface card would just hide it again.
    return (
      <button
        type="button"
        onClick={cancelScan}
        className="rounded-xl bg-ink/60 px-4 py-3 text-sm font-bold text-white backdrop-blur"
      >
        Cancel
      </button>
    );
  }

  if (state.phase === "connecting" || state.phase === "connected") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8">
        <Loader2 size={28} className="animate-spin text-ink-muted" />
        <p className="text-center text-sm text-ink-muted">
          {state.phase === "connecting" ? "Connecting…" : "Connected - waiting for their profile…"}
        </p>
        {state.phase === "connected" && stalled && (
          <>
            <p className="text-center text-sm text-ink-muted">
              This is taking longer than usual - they may be offline or hard to reach right now.
            </p>
            <button
              type="button"
              onClick={() => setState({ phase: "idle" })}
              className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-ink"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8">
      {state.phase === "error" && <p className="text-center text-sm text-danger">{state.message}</p>}
      <button
        type="button"
        onClick={startScan}
        className="flex items-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white"
      >
        <ScanQrCode size={18} />
        Start scanning
      </button>
    </div>
  );
}
