import { cn } from "@/lib/utils";

/**
 * The signature "Emerald Aurora" lighting layer: three softly drifting, blurred
 * colour fields plus a faint grid, pinned behind the page content. Rendered
 * once per layout so every screen shares the same ambient light.
 */
export function AuroraBackdrop({ className, grid = true }: { className?: string; grid?: boolean }) {
  return (
    <div className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)} aria-hidden="true">
      {grid ? (
        <div className="absolute inset-0 canvas-grid opacity-[0.35] dark:opacity-25" />
      ) : null}

      <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-aurora-emerald/25 blur-[120px] animate-aurora-drift dark:bg-aurora-emerald/30" />
      <div className="absolute -right-32 top-1/4 h-[30rem] w-[30rem] rounded-full bg-aurora-cyan/20 blur-[120px] animate-aurora-drift-slow dark:bg-aurora-cyan/25" />
      <div className="absolute bottom-[-12rem] left-1/3 h-[30rem] w-[30rem] rounded-full bg-aurora-teal/20 blur-[130px] animate-aurora-drift dark:bg-aurora-teal/25" />
    </div>
  );
}
