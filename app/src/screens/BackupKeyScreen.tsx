import { useEffect, useState } from "react";
import { ShieldAlert, Eye, Copy, Check, ArrowLeft } from "lucide-react";
import { exportPrivateKeyHex, getStoredDisplayName } from "../backend/identity";

/**
 * Reveals the raw Ed25519 private key backing the user's identity, so they can
 * copy it somewhere safe. There's no server-side account behind Helix - this hex
 * string (persisted only in this browser's localStorage - see identity.ts) is the
 * entire identity. Lose it and there's no recovery.
 *
 * Also surfaces the display name alongside it: registerUser() derives the genome
 * address from (publicKey, displayName), so the key *alone* isn't a complete
 * backup - restoring with the right key but the wrong name silently produces a
 * different identity (see identity.ts's restoreIdentity, OnboardingScreen's
 * restore flow). Both need to be saved together.
 *
 * Used two ways: once, gating onboarding (mode="onboarding", must confirm before
 * continuing - see OnboardingScreen), and any time after via Settings
 * (mode="settings", just a reveal/copy screen, no gate). In onboarding, the name
 * hasn't been persisted yet (that happens after this screen - see
 * HelixProvider.handleOnboardingSubmit), so the caller passes it in directly
 * rather than this screen reading it from storage.
 */
export function BackupKeyScreen({
  mode,
  displayName,
  onDone,
}: {
  mode: "onboarding" | "settings";
  displayName?: string;
  onDone: () => void;
}) {
  const [keyHex, setKeyHex] = useState<string>();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const name = displayName ?? getStoredDisplayName() ?? "";

  useEffect(() => {
    exportPrivateKeyHex().then(setKeyHex);
  }, []);

  const copy = async () => {
    if (!keyHex) return;
    await navigator.clipboard.writeText(keyHex);
    setRevealed(true);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full w-full flex-col items-center bg-bg px-6 py-8 text-ink">
      <div className="flex w-full max-w-[420px] flex-1 flex-col gap-5">
        {mode === "settings" && (
          <button type="button" onClick={onDone} className="flex items-center gap-2 self-start text-sm font-semibold text-ink-muted">
            <ArrowLeft size={16} />
            Back
          </button>
        )}

        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-bold text-ink">Back up your private key</h1>
          <p className="text-sm text-ink-muted">
            Helix has no accounts, no password reset, and no server that holds a copy of this. If you lose it, you
            lose access to this identity permanently.
          </p>
        </div>

        <div className="flex w-full items-start gap-2.5 rounded-2xl border border-warning/25 bg-danger-soft p-4 text-left">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed text-warning">
            Anyone with this key can post as you. Never share it, and store it somewhere only you control (a
            password manager or offline backup) - never in a chat message or unencrypted note. You'll also need your
            display name, below, to log back in with this key later - save the two together.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
          <span className="text-xs font-bold uppercase text-ink-muted">Private key</span>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-alt px-3 py-3">
            <span className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">
              {!keyHex ? "Loading…" : revealed ? keyHex : "•".repeat(64)}
            </span>
            {keyHex && !revealed && (
              <button type="button" onClick={() => setRevealed(true)} aria-label="Reveal key" className="shrink-0">
                <Eye size={18} className="text-ink-muted" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={copy}
            disabled={!keyHex}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-alt disabled:opacity-40"
          >
            {copied ? <Check size={16} className="text-accent" /> : <Copy size={16} className="text-ink" />}
            <span className="text-sm font-semibold text-ink">{copied ? "Copied" : "Copy to clipboard"}</span>
          </button>
        </div>

        <div className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
          <span className="text-xs font-bold uppercase text-ink-muted">Display name</span>
          <div className="flex items-center rounded-xl border border-border bg-surface-alt px-3 py-3">
            <span className="min-w-0 flex-1 break-all text-[15px] text-ink">{name || "—"}</span>
          </div>
          <p className="text-xs leading-relaxed text-ink-faint">
            Your identity address is derived from this exact name plus your key. The wrong name with the right key
            logs you into a different, new identity instead of this one.
          </p>
        </div>

        {mode === "onboarding" && (
          <label className="flex items-start gap-2.5 text-left">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-accent"
            />
            <span className="text-xs text-ink-muted">I've saved my private key and display name somewhere safe.</span>
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={onDone}
        disabled={mode === "onboarding" && !confirmed}
        className="w-full max-w-[420px] rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
      >
        {mode === "onboarding" ? "Continue" : "Done"}
      </button>
    </div>
  );
}
