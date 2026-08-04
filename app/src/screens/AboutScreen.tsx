import { ArrowLeft } from "lucide-react";
import { HelixIcon } from "../components/Logo";
import { APP_VERSION } from "../version";

export function AboutScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:mx-0 lg:max-w-[1088px] lg:px-10">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-12 pt-2 lg:px-0">
        <div className="flex w-full items-center gap-3 pt-2">
          <button type="button" onClick={onBack} className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-xl font-bold text-ink">About Helix</span>
        </div>

        <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center">
          <HelixIcon size={48} />
          <span className="font-logo text-lg font-extrabold text-ink">HELIX</span>
          <span className="font-mono text-xs text-ink-muted">v{APP_VERSION}</span>
        </div>

        <div className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm leading-relaxed text-ink-muted">
            Helix is an immutable, peer-to-peer social network. Every post is a cryptographic commit on a
            content-addressed ledger — edits create new blocks rather than overwriting history, and there's no
            central server holding your identity or your data.
          </p>
          <p className="text-sm leading-relaxed text-ink-muted">
            Your identity is a private key stored only on your own devices (see Backup Private Key in Settings).
            Posts and profile data propagate directly between peers over libp2p.
          </p>
        </div>

        <p className="px-1 text-center text-xs text-ink-faint">Helix Immutable Social Network</p>
      </div>
    </div>
  );
}
