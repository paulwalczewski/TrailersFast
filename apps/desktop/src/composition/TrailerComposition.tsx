import {
  type ClipTransform,
  type FitMode,
  clipRenderBox,
  filmstripFrameAt,
  totalFrames,
} from "@trailerfast/core";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Sequence,
  Series,
  Video,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { clipBoxStyle, useMediaReady } from "../ui/clipMedia";
import { IntroTitle, type IntroProps } from "./IntroTitle";
import { WatermarkOverlay, type WatermarkProps } from "./WatermarkOverlay";

export const PREVIEW_FPS = 30;

/**
 * Decode the next clip this many frames before it becomes visible, so crossing a
 * clip boundary during playback never flashes black while it loads.
 */
const PREMOUNT_FRAMES = PREVIEW_FPS; // ~1s lead

/**
 * How far a clip's <video> may drift from the timeline before Remotion seeks it
 * back. The element plays on its own 1x clock while Remotion drives the frame,
 * and when the two diverge the element reaches the hard stop at its out-point
 * early and holds that last frame for the rest of the clip — a visible freeze.
 * Remotion's own default is ~20 frames, and it clamps whatever it is given to
 * the clip's length, so a large value on short clips means no leash at all.
 */
const MAX_DRIFT_FRAMES = 9;

export type PreviewClip = {
  id: string;
  src: string;
  trimBeforeInFrames: number;
  durationInFrames: number;
  /** Pre-generated thumbnails spanning the whole source (instant scrub placeholder). */
  filmstripUrls: string[];
  /** This clip's in-point within the source, seconds (to index the filmstrip). */
  startSec: number;
  /** Source duration, seconds (filmstrip spans [0, this]). */
  assetDurationSec: number;
  /** Source pixel dimensions (0 while probing — falls back to object-fit). */
  srcWidth: number;
  srcHeight: number;
  /** Framing (pan/zoom) within the trailer canvas. */
  transform: ClipTransform;
};

export type TrailerCompositionProps = {
  clips: PreviewClip[];
  /** Overlaid on the first frames of the trailer; null when disabled/empty. */
  intro: IntroProps | null;
  /** Overlaid on the last frames of the trailer; null when disabled/empty. */
  outro: IntroProps | null;
  /** Shown across the whole trailer; null when disabled/empty. */
  watermark: WatermarkProps | null;
  flipHorizontal: boolean;
  fitMode: FitMode;
};

type ClipVisualProps = {
  clip: PreviewClip;
  fitMode: FitMode;
  flipHorizontal: boolean;
};

/**
 * The real video (shows the exact frame on seek) with the nearest thumbnail painted
 * behind it — so a not-yet-loaded/boundary frame shows a thumbnail instead of black,
 * and the true frame appears on top the moment it's decoded.
 */
function ClipVisual({ clip, fitMode, flipHorizontal }: ClipVisualProps) {
  const frame = useCurrentFrame(); // 0-based within this clip's sequence
  const { fps, width: canvasW, height: canvasH } = useVideoConfig();
  const { srcWidth, srcHeight, transform } = clip;
  // Rebuilt only when fit/flip/framing change, not every frame (this renders per frame).
  const style = useMemo<React.CSSProperties>(() => {
    // Source dims unknown (still probing) — degrade to plain object-fit.
    if (srcWidth <= 0 || srcHeight <= 0) {
      return {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: fitMode,
        transform: flipHorizontal ? "scaleX(-1)" : undefined,
      };
    }
    const box = clipRenderBox(srcWidth, srcHeight, canvasW, canvasH, fitMode, transform);
    return clipBoxStyle(box, { flip: flipHorizontal });
  }, [fitMode, flipHorizontal, srcWidth, srcHeight, canvasW, canvasH, transform]);

  // The webview paints <video> black until a frame is decoded, which would
  // cover the thumbnail behind it — keep the video invisible until then.
  const [videoReady, markReady] = useMediaReady(clip.src);

  const thumb = filmstripFrameAt(
    clip.filmstripUrls,
    clip.startSec + frame / fps,
    clip.assetDurationSec,
  );

  return (
    <AbsoluteFill>
      {/* Plain <img> (preview-only composition; never exported) — instant, no delayRender. */}
      {thumb ? <img src={thumb} alt="" style={style} /> : null}
      <Video
        src={clip.src}
        trimBefore={clip.trimBeforeInFrames}
        trimAfter={clip.trimBeforeInFrames + clip.durationInFrames}
        acceptableTimeShiftInSeconds={MAX_DRIFT_FRAMES / PREVIEW_FPS}
        // No `pauseWhenBuffering`: it gives every clip a veto over the player, so
        // one element waiting on data stops the timeline, the audio and the other
        // clips with it — and on WebKit it blocks the player at *every* clip start
        // until the fresh element reports a frame.
        onLoadedData={markReady}
        onCanPlay={markReady}
        onTimeUpdate={videoReady ? undefined : markReady}
        style={videoReady ? style : { ...style, opacity: 0 }}
      />
    </AbsoluteFill>
  );
}

/** Concatenates the marked clips back-to-back, with intro/outro overlaid on top. */
export function TrailerComposition({
  clips,
  intro,
  outro,
  watermark,
  flipHorizontal,
  fitMode,
}: TrailerCompositionProps) {
  const clipFrames = totalFrames(clips);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Series>
        {clips.map((c) => (
          <Series.Sequence
            key={c.id}
            durationInFrames={c.durationInFrames}
            premountFor={PREMOUNT_FRAMES}
          >
            <ClipVisual clip={c} fitMode={fitMode} flipHorizontal={flipHorizontal} />
          </Series.Sequence>
        ))}
      </Series>

      {intro && intro.durationInFrames > 0 ? (
        <Sequence durationInFrames={intro.durationInFrames}>
          <IntroTitle {...intro} />
        </Sequence>
      ) : null}

      {outro && outro.durationInFrames > 0 ? (
        <Sequence
          from={Math.max(0, clipFrames - outro.durationInFrames)}
          durationInFrames={outro.durationInFrames}
        >
          <IntroTitle {...outro} />
        </Sequence>
      ) : null}

      {watermark ? <WatermarkOverlay {...watermark} /> : null}
    </AbsoluteFill>
  );
}
