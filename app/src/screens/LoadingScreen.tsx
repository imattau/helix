import { HelixIcon } from "../components/Logo";

/**
 * From the Figma "helix-loading-mobile"/"helix-loading-desktop" frames (fileKey
 * Tcmj0lEhCp4OVYATZ4ZHMk, nodes 28:31/28:6 - their names are swapped in the file:
 * 28:31 is the 390x844 phone layout, 28:6 the 1440x900 desktop one). Shown by
 * HelixProvider while connect()/register() are in flight, before the real app
 * mounts - so it deliberately uses its own boot-sequence palette (cyan accent,
 * near-black bg) rather than the app's --color-accent/--color-bg tokens, matching
 * the two Figma frames exactly rather than the in-app theme.
 */
export function LoadingScreen() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-between overflow-hidden bg-[#07080e] px-8 py-16 lg:px-8">
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 size-[340px] -translate-x-1/2 -translate-y-1/2 rounded-full lg:size-[720px]"
        style={{ background: "radial-gradient(circle, rgba(13,250,236,0.11) 0%, rgba(7,8,14,0) 100%)" }}
      />

      <div className="relative flex w-full flex-col items-center lg:flex-row lg:items-center lg:justify-between">
        <span className="rounded border border-[#0dfaec] bg-[#0dfaec]/[0.12] px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[2px] text-[#0dfaec] lg:px-3 lg:py-1.5 lg:text-[10px]">
          Secure Platform
        </span>
        <span className="hidden font-mono text-[11px] font-medium text-[#94a3b8] lg:block">SYS_REF: HLX-900 // AUTH_OK</span>
      </div>

      <div className="relative flex flex-col items-center gap-10 lg:gap-12">
        <div className="flex flex-col items-center gap-5 lg:gap-6">
          <div className="flex size-24 items-center justify-center rounded-[20px] border border-[#0dfaec]/[0.12] bg-[#090b12] lg:size-28 lg:rounded-3xl">
            <HelixIcon size={60} className="text-[#0dfaec] lg:hidden" />
            <HelixIcon size={72} className="hidden text-[#0dfaec] lg:block" />
          </div>
          <span className="font-logo text-[36px] font-extrabold tracking-[6px] text-white lg:text-[48px] lg:tracking-[8px]">
            HELIX
          </span>
        </div>

        <div className="flex w-[220px] flex-col gap-3 lg:w-[320px] lg:gap-4">
          <div className="flex items-center justify-between font-mono text-[10px] font-semibold lg:text-[11px]">
            <span className="tracking-[1px] text-[#0dfaec] lg:hidden">INITIALIZING...</span>
            <span className="hidden tracking-[1px] text-[#0dfaec] lg:inline">LOADING SYSTEM MODULES</span>
          </div>
          <div className="h-[2px] w-full overflow-hidden rounded-full bg-[#1e2235]">
            <div className="animate-helix-loading-sweep h-full w-1/4 rounded-full bg-[#0dfaec]" />
          </div>
        </div>
      </div>

      <div className="relative flex w-full flex-col items-center gap-1.5 font-mono text-[#94a3b8] lg:flex-row lg:items-center lg:justify-between lg:gap-0">
        <div className="flex flex-col items-center gap-1.5 lg:flex-row lg:gap-6">
          <span className="text-[10px] tracking-[0.5px] lg:text-[11px] lg:tracking-normal">
            <span className="lg:hidden">GENETIC SEQUENCING SYSTEM ACTIVE</span>
            <span className="hidden lg:inline">CORE GENOMETRIC PROCESSOR ACTIVE</span>
          </span>
          <span className="hidden size-1 rounded-full bg-[#0dfaec] lg:block" />
          <span className="hidden text-[11px] lg:inline">MEM: 128GB // CHNL_S-1</span>
        </div>
        <span className="text-[9px] opacity-60 lg:text-[11px] lg:opacity-100">
          <span className="lg:hidden">v1.0.4 // HLX-MOBILE-SYS</span>
          <span className="hidden lg:inline">SPECIFICATION v1.0.4</span>
        </span>
      </div>
    </div>
  );
}
