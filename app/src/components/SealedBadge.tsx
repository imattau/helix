import { LockKeyhole } from "lucide-react";

export function SealedBadge({ size = "sm" }: { size?: "sm" | "lg" }) {
  const isLg = size === "lg";
  return (
    <div
      className={`flex items-center gap-1 rounded-lg bg-accent-soft ${isLg ? "px-2.5 py-1.5" : "px-2 py-1"}`}
    >
      <LockKeyhole size={isLg ? 14 : 12} className="text-accent shrink-0" />
      <span className={`font-bold uppercase text-accent ${isLg ? "text-[11px]" : "text-[10px]"}`}>
        {isLg ? "Sealed Block" : "Sealed"}
      </span>
    </div>
  );
}
