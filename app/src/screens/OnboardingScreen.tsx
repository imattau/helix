import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Logo } from "../components/Logo";
import { BackupKeyScreen } from "./BackupKeyScreen";

const MAX_LENGTH = 32;

/**
 * First-run only (see HelixProvider) - collects a display name, then requires
 * the user to acknowledge their private key backup (BackupKeyScreen) before
 * registering. The name is the single most irreversible protocol-level choice
 * (baked into the genome address, broadcast once in the immutable Genesis
 * record, no rename mechanism) - but losing the key entirely is worse, since
 * that's the whole identity, not just its display name, so backup is a hard
 * gate here rather than something to discover later in Settings.
 */
export function OnboardingScreen({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [step, setStep] = useState<"name" | "backup">("name");
  const [name, setName] = useState("");

  if (step === "backup") {
    return <BackupKeyScreen mode="onboarding" onDone={() => onSubmit(name.trim())} />;
  }

  const next = () => {
    if (!name.trim()) return;
    setStep("backup");
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-bg px-6 text-center">
      <Logo size="lg" />

      <div className="flex w-full max-w-[360px] flex-col gap-4">
        <div className="flex w-full items-start gap-2.5 rounded-2xl border border-warning/25 bg-danger-soft p-4 text-left">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed text-warning">
            Your display name is permanently written into your identity when you register. Helix has no accounts to
            edit later — choose carefully.
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
      </div>
    </div>
  );
}
