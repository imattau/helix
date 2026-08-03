import { Home, Search, BellRing, User as UserIcon, Cog } from "lucide-react";
import type { ComponentType } from "react";
import { HelixIcon } from "./Logo";
import { Avatar } from "./Avatar";
import type { NavTab } from "./BottomNav";
import type { User } from "../types";

const TABS: { id: NavTab; icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "home", icon: Home },
  { id: "search", icon: Search },
  { id: "notifications", icon: BellRing },
  { id: "profile", icon: UserIcon },
];

/**
 * Desktop-only (lg:) vertical replacement for BottomNav - see the
 * `nav-rail` frames shared across every desktop screen except settings
 * (Figma fileKey Tcmj0lEhCp4OVYATZ4ZHMk, node 5:203 and siblings).
 */
export function NavRail({
  active,
  onSelect,
  onHome,
  onSettings,
  selfUser,
}: {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
  onHome: () => void;
  onSettings: () => void;
  selfUser?: User;
}) {
  return (
    <div className="hidden w-[72px] shrink-0 flex-col items-center justify-between border-r border-border bg-surface py-6 lg:flex">
      <div className="flex w-full flex-col items-center gap-8">
        <button
          type="button"
          onClick={onHome}
          aria-label="Home"
          className="flex size-10 items-center justify-center rounded-xl bg-accent shadow-[0_4px_6px_rgba(94,80,249,0.25)]"
        >
          <HelixIcon size={24} />
        </button>
        <div className="flex w-full flex-col items-center gap-5">
          {TABS.map(({ id, icon: Icon }) => {
            const isActive = id === active;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                aria-label={id}
                aria-current={isActive}
                className={`flex size-12 items-center justify-center rounded-xl border ${
                  isActive ? "border-accent bg-accent-soft" : "border-transparent"
                }`}
              >
                <Icon size={24} className={isActive ? "text-accent" : "text-ink-muted"} />
              </button>
            );
          })}
          <button
            type="button"
            onClick={onSettings}
            aria-label="settings"
            className="flex size-12 items-center justify-center rounded-xl border border-transparent"
          >
            <Cog size={24} className="text-ink-muted" />
          </button>
        </div>
      </div>
      {selfUser && (
        <button type="button" onClick={() => onSelect("profile")} aria-label="Your profile">
          <Avatar user={selfUser} size="md" />
        </button>
      )}
    </div>
  );
}
