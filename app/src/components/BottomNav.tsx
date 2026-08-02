import { Home, Search, BellRing, User } from "lucide-react";
import type { ComponentType } from "react";

export type NavTab = "home" | "search" | "notifications" | "profile";

const TABS: { id: NavTab; icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "home", icon: Home },
  { id: "search", icon: Search },
  { id: "notifications", icon: BellRing },
  { id: "profile", icon: User },
];

export function BottomNav({ active, onSelect }: { active: NavTab; onSelect: (tab: NavTab) => void }) {
  return (
    <div className="w-full border-t border-border bg-bg">
      <div className="flex h-[60px] items-center justify-between px-6">
        {TABS.map(({ id, icon: Icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className="relative flex flex-col items-center justify-center rounded-xl p-2"
              aria-label={id}
              aria-current={isActive}
            >
              <Icon size={24} className={isActive ? "text-ink" : "text-ink-muted"} />
              {isActive && (
                <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
