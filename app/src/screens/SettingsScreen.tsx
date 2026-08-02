import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  MoreHorizontal,
  Key,
  Pencil,
  Moon,
  Bell,
  Globe,
  UserMinus,
  EyeOff,
  CircleX,
  CircleHelp,
  FileText,
  ShieldAlert,
  Cog,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { Avatar } from "../components/Avatar";
import { currentUser } from "../data/mockData";

function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs font-bold uppercase text-ink-muted">{label}</p>
      <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface">
        {children}
      </div>
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  trailing,
  danger = false,
  last = false,
  onClick,
}: {
  icon: typeof Moon;
  label: string;
  trailing?: ReactNode;
  danger?: boolean;
  last?: boolean;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`flex w-full items-center justify-between px-4 py-3.5 text-left ${last ? "" : "border-b border-border"}`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex size-8 items-center justify-center rounded-lg ${danger ? "bg-danger-soft" : "bg-surface-alt"}`}>
          <Icon size={16} className={danger ? "text-danger" : "text-ink"} />
        </div>
        <span className={`text-[15px] font-medium ${danger ? "text-danger" : "text-ink"}`}>{label}</span>
      </div>
      {trailing}
    </Wrapper>
  );
}

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

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  // Only a dark theme is implemented in this pass - the toggle is cosmetic/local state,
  // not a real light-mode switch, matching this pass's scope.
  const [darkMode, setDarkMode] = useState(true);

  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 pb-12 pt-2">
        <div className="flex w-full items-center justify-between pt-2">
          <button type="button" onClick={onBack} className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-xl font-bold text-ink">Settings</span>
          <button type="button" className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="More">
            <MoreHorizontal size={20} className="text-ink" />
          </button>
        </div>

        <div className="flex w-full flex-col gap-4 rounded-[20px] border border-border bg-surface p-5">
          <div className="flex w-full items-center gap-4">
            <div className="rounded-[34px] border-2 border-accent p-0.5">
              <Avatar user={currentUser} size="xl" />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-bold text-ink">{currentUser.displayName}</span>
                <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent">LEDGER-OK</span>
              </div>
              <span className="text-sm text-ink-muted">{currentUser.handle}</span>
              <div className="flex items-center gap-1">
                <Key size={10} className="text-ink-muted" />
                <span className="w-[180px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-ink-muted">
                  hx_8f3c49e29a00b6fd
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-alt">
            <Pencil size={16} className="text-ink" />
            <span className="text-sm font-semibold text-ink">Edit Profile</span>
          </button>
        </div>

        <SettingsGroup label="Preferences">
          <SettingsRow icon={Moon} label="Dark Mode" trailing={<Toggle checked={darkMode} onChange={setDarkMode} />} />
          <SettingsRow
            icon={Bell}
            label="Notifications"
            trailing={
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-muted">Push & Email</span>
                <ChevronRight size={16} className="text-ink-muted" />
              </div>
            }
          />
          <SettingsRow
            icon={Globe}
            label="Language"
            last
            trailing={
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-muted">English (US)</span>
                <ChevronRight size={16} className="text-ink-muted" />
              </div>
            }
          />
        </SettingsGroup>

        <SettingsGroup label="Privacy & Safety">
          <SettingsRow
            icon={UserMinus}
            label="Blocked accounts"
            trailing={
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-muted">12 accounts</span>
                <ChevronRight size={16} className="text-ink-muted" />
              </div>
            }
          />
          <SettingsRow
            icon={EyeOff}
            label="Muted words"
            trailing={
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-muted">8 phrases</span>
                <ChevronRight size={16} className="text-ink-muted" />
              </div>
            }
          />
          <SettingsRow
            icon={CircleX}
            label="Who can reply"
            last
            trailing={
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-muted">Followers only</span>
                <ChevronRight size={16} className="text-ink-muted" />
              </div>
            }
          />
        </SettingsGroup>

        <SettingsGroup label="About">
          <SettingsRow icon={CircleHelp} label="About Helix" trailing={<ChevronRight size={16} className="text-ink-muted" />} />
          <SettingsRow icon={FileText} label="Terms of Service" trailing={<ChevronRight size={16} className="text-ink-muted" />} />
          <SettingsRow icon={ShieldAlert} label="Privacy Policy" trailing={<ChevronRight size={16} className="text-ink-muted" />} />
          <SettingsRow icon={Cog} label="App Version" last trailing={<span className="text-sm text-ink-muted">v2.1.0</span>} />
        </SettingsGroup>

        <div className="w-full overflow-hidden rounded-2xl border border-border bg-surface">
          <SettingsRow icon={LogOut} label="Log Out" danger last />
        </div>

        <div className="flex w-full flex-col items-center gap-1 pt-2 text-center text-[11px]">
          <span className="font-mono uppercase text-ink-muted">Helix Immutable Social Network</span>
          <span className="text-ink-faint">All updates are cryptographic commits. Edits create new blocks.</span>
        </div>
      </div>
    </ScreenFrame>
  );
}
