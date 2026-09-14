import type { ReactNode } from "react";

/**
 * A timeline's empty state. Its height is exactly what the populated timeline
 * measures (`p-2` + `ScrubRuler` `h-5 mb-1` + `h-16` strip = 104px, plus the 1px
 * border top and bottom = 106px border-box) so nothing below it moves when the
 * first clip or frame lands.
 */
export function TimelinePlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-26.5 place-items-center rounded-xl border border-separator bg-surface text-sm text-muted">
      {children}
    </div>
  );
}
