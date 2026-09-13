import { effectiveScrim, THUMBNAIL_FONT_SIZE_RANGE, thumbnailTextActive } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { LabeledSlider } from "../ui/Fields";
import { OverlayTextForm } from "../ui/OverlayTextForm";
import { Section } from "../ui/Section";

/** Heading + description drawn over the thumbnail background. */
function TitleForm() {
  const title = useTrailerStore((s) => s.thumbnail.title);
  const update = useTrailerStore((s) => s.updateThumbnailTitle);
  return (
    <OverlayTextForm
      config={title}
      onChange={update}
      hint="Drawn on top of the template, centered by default."
      enableLabel="Show title"
      headingPlaceholder="Your thumbnail headline"
      descriptionPlaceholder="A shorter line below the heading…"
      fontSizeRange={THUMBNAIL_FONT_SIZE_RANGE}
    />
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
