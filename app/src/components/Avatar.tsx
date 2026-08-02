import type { User } from "../types";

const SIZES = {
  sm: "size-8", // 32px - composer/reply rows
  md: "size-10", // 40px - post card
  lg: "size-12", // 48px - post detail
  xl: "size-[72px]", // profile header
} as const;

const TEXT_SIZES = {
  sm: "text-[11px]",
  md: "text-[13px]",
  lg: "text-[15px]",
  xl: "text-[22px]",
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Generated placeholder avatar (initials on a colored ring) rather than the stock
 * headshot photos referenced by the Figma design - avoids committing possibly-licensed
 * photography for what is mock/demo data, and matches the design's circular avatar
 * geometry closely enough for this pass.
 */
export function Avatar({ user, size = "md" }: { user: User; size?: keyof typeof SIZES }) {
  return (
    <div
      className={`${SIZES[size]} shrink-0 rounded-full bg-surface-alt border border-border flex items-center justify-center overflow-hidden font-sans`}
      style={{ boxShadow: `inset 0 0 0 1px ${user.avatarColor}33` }}
    >
      <span className={`${TEXT_SIZES[size]} font-bold`} style={{ color: user.avatarColor }}>
        {initials(user.displayName)}
      </span>
    </div>
  );
}
