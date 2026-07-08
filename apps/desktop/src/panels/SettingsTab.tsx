import { Label } from "@heroui/react";
import { ASPECT_RATIOS, type AspectRatio, FIT_MODES, type FitMode } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { LabeledSlider, LabeledSwitch } from "../ui/Fields";

const RATIO_ICON_MAX = 30;

function ratioIcon(w: number, h: number): { width: number; height: number } {
  return w >= h
    ? { width: RATIO_ICON_MAX, height: Math.round((RATIO_ICON_MAX * h) / w) }
    : { width: Math.round((RATIO_ICON_MAX * w) / h), height: RATIO_ICON_MAX };
}

/** A source (circle) shown inside a frame to convey each fit mode. */
function FitIcon({ mode }: { mode: FitMode }) {
  return (
    <span className="grid h-8 place-items-center">
      <span className="flex h-7 w-10 items-center justify-center overflow-hidden rounded-[3px] border-2 border-current">
        {mode === "contain" ? (
          // fits inside → letterbox around it
          <span className="size-4 rounded-full bg-current" />
        ) : mode === "cover" ? (
          // scaled to fill → cropped top/bottom
          <span className="size-10 shrink-0 rounded-full bg-current" />
        ) : (
          // stretched to fill → distorted ellipse
          <span className="h-full w-full rounded-full bg-current" />
        )}
      </span>
    </span>
  );
}

export function SettingsTab() {
  const settings = useTrailerStore((s) => s.settings);
  const setLen = useTrailerStore((s) => s.setDefaultClipLength);
  const update = useTrailerStore((s) => s.updateSettings);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold">Default clip length</h2>
          <p className="text-xs text-muted">Each clip you mark on the timeline uses this length.</p>
        </div>
        <LabeledSlider
          label="Length"
          value={settings.defaultClipLengthSec}
          min={1}
          max={10}
          step={0.5}
          onChange={setLen}
          format={(v) => `${v.toFixed(1)}s`}
        />
      </div>

      <LabeledSwitch
        label="Flip clips horizontally"
        checked={settings.flipHorizontal}
        onChange={(v) => update({ flipHorizontal: v })}
      />

      <div className="flex flex-col gap-1.5">
        <Label>Aspect ratio</Label>
        <div className="grid grid-cols-3 gap-2">
          {ASPECT_RATIOS.map((r) => {
            const active = settings.aspectRatio === r.id;
            const icon = ratioIcon(r.w, r.h);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => update({ aspectRatio: r.id as AspectRatio })}
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

      <div className="flex flex-col gap-1.5">
        <Label>Fit</Label>
        <div className="grid grid-cols-3 gap-2">
          {FIT_MODES.map((f) => {
            const active = settings.fitMode === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => update({ fitMode: f.id as FitMode })}
                title={f.label}
                className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-colors ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface-secondary text-muted hover:border-accent/50"
                }`}
              >
                <FitIcon mode={f.id as FitMode} />
                <span className={`text-xs font-medium capitalize ${active ? "text-accent" : "text-foreground"}`}>
                  {f.id}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          Applied when a clip's ratio differs from the trailer ratio.
        </p>
      </div>
    </div>
  );
}
