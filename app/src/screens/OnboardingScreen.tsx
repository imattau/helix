import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Logo } from "../components/Logo";
import { BackupKeyScreen } from "./BackupKeyScreen";
import { restoreIdentity } from "../backend/identity";

const MAX_LENGTH = 32;

/**
 * First-run only (see HelixProvider) - collects a display name, then requires
 * the user to acknowledge their private key backup (BackupKeyScreen) before
 * registering. This name is baked into the genome address via the immutable
 * Genesis record and can never change - but the *displayed* name can, via a
 * later profile post/recombination (see EditProfileScreen, client.editProfile);
 * getUser() prefers that over Genesis's name once one exists. Losing the key
 * entirely is worse than either, since that's the whole identity, so backup is
 * a hard gate here rather than something to discover later in Settings.
 *
 * Also offers "restore" for a device that already holds a backed-up private
 * key (e.g. after Log Out, or a fresh install) - see identity.ts's
 * restoreIdentity(). That path reloads the page instead of calling onSubmit,
 * since HelixProvider's client has already connected with whatever identity
 * was in localStorage at mount time; only a fresh mount picks up the restored
 * key.
 */
export function OnboardingScreen({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [step, setStep] = useState<"name" | "backup">("name");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"create" | "restore">("create");
  const [restoreKey, setRestoreKey] = useState("");
  const [restoreName, setRestoreName] = useState("");
  const [restoreError, setRestoreError] = useState<string>();
  const [restoring, setRestoring] = useState(false);

  if (step === "backup") {
    return <BackupKeyScreen mode="onboarding" displayName={name.trim()} onDone={() => onSubmit(name.trim())} />;
  }

  const next = () => {
    if (!name.trim()) return;
    setStep("backup");
  };

  const handleRestore = async () => {
    if (!restoreKey.trim() || !restoreName.trim() || restoring) return;
    setRestoring(true);
    setRestoreError(undefined);
    try {
      await restoreIdentity(restoreKey, restoreName);
      window.location.reload();
    } catch {
      setRestoreError("That doesn't look like a valid private key.");
      setRestoring(false);
    }
  };

  if (mode === "restore") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-bg px-6 text-center">
        <Logo size="lg" />

        <div className="flex w-full max-w-[360px] flex-col gap-4">
          <div className="flex w-full items-start gap-2.5 rounded-2xl border border-warning/25 bg-danger-soft p-4 text-left">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
            <p className="flex-1 text-xs leading-relaxed text-warning">
              You need both the exact private key and the exact display name you originally registered with - the
              two together are what deterministically reproduce your identity address.
            </p>
          </div>

          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleRestore();
            }}
          >
            <textarea
              value={restoreKey}
              onChange={(e) => setRestoreKey(e.target.value)}
              placeholder="Paste your private key"
              autoFocus
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-surface px-4 py-3 text-center font-mono text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              value={restoreName}
              onChange={(e) => setRestoreName(e.target.value.slice(0, MAX_LENGTH))}
              placeholder="Your original display name"
              className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-base text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {restoreError && <p className="text-xs text-danger">{restoreError}</p>}
            <button
              type="submit"
              disabled={!restoreKey.trim() || !restoreName.trim() || restoring}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {restoring ? "Restoring…" : "Log In"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode("create");
              setRestoreError(undefined);
            }}
            className="text-xs font-semibold text-ink-muted"
          >
            Create a new identity instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-bg px-6 text-center">
      <Logo size="lg" />

      <div className="flex w-full max-w-[360px] flex-col gap-4">
        <div className="flex w-full items-start gap-2.5 rounded-2xl border border-warning/25 bg-danger-soft p-4 text-left">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed text-warning">
            This exact name is permanently written into your identity address when you register, alongside your
            private key - you'll need both together to log back in on another device or after logging out. You can
            still change your displayed name later from Edit Profile in Settings, but that doesn't change this
            original one. Back up your key (and this name) next.
          </p>
        </div>

        <form
          className="flex w-full flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, MAX_LENGTH))}
            placeholder="Choose a display name"
            autoFocus
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-base text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            Continue
          </button>
        </form>

        <button type="button" onClick={() => setMode("restore")} className="text-xs font-semibold text-ink-muted">
          Already have a private key? Log in instead
        </button>
      </div>
    </div>
  );
}
