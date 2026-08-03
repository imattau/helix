import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { Avatar } from "../components/Avatar";
import { useHelixState } from "../backend/HelixProvider";

const MAX_LENGTH = 32;

/**
 * Edits the caller's own profile post via recombination (client.editProfile) -
 * unlike onboarding's one-shot name choice, this genuinely works after
 * registration now. The genome address itself never changes.
 */
export function EditProfileScreen({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const client = useHelixState();
  const currentUser = client.getSelfUser();
  const [name, setName] = useState(currentUser?.displayName ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    await client.editProfile(trimmed);
    onSaved();
  };

  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-5 pb-4 pt-3">
          <button type="button" onClick={onCancel} className="text-[15px] font-semibold text-ink-muted">
            Cancel
          </button>
          <span className="text-base font-bold text-ink">Edit Profile</span>
          <button
            type="button"
            onClick={save}
            disabled={!name.trim() || saving}
            className="rounded-[20px] bg-accent px-[18px] py-2 text-[13px] font-bold text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>

        <div className="flex w-full items-start gap-2.5 border-b border-warning/25 bg-danger-soft p-4">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed text-warning">
            This publishes a new version, visible immediately. Your original registration stays on the public
            ledger, unchanged and still provable — recombining doesn't erase it.
          </p>
        </div>

        <div className="flex w-full flex-col items-center gap-4 p-5">
          {currentUser && <Avatar user={currentUser} size="xl" />}
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, MAX_LENGTH))}
            placeholder="Display name"
            autoFocus
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-base text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>
    </ScreenFrame>
  );
}
