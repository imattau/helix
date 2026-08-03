/**
 * From the Figma brand identity system (fileKey Tcmj0lEhCp4OVYATZ4ZHMk, node 14:2)
 * "helix-logo-system" page - reproduces the "Primary Logo" (01) and "Horizontal
 * Lockup" (03) specs: icon container/inner-glyph size, gap, wordmark size/tracking
 * are all taken directly from that node's measurements, not approximated.
 */
export function HelixIcon({ size, className = "text-ink" }: { size: number; className?: string }) {
  // Inner glyph is inset ~5% of the container on every side in both specced sizes
  // (58/64 primary, 29/32 compact) - preserved as a proportional inset here.
  const inset = size * 0.047;
  return (
    <svg
      viewBox="0 0 58 58"
      width={size - inset * 2}
      height={size - inset * 2}
      style={{ margin: inset }}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M24.1663 38.6677L27.7916 42.293M33.8337 19.3327L30.2084 15.7074M36.2515 4.8314C31.9059 9.66033 30.1658 14.4868 29.4673 19.3158M39.8759 25.3749L42.2927 27.7918M41.0852 14.4998L34.0981 7.51263M4.8314 36.2508C20.9446 21.7496 37.0554 36.2508 53.1686 21.7496M48.3349 21.7496L50.4883 23.903M7.5126 34.0983L9.66603 36.2517M15.7073 30.2086L18.1241 32.6255M16.9157 43.5015L23.9028 50.4887M21.7494 53.1686C26.0949 48.3397 27.8351 43.5132 28.5335 38.6842"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

const SIZES = {
  sm: { icon: 32, gap: "gap-[10px]", text: "text-[22px] tracking-[2px]" },
  lg: { icon: 64, gap: "gap-4", text: "text-[44px] tracking-[3px]" },
} as const;

export function Logo({ size = "sm" }: { size?: keyof typeof SIZES }) {
  const s = SIZES[size];
  return (
    <div className={`flex items-center ${s.gap}`}>
      <HelixIcon size={s.icon} />
      <span className={`font-logo font-extrabold text-ink ${s.text}`}>HELIX</span>
    </div>
  );
}
