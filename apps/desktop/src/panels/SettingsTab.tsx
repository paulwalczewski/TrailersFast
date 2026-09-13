import { Label } from "@heroui/react";
import { CLIP_LENGTH_RANGE, FIT_MODES, type FitMode } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { AspectRatioPicker } from "../ui/AspectRatioPicker";
import { LabeledSlider, LabeledSwitch } from "../ui/Fields";

/**
 * A video (translucent rectangle) laid over a dashed canvas frame: wider than
 * the canvas for cover (cropped sides), letterboxed inside it for contain.
 */
function FitIcon({ mode }: { mode: FitMode }) {
  return (
    <span className="relative grid h-8 w-full place-items-center">
      {/* the video */}
      <span
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-current/45 ${
          mode === "cover" ? "h-6 w-11" : "h-4 w-9"
        }`}
      />
      {/* the canvas */}
      <span className="absolute left-1/2 top-1/2 h-6 w-9 -translate-x-1/2 -translate-y-1/2 border border-dashed border-current" />
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
          min={CLIP_LENGTH_RANGE[0]}
          max={CLIP_LENGTH_RANGE[1]}
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

      <AspectRatioPicker
        value={settings.aspectRatio}
        onChange={(aspectRatio) => update({ aspectRatio })}
      />

      <div className="flex flex-col gap-1.5">
        <Label>Fit</Label>
        <div className="grid grid-cols-2 gap-2">
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
                <span
                  className={`text-xs font-medium capitalize ${active ? "text-accent" : "text-foreground"}`}
                >
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
