import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { getNotificationPrefs, setNotificationPrefs, type NotificationPrefs } from "../backend/notificationPrefs";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-accent" : "bg-surface-alt"}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

const ROWS: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  { key: "push", label: "Push notifications", description: "Alerts on this device for activity on your posts." },
  { key: "email", label: "Email notifications", description: "A digest of activity sent to your email." },
  { key: "mentions", label: "Mentions", description: "Notify when someone mentions you." },
  { key: "replies", label: "Replies", description: "Notify when someone replies to your posts." },
  { key: "boosts", label: "Boosts", description: "Notify when someone boosts your posts." },
];

/** Local toggles only - not yet wired to a real push/email delivery pipeline, matching this pass's scope. */
export function NotificationSettingsScreen({ onBack }: { onBack: () => void }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(getNotificationPrefs());

  const update = (key: keyof NotificationPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setNotificationPrefs(next);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:mx-0 lg:max-w-[1088px] lg:px-10">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-12 pt-2 lg:px-0">
        <div className="flex w-full items-center gap-3 pt-2">
          <button type="button" onClick={onBack} className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-xl font-bold text-ink">Notifications</span>
        </div>

        <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface">
          {ROWS.map(({ key, label, description }, i) => (
            <div
              key={key}
              className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i === ROWS.length - 1 ? "" : "border-b border-border"}`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-medium text-ink">{label}</span>
                <span className="text-xs text-ink-muted">{description}</span>
              </div>
              <Toggle checked={prefs[key]} onChange={(v) => update(key, v)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
