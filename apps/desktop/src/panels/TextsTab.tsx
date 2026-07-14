import { Input, Label, TextField } from "@heroui/react";
import { WATERMARK_POSITIONS, type WatermarkPosition } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type ReactNode, useState } from "react";
import { LabeledColor, LabeledSelect, LabeledSlider, LabeledSwitch } from "../ui/Fields";
import { TitleCardForm } from "./TitleCardForm";

/** Collapsible section with an "On" badge when its feature is enabled. */
function Section({
  title,
  enabled,
  defaultOpen = false,
  children,
}: {
  title: string;
  enabled: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-separator bg-surface-secondary">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-tertiary"
      >
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex items-center gap-2">
          {enabled ? (
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
              On
            </span>
          ) : null}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open ? <div className="border-t border-separator p-3">{children}</div> : null}
    </div>
  );
}

function WatermarkForm() {
  const wm = useTrailerStore((s) => s.watermark);
  const update = useTrailerStore((s) => s.updateWatermark);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">Optional. Shown across the whole trailer.</p>

      <LabeledSwitch
        label="Enable watermark"
        checked={wm.enabled}
        onChange={(v) => update({ enabled: v })}
      />

      <div
        className={
          wm.enabled ? "flex flex-col gap-4" : "pointer-events-none flex flex-col gap-4 opacity-50"
        }
        aria-disabled={!wm.enabled}
      >
        <TextField value={wm.text} onChange={(v) => update({ text: v })}>
          <Label>Text</Label>
          <Input placeholder="© Your Brand" />
        </TextField>

        <LabeledSelect
          label="Position"
          selectedKey={wm.position}
          options={WATERMARK_POSITIONS}
          onChange={(id) => update({ position: id as WatermarkPosition })}
        />

        <LabeledSlider
          label="Size"
          value={wm.fontSizePx}
          min={12}
          max={96}
          step={2}
          onChange={(v) => update({ fontSizePx: v })}
          format={(v) => `${Math.round(v)}px`}
        />

        <LabeledSlider
          label="Opacity"
          value={wm.opacity}
          min={0.1}
          max={1}
          step={0.05}
          onChange={(v) => update({ opacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />

        <LabeledColor label="Color" value={wm.color} onChange={(v) => update({ color: v })} />
      </div>
    </div>
  );
}

export function TextsTab() {
  const intro = useTrailerStore((s) => s.intro);
  const updateIntro = useTrailerStore((s) => s.updateIntro);
  const outro = useTrailerStore((s) => s.outro);
  const updateOutro = useTrailerStore((s) => s.updateOutro);
  const wmEnabled = useTrailerStore((s) => s.watermark.enabled);

  return (
    <div className="flex flex-col gap-3">
      <Section title="Intro" enabled={intro.enabled} defaultOpen>
        <TitleCardForm
          name="intro"
          hint="Optional. Shows over the first seconds of the trailer, then animates out."
          config={intro}
          onChange={updateIntro}
        />
      </Section>
      <Section title="Outro" enabled={outro.enabled}>
        <TitleCardForm
          name="outro"
          hint="Optional. Shows over the last seconds of the trailer."
          config={outro}
          onChange={updateOutro}
        />
      </Section>
      <Section title="Watermark" enabled={wmEnabled}>
        <WatermarkForm />
      </Section>
    </div>
  );
}
