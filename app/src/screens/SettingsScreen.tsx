import { useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  MoreHorizontal,
  Key,
  Pencil,
  Moon,
  Bell,
  Globe,
  Radar,
  UserMinus,
  CircleX,
  CircleHelp,
  Cog,
  LogOut,
  ChevronRight,
  User as UserIcon,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Avatar } from "../components/Avatar";
import { HelixIcon } from "../components/Logo";
import { useHelixState } from "../backend/HelixProvider";
import { useCollapsed } from "../hooks/useCollapsed";
import { isPublicDiscoveryEnabled, setPublicDiscoveryEnabled, clearIdentity } from "../backend/identity";
import { REPLY_AUDIENCE_LABEL, getReplyAudience } from "../backend/replyAudience";
import { getLanguageLabel, getLanguageCode } from "../backend/languagePrefs";
import { type Theme } from "../hooks/useTheme";
import { APP_VERSION } from "../version";

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

const SIDEBAR_ITEMS = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "security", label: "Security", icon: Key },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "privacy", label: "Privacy & Safety", icon: CircleX },
  { id: "about", label: "About Helix", icon: CircleHelp },
] as const;

export function SettingsScreen({
  onBack,
  onEditProfile,
  onBackupKey,
  theme,
  onThemeChange,
  onOpenBlockedAccounts,
  onOpenWhoCanReply,
  onOpenNotificationSettings,
  onOpenLanguage,
  onOpenAbout,
}: {
  onBack: () => void;
  onEditProfile: () => void;
  onBackupKey: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onOpenBlockedAccounts: () => void;
  onOpenWhoCanReply: () => void;
  onOpenNotificationSettings: () => void;
  onOpenLanguage: () => void;
  onOpenAbout: () => void;
}) {
  const [publicDiscovery, setPublicDiscoveryState] = useState(isPublicDiscoveryEnabled());
  const replyAudience = getReplyAudience();
  const languageLabel = getLanguageLabel(getLanguageCode());
  const [confirmingLogOut, setConfirmingLogOut] = useState(false);
  // There's no server session and no way to sign back in without a saved private key
  // (see identity.ts's clearIdentity) - reloading after clearing sends the user straight
  // back to onboarding, same as a first run.
  const logOut = () => {
    clearIdentity();
    window.location.reload();
  };
  // The libp2p node's service set (whether the DHT service is registered at all) is
  // fixed at construction - there's no way to hot-swap it into a running node, so
  // this takes effect on next connect() rather than live. Reloading is the simplest
  // way to guarantee that without a stale half-applied state.
  const togglePublicDiscovery = (enabled: boolean) => {
    setPublicDiscoveryEnabled(enabled);
    setPublicDiscoveryState(enabled);
    window.location.reload();
  };
  const client = useHelixState();
  const blockedCount = client.getBlockedGenomes().length;
  const currentUser = client.getSelfUser();
  const genomeAddress = client.selfGenomeAddress ?? "";
  const [sidebarCollapsed, setSidebarCollapsed] = useCollapsed("helix.pane.settingsSidebar");

  const sectionRefs = {
    profile: useRef<HTMLDivElement>(null),
    security: useRef<HTMLDivElement>(null),
    preferences: useRef<HTMLDivElement>(null),
    privacy: useRef<HTMLDivElement>(null),
    about: useRef<HTMLDivElement>(null),
  };
  const scrollToSection = (id: keyof typeof sectionRefs) => {
    sectionRefs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!currentUser) return null;

  const profileCard = (
    <div ref={sectionRefs.profile} className="flex w-full flex-col gap-4 rounded-[20px] border border-border bg-surface p-5">
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
              {genomeAddress}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onEditProfile}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-alt"
      >
        <Pencil size={16} className="text-ink" />
        <span className="text-sm font-semibold text-ink">Edit Profile</span>
      </button>
    </div>
  );

  const securityGroup = (
    <div ref={sectionRefs.security}>
      <SettingsGroup label="Security">
        <SettingsRow
          icon={Key}
          label="Backup Private Key"
          last
          onClick={onBackupKey}
          trailing={<ChevronRight size={16} className="text-ink-muted" />}
        />
      </SettingsGroup>
    </div>
  );

  const preferencesGroup = (
    <div ref={sectionRefs.preferences}>
      <SettingsGroup label="Preferences">
        <SettingsRow
          icon={Moon}
          label="Dark Mode"
          trailing={<Toggle checked={theme === "dark"} onChange={(v) => onThemeChange(v ? "dark" : "light")} />}
        />
        <SettingsRow
          icon={Bell}
          label="Notifications"
          onClick={onOpenNotificationSettings}
          trailing={
            <div className="flex items-center gap-2">
              <ChevronRight size={16} className="text-ink-muted" />
            </div>
          }
        />
        <SettingsRow
          icon={Globe}
          label="Language"
          last
          onClick={onOpenLanguage}
          trailing={
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-muted">{languageLabel}</span>
              <ChevronRight size={16} className="text-ink-muted" />
            </div>
          }
        />
      </SettingsGroup>
    </div>
  );

  const privacyGroup = (
    <div ref={sectionRefs.privacy} className="flex flex-col gap-2">
      <SettingsGroup label="Privacy & Safety">
        <SettingsRow
          icon={Radar}
          label="Public Peer Discovery"
          trailing={<Toggle checked={publicDiscovery} onChange={togglePublicDiscovery} />}
        />
        <SettingsRow
          icon={UserMinus}
          label="Blocked accounts"
          onClick={onOpenBlockedAccounts}
          trailing={
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-muted">{blockedCount === 1 ? "1 account" : `${blockedCount} accounts`}</span>
              <ChevronRight size={16} className="text-ink-muted" />
            </div>
          }
        />
        <SettingsRow
          icon={CircleX}
          label="Who can reply"
          last
          onClick={onOpenWhoCanReply}
          trailing={
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-muted">{REPLY_AUDIENCE_LABEL[replyAudience]}</span>
              <ChevronRight size={16} className="text-ink-muted" />
            </div>
          }
        />
      </SettingsGroup>
      <p className="px-1 text-xs leading-relaxed text-ink-faint">
        Public Peer Discovery announces this device on the public IPFS/libp2p network so it can find other Helix
        peers without a hardcoded relay. Turning it off keeps you reachable only through Helix's own bootstrap
        peer. Changing this reloads the app.
      </p>
    </div>
  );

  const aboutGroup = (
    <div ref={sectionRefs.about}>
      <SettingsGroup label="About">
        <SettingsRow icon={CircleHelp} label="About Helix" onClick={onOpenAbout} trailing={<ChevronRight size={16} className="text-ink-muted" />} />
        <SettingsRow icon={Cog} label="App Version" last trailing={<span className="text-sm text-ink-muted">v{APP_VERSION}</span>} />
      </SettingsGroup>
    </div>
  );

  const footer = (
    <div className="flex w-full flex-col items-center gap-1 pt-2 text-center text-[11px]">
      <span className="font-mono uppercase text-ink-muted">Helix Immutable Social Network</span>
      <span className="text-ink-faint">All updates are cryptographic commits. Edits create new blocks.</span>
    </div>
  );

  return (
    <>
      {/* Mobile: single column, stack-pushed screen with its own back/more header. */}
      <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:hidden">
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
          {profileCard}
          {securityGroup}
          {preferencesGroup}
          {privacyGroup}
          {aboutGroup}
          <div className="w-full overflow-hidden rounded-2xl border border-border bg-surface">
            <SettingsRow icon={LogOut} label="Log Out" danger last onClick={() => setConfirmingLogOut(true)} />
          </div>
          {footer}
        </div>
      </div>

      {/* Desktop: topbar + collapsible settings-sidebar + content panel - helix-desktop-settings (5:4). */}
      <div className="hidden h-full w-full lg:flex lg:flex-col">
        <div className="flex h-[72px] w-full shrink-0 items-center justify-between border-b border-border px-10">
          <div className="flex items-center gap-2">
            <HelixIcon size={32} />
            <span className="font-logo text-lg font-extrabold text-ink">HELIX</span>
          </div>
          <button type="button" onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
            <ArrowLeft size={16} />
            Back to feed
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          {sidebarCollapsed ? (
            <div className="flex w-[72px] shrink-0 flex-col items-center gap-3 border-r border-border bg-surface py-6">
              <button type="button" onClick={() => setSidebarCollapsed(false)} aria-label="Expand settings menu" className="mb-1">
                <PanelLeftOpen size={18} className="text-ink-muted" />
              </button>
              {SIDEBAR_ITEMS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => scrollToSection(id)}
                  aria-label={id}
                  className="flex size-10 items-center justify-center rounded-xl"
                >
                  <Icon size={20} className="text-ink-muted" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex w-[280px] shrink-0 flex-col justify-between border-r border-border bg-surface py-6">
              <div className="flex flex-col gap-1 px-3">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="text-xs font-bold uppercase text-ink-muted">Settings</span>
                  <button type="button" onClick={() => setSidebarCollapsed(true)} aria-label="Collapse settings menu">
                    <PanelLeftClose size={16} className="text-ink-muted" />
                  </button>
                </div>
                {SIDEBAR_ITEMS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => scrollToSection(id)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-surface-alt"
                  >
                    <Icon size={18} className="text-ink-muted" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="px-3">
                <button
                  type="button"
                  onClick={() => setConfirmingLogOut(true)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-danger"
                >
                  <LogOut size={18} />
                  Log Out
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-10 py-8">
            <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
              {profileCard}
              {securityGroup}
              {preferencesGroup}
              {privacyGroup}
              {aboutGroup}
              {footer}
            </div>
          </div>
        </div>
      </div>

      {confirmingLogOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="flex w-full max-w-[360px] flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-base font-bold text-ink">Log out?</h2>
            <p className="text-sm leading-relaxed text-ink-muted">
              Helix has no server accounts to sign back into. This forgets your private key on this device - unless
              you've backed it up (see Backup Private Key), you'll lose access to {currentUser.displayName}{" "}
              permanently and start over as a new identity.
            </p>
            <div className="flex w-full gap-3">
              <button
                type="button"
                onClick={() => setConfirmingLogOut(false)}
                className="flex-1 rounded-xl border border-border bg-surface-alt px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={logOut}
                className="flex-1 rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-white"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
