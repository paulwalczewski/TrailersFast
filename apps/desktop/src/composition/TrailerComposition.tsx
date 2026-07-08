import type { FitMode } from "@trailerfast/core";
import { AbsoluteFill, Sequence, Series, Video } from "remotion";
import { IntroTitle, type IntroProps } from "./IntroTitle";
import { WatermarkOverlay, type WatermarkProps } from "./WatermarkOverlay";

export const PREVIEW_FPS = 30;

export type PreviewClip = {
  id: string;
  src: string;
  trimBeforeInFrames: number;
  durationInFrames: number;
};

export type TrailerCompositionProps = {
  clips: PreviewClip[];
  /** Overlaid on the first frames of the trailer; null when disabled/empty. */
  intro: IntroProps | null;
  /** Shown across the whole trailer; null when disabled/empty. */
  watermark: WatermarkProps | null;
  flipHorizontal: boolean;
  fitMode: FitMode;
};

/** Concatenates the marked clips back-to-back, with the intro overlaid on top. */
export function TrailerComposition({
  clips,
  intro,
  watermark,
  flipHorizontal,
  fitMode,
}: TrailerCompositionProps) {
  const objectFit = fitMode === "stretch" ? "fill" : fitMode;
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Series>
        {clips.map((c) => (
          <Series.Sequence key={c.id} durationInFrames={c.durationInFrames}>
            <Video
              src={c.src}
              trimBefore={c.trimBeforeInFrames}
              trimAfter={c.trimBeforeInFrames + c.durationInFrames}
              pauseWhenBuffering
              acceptableTimeShiftInSeconds={10}
              style={{
                width: "100%",
                height: "100%",
                objectFit,
                transform: flipHorizontal ? "scaleX(-1)" : undefined,
              }}
            />
          </Series.Sequence>
        ))}
      </Series>

      {intro && intro.durationInFrames > 0 ? (
        <Sequence durationInFrames={intro.durationInFrames}>
          <IntroTitle {...intro} />
        </Sequence>
      ) : null}

      {watermark ? <WatermarkOverlay {...watermark} /> : null}
    </AbsoluteFill>
  );
}
