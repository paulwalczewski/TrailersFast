import { Button, Input, Label, TextField } from "@heroui/react";
import {
  ALIGNMENTS,
  HEADING_WEIGHTS,
  INTRO_ANIMATIONS,
  INTRO_FONTS,
  type IntroAnimation,
  type IntroConfig,
  TITLE_CARD_DURATION_RANGE,
  TITLE_CARD_FONT_SIZE_RANGE,
  VALIGNS,
} from "@trailerfast/core";
import { LabeledColor, LabeledSelect, LabeledSlider, LabeledSwitch } from "../ui/Fields";

const FONT_OPTIONS = INTRO_FONTS.map((f) => ({ id: f, label: f }));

type Props = {
  /** Lowercase card name for the enable switch, e.g. "intro" / "outro". */
  name: string;
  /** One-line explanation shown at the top. */
  hint: string;
  config: IntroConfig;
  onChange: (patch: Partial<IntroConfig>) => void;
};

/** Settings form for a title card (intro/outro) — same fields for both. */
export function TitleCardForm({ name, hint, config, onChange: update }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">{hint}</p>

      <LabeledSwitch
        label={`Enable ${name}`}
        checked={config.enabled}
        onChange={(v) => update({ enabled: v })}
      />

      <div
        className={
          config.enabled ? "flex flex-col gap-4" : "pointer-events-none flex flex-col gap-4 opacity-50"
        }
        aria-disabled={!config.enabled}
      >
        <TextField value={config.text} onChange={(v) => update({ text: v })}>
          <Label>Heading</Label>
          <Input placeholder="Your trailer title" />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <textarea
            value={config.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="A longer subtitle or tagline…"
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
          />
        </div>

        <LabeledSelect
          label="Font"
          selectedKey={config.fontFamily}
          options={FONT_OPTIONS}
          onChange={(id) => update({ fontFamily: id })}
          renderOption={(o) => <span style={{ fontFamily: o.id }}>{o.label}</span>}
        />

        <LabeledSelect
          label="Heading weight"
          selectedKey={String(config.headingWeight)}
          options={HEADING_WEIGHTS}
          onChange={(id) => update({ headingWeight: Number(id) })}
          renderOption={(o) => <span style={{ fontWeight: Number(o.id) }}>{o.label}</span>}
        />

        <LabeledSlider
          label="Font size"
          value={config.fontSizePx}
          min={TITLE_CARD_FONT_SIZE_RANGE[0]}
          max={TITLE_CARD_FONT_SIZE_RANGE[1]}
          step={2}
          onChange={(v) => update({ fontSizePx: v })}
          format={(v) => `${Math.round(v)}px`}
        />

        <LabeledSelect
          label="Animation"
          selectedKey={config.animation}
          options={INTRO_ANIMATIONS}
          onChange={(id) => update({ animation: id as IntroAnimation })}
        />

        <LabeledSlider
          label="Length"
          value={config.durationSec}
          min={TITLE_CARD_DURATION_RANGE[0]}
          max={TITLE_CARD_DURATION_RANGE[1]}
          step={0.5}
          onChange={(v) => update({ durationSec: v })}
          format={(v) => `${v.toFixed(1)}s`}
        />

        <div className="flex flex-col gap-1.5">
          <Label>Horizontal align</Label>
          <div className="flex gap-2">
            {ALIGNMENTS.map((a) => (
              <Button
                key={a}
                variant={config.align === a ? "primary" : "outline"}
                onPress={() => update({ align: a })}
                className="flex-1 capitalize"
              >
                {a}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Vertical align</Label>
          <div className="flex gap-2">
            {VALIGNS.map((a) => (
              <Button
                key={a}
                variant={config.vAlign === a ? "primary" : "outline"}
                onPress={() => update({ vAlign: a })}
                className="flex-1 capitalize"
              >
                {a}
              </Button>
            ))}
          </div>
        </div>

        <LabeledColor label="Color" value={config.color} onChange={(v) => update({ color: v })} />

        <LabeledSwitch
          label="Text shadow"
          checked={config.shadowEnabled}
          onChange={(v) => update({ shadowEnabled: v })}
        />
        {config.shadowEnabled ? (
          <>
            <LabeledSlider
              label="Shadow intensity"
              value={config.shadowIntensity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => update({ shadowIntensity: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <LabeledSlider
              label="Shadow X"
              value={config.shadowX}
              min={-15}
              max={15}
              step={1}
              onChange={(v) => update({ shadowX: v })}
              format={(v) => `${Math.round(v)}px`}
            />
            <LabeledSlider
              label="Shadow Y"
              value={config.shadowY}
              min={-15}
              max={15}
              step={1}
              onChange={(v) => update({ shadowY: v })}
              format={(v) => `${Math.round(v)}px`}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
