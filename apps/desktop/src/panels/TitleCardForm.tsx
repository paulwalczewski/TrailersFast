import {
  INTRO_ANIMATIONS,
  type IntroAnimation,
  type IntroConfig,
  TITLE_CARD_DURATION_RANGE,
  TITLE_CARD_FONT_SIZE_RANGE,
} from "@trailerfast/core";
import { LabeledSelect, LabeledSlider } from "../ui/Fields";
import { OverlayTextForm } from "../ui/OverlayTextForm";

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
    <OverlayTextForm
      config={config}
      onChange={update}
      hint={hint}
      enableLabel={`Enable ${name}`}
      headingPlaceholder="Your trailer title"
      descriptionPlaceholder="A longer subtitle or tagline…"
      fontSizeRange={TITLE_CARD_FONT_SIZE_RANGE}
      afterSize={
        <>
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
        </>
      }
    />
  );
}
