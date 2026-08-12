import { Button, Input, Label, TextField } from "@heroui/react";
import {
  ALIGNMENTS,
  HEADING_WEIGHTS,
  FONT_OPTIONS,
  THUMBNAIL_FONT_SIZE_RANGE,
  VALIGNS,
  effectiveScrim,
  thumbnailTextActive,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import {
  LabeledColor,
  LabeledSelect,
  LabeledSlider,
  LabeledSwitch,
  ShadowFields,
} from "../ui/Fields";
import { Section } from "../ui/Section";

/** Heading + description drawn over the thumbnail background. */
function TitleForm() {
  const title = useTrailerStore((s) => s.thumbnail.title);
  const update = useTrailerStore((s) => s.updateThumbnailTitle);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">Drawn on top of the template, centered by default.</p>

      <LabeledSwitch
        label="Show title"
        checked={title.enabled}
        onChange={(v) => update({ enabled: v })}
      />

      <div
        className={
          title.enabled ? "flex flex-col gap-4" : "pointer-events-none flex flex-col gap-4 opacity-50"
        }
        aria-disabled={!title.enabled}
      >
        <TextField value={title.text} onChange={(v) => update({ text: v })}>
          <Label>Heading</Label>
          <Input placeholder="Your thumbnail headline" />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <textarea
            value={title.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="A shorter line below the heading…"
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
          />
        </div>

        <LabeledSelect
          label="Font"
          selectedKey={title.fontFamily}
          options={FONT_OPTIONS}
          onChange={(id) => update({ fontFamily: id })}
          renderOption={(o) => <span style={{ fontFamily: o.id }}>{o.label}</span>}
        />

        <LabeledSelect
          label="Heading weight"
          selectedKey={String(title.headingWeight)}
          options={HEADING_WEIGHTS}
          onChange={(id) => update({ headingWeight: Number(id) })}
          renderOption={(o) => <span style={{ fontWeight: Number(o.id) }}>{o.label}</span>}
        />

        <LabeledSlider
          label="Font size"
          value={title.fontSizePx}
          min={THUMBNAIL_FONT_SIZE_RANGE[0]}
          max={THUMBNAIL_FONT_SIZE_RANGE[1]}
          step={2}
          onChange={(v) => update({ fontSizePx: v })}
          format={(v) => `${Math.round(v)}px`}
        />

        <div className="flex flex-col gap-1.5">
          <Label>Horizontal align</Label>
          <div className="flex gap-2">
            {ALIGNMENTS.map((a) => (
              <Button
                key={a}
                variant={title.align === a ? "primary" : "outline"}
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
                variant={title.vAlign === a ? "primary" : "outline"}
                onPress={() => update({ vAlign: a })}
                className="flex-1 capitalize"
              >
                {a}
              </Button>
            ))}
          </div>
        </div>

        <LabeledColor label="Color" value={title.color} onChange={(v) => update({ color: v })} />

        <ShadowFields config={title} onChange={update} />
      </div>
    </div>
  );
}

/** Dim the frames behind the text so a busy mosaic doesn't swallow it. */
function ScrimForm({ active }: { active: boolean }) {
  const scrim = useTrailerStore((s) => s.thumbnail.scrim);
  const update = useTrailerStore((s) => s.updateThumbnail);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">
        {active
          ? "A black wash over the frames — raise it when the title fights a busy background."
          : "Only applies while the thumbnail has a title. With no text there's nothing to dim for, so the frames show clean."}
      </p>
      <LabeledSlider
        label="Dim background"
        value={scrim}
        min={0}
        max={0.8}
        step={0.05}
        disabled={!active}
        onChange={(v) => update({ scrim: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
    </div>
  );
}

export function ThumbnailTextsTab() {
  const thumbnail = useTrailerStore((s) => s.thumbnail);
  const titleActive = thumbnailTextActive(thumbnail.title);

  return (
    <div className="flex flex-col gap-3">
      <Section title="Title" enabled={titleActive} defaultOpen>
        <TitleForm />
      </Section>
      <Section title="Background dim" enabled={effectiveScrim(thumbnail) > 0}>
        <ScrimForm active={titleActive} />
      </Section>
    </div>
  );
}
