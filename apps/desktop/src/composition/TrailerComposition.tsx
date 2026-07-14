import { type ClipTransform, type FitMode, clipRenderBox } from "@trailerfast/core";
import { useMemo, useState } from "react";
import {
  AbsoluteFill,
  Sequence,
  Series,
  Video,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { IntroTitle, type IntroProps } from "./IntroTitle";
import { WatermarkOverlay, type WatermarkProps } from "./WatermarkOverlay";

export const PREVIEW_FPS = 30;

/**
 * Decode the next clip this many frames before it becomes visible, so crossing a
 * clip boundary during playback never flashes black while it loads.
 */
const PREMOUNT_FRAMES = PREVIEW_FPS; // ~1s lead

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
    const flip = flipHorizontal ? "scaleX(-1)" : undefined;
    // Source dims unknown (still probing) — degrade to plain object-fit.
    if (srcWidth <= 0 || srcHeight <= 0) {
      return {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: fitMode,
        transform: flip,
      };
    }
    const box = clipRenderBox(srcWidth, srcHeight, canvasW, canvasH, fitMode, transform);
    return {
      position: "absolute",
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      // Tailwind preflight sets img/video { max-width: 100% }, which would
      // clamp the overflowing box — inline width can't beat a CSS max-width.
      maxWidth: "none",
      // The box already encodes the fit — media must fill it exactly.
      objectFit: "fill",
      transform: flip,
    };
  }, [fitMode, flipHorizontal, srcWidth, srcHeight, canvasW, canvasH, transform]);

  // The webview paints <video> black until a frame is decoded, which would
  // cover the thumbnail behind it — keep the video invisible until then.
  const [readySrc, setReadySrc] = useState("");
  const videoReady = readySrc === clip.src;

  let thumb: string | undefined;
  if (clip.filmstripUrls.length > 0 && clip.assetDurationSec > 0) {
    const sourceSec = clip.startSec + frame / fps;
    const n = clip.filmstripUrls.length;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((sourceSec / clip.assetDurationSec) * n)));
    thumb = clip.filmstripUrls[idx];
  }

  return (
    <AbsoluteFill>
      {/* Plain <img> (preview-only composition; never exported) — instant, no delayRender. */}
      {thumb ? <img src={thumb} alt="" style={style} /> : null}
      <Video
        src={clip.src}
        trimBefore={clip.trimBeforeInFrames}
        trimAfter={clip.trimBeforeInFrames + clip.durationInFrames}
        pauseWhenBuffering
        acceptableTimeShiftInSeconds={10}
        onLoadedData={() => setReadySrc(clip.src)}
        onCanPlay={() => setReadySrc(clip.src)}
        onTimeUpdate={videoReady ? undefined : () => setReadySrc(clip.src)}
        style={videoReady ? style : { ...style, opacity: 0 }}
      />
    </AbsoluteFill>
  );
}

/** Concatenates the marked clips back-to-back, with the intro overlaid on top. */
export function TrailerComposition({
  clips,
  intro,
  watermark,
  flipHorizontal,
  fitMode,
}: TrailerCompositionProps) {
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

      {watermark ? <WatermarkOverlay {...watermark} /> : null}
    </AbsoluteFill>
  );
}
