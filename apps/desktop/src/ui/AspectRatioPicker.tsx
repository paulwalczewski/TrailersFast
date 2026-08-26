import { Label } from "@heroui/react";
import { ASPECT_RATIOS, type AspectRatio } from "@trailerfast/core";

const RATIO_ICON_MAX = 30;

/** Outline of a ratio, scaled so the longer side is always RATIO_ICON_MAX. */
function ratioIcon(w: number, h: number): { width: number; height: number } {
  return w >= h
    ? { width: RATIO_ICON_MAX, height: Math.round((RATIO_ICON_MAX * h) / w) }
    : { width: Math.round((RATIO_ICON_MAX * w) / h), height: RATIO_ICON_MAX };
}

/**
 * Ratio picker showing each option's actual shape — the trailer and the
 * thumbnail both output to a canvas, so both pick their ratio the same way.
 */
export function AspectRatioPicker({
  value,
  onChange,
}: {
  value: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Aspect ratio</Label>
      <div className="grid grid-cols-3 gap-2">
        {ASPECT_RATIOS.map((r) => {
          const active = value === r.id;
          const icon = ratioIcon(r.w, r.h);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onChange(r.id as AspectRatio)}
              title={r.label}
              className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-colors ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface-secondary text-muted hover:border-accent/50"
              }`}
            >
              <span className="grid h-8 place-items-center">
                <span
                  style={{ width: icon.width, height: icon.height }}
                  className="rounded-[3px] border-2 border-current"
                />
              </span>
              <span className={`text-xs font-medium ${active ? "text-accent" : "text-foreground"}`}>
                {r.id}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
