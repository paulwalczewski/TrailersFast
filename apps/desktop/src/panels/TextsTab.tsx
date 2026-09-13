import { Input, Label, TextField } from "@heroui/react";
import {
  FONT_OPTIONS,
  WATERMARK_FONT_SIZE_RANGE,
  WATERMARK_OPACITY_RANGE,
  WATERMARK_POSITIONS,
  type WatermarkPosition,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import {
  LabeledColor,
  LabeledSelect,
  LabeledSlider,
  LabeledSwitch,
  ShadowFields,
} from "../ui/Fields";
import { DisabledGroup } from "../ui/OverlayTextForm";
import { Section } from "../ui/Section";
import { TitleCardForm } from "./TitleCardForm";

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

      <DisabledGroup enabled={wm.enabled}>
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

        <LabeledSelect
          label="Font"
          selectedKey={wm.fontFamily}
          options={FONT_OPTIONS}
          onChange={(id) => update({ fontFamily: id })}
          renderOption={(o) => <span style={{ fontFamily: o.id }}>{o.label}</span>}
        />

        <LabeledSlider
          label="Size"
          value={wm.fontSizePx}
          min={WATERMARK_FONT_SIZE_RANGE[0]}
          max={WATERMARK_FONT_SIZE_RANGE[1]}
          step={2}
          onChange={(v) => update({ fontSizePx: v })}
          format={(v) => `${Math.round(v)}px`}
        />

        <LabeledSlider
          label="Opacity"
          value={wm.opacity}
          min={WATERMARK_OPACITY_RANGE[0]}
          max={WATERMARK_OPACITY_RANGE[1]}
          step={0.05}
          onChange={(v) => update({ opacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />

        <LabeledColor label="Color" value={wm.color} onChange={(v) => update({ color: v })} />

        <ShadowFields config={wm} onChange={update} />
      </DisabledGroup>
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
