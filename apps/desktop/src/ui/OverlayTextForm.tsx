import { Button, Input, Label, TextField } from "@heroui/react";
import {
  ALIGNMENTS,
  type Align,
  FONT_OPTIONS,
  HEADING_WEIGHTS,
  type ShadowConfig,
  VALIGNS,
  type VAlign,
} from "@trailerfast/core";
import type { ReactNode } from "react";
import { LabeledColor, LabeledSelect, LabeledSlider, LabeledSwitch, ShadowFields } from "./Fields";

/** The fields every overlaid text shares — title cards, thumbnail title. */
export type OverlayTextConfig = ShadowConfig & {
  enabled: boolean;
  text: string;
  description: string;
  fontFamily: string;
  headingWeight: number;
  fontSizePx: number;
  color: string;
  align: Align;
  vAlign: VAlign;
};

/** Wraps a form section that stays visible but inert while its feature is off. */
export function DisabledGroup({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return (
    <div
      className={
        enabled ? "flex flex-col gap-4" : "pointer-events-none flex flex-col gap-4 opacity-50"
      }
      aria-disabled={!enabled}
    >
      {children}
    </div>
  );
}

/** A row of segment buttons, one per option; `capitalize` renders the raw ids. */
function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        {options.map((o) => (
          <Button
            key={o}
            variant={value === o ? "primary" : "outline"}
            onPress={() => onChange(o)}
            className="flex-1 capitalize"
          >
            {o}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Enable switch + heading/description/font/weight/size/alignment/color/shadow.
 * `afterSize` slots extra fields (e.g. a title card's animation and length)
 * between the size slider and the alignment buttons.
 */
export function OverlayTextForm<C extends OverlayTextConfig>({
  config,
  onChange: update,
  hint,
  enableLabel,
  headingPlaceholder,
  descriptionPlaceholder,
  fontSizeRange,
  afterSize,
}: {
  config: C;
  onChange: (patch: Partial<C>) => void;
  /** One-line explanation shown at the top. */
  hint: string;
  enableLabel: string;
  headingPlaceholder: string;
  descriptionPlaceholder: string;
  fontSizeRange: readonly [number, number];
  afterSize?: ReactNode;
}) {
  // The patches below only touch OverlayTextConfig keys, which every C has.
  const set = (patch: Partial<OverlayTextConfig>) => update(patch as Partial<C>);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">{hint}</p>

      <LabeledSwitch
        label={enableLabel}
        checked={config.enabled}
        onChange={(v) => set({ enabled: v })}
      />

      <DisabledGroup enabled={config.enabled}>
        <TextField value={config.text} onChange={(v) => set({ text: v })}>
          <Label>Heading</Label>
          <Input placeholder={headingPlaceholder} />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <textarea
            value={config.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder={descriptionPlaceholder}
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
          />
        </div>

        <LabeledSelect
          label="Font"
          selectedKey={config.fontFamily}
          options={FONT_OPTIONS}
          onChange={(id) => set({ fontFamily: id })}
          renderOption={(o) => <span style={{ fontFamily: o.id }}>{o.label}</span>}
        />

        <LabeledSelect
          label="Heading weight"
          selectedKey={String(config.headingWeight)}
          options={HEADING_WEIGHTS}
          onChange={(id) => set({ headingWeight: Number(id) })}
          renderOption={(o) => <span style={{ fontWeight: Number(o.id) }}>{o.label}</span>}
        />

        <LabeledSlider
          label="Font size"
          value={config.fontSizePx}
          min={fontSizeRange[0]}
          max={fontSizeRange[1]}
          step={2}
          onChange={(v) => set({ fontSizePx: v })}
          format={(v) => `${Math.round(v)}px`}
        />

        {afterSize}

        <SegmentedChoice
          label="Horizontal align"
          options={ALIGNMENTS}
          value={config.align}
          onChange={(align) => set({ align })}
        />
        <SegmentedChoice
          label="Vertical align"
          options={VALIGNS}
          value={config.vAlign}
          onChange={(vAlign) => set({ vAlign })}
        />

        <LabeledColor label="Color" value={config.color} onChange={(v) => set({ color: v })} />

        <ShadowFields config={config} onChange={set} />
      </DisabledGroup>
    </div>
  );
}
