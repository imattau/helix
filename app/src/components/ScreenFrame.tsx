import type { ReactNode } from "react";

/**
 * Shared screen container matching the Figma frames' 402px mobile width and rounded
 * corners. Deliberately omits the fake iOS status bar ("9:41", signal/wifi/battery)
 * and home-indicator pill the Figma mockups include - those are device-frame
 * presentation chrome for the Figma mockup, not real UI a Tauri window would have.
 */
export function ScreenFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:mx-0 lg:max-w-[1088px] lg:px-10">
      {children}
    </div>
  );
}
