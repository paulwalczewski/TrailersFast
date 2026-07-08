import type { IntroAnimation } from "@trailerfast/core";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type IntroProps = {
  text: string;
  description: string;
  fontFamily: string;
  headingWeight: number;
  fontSizePx: number;
  color: string;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  animation: IntroAnimation;
  durationInFrames: number;
  shadowEnabled: boolean;
  shadowIntensity: number;
  shadowX: number;
  shadowY: number;
};

const JUSTIFY = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
} as const;

const ALIGN_ITEMS = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
} as const;

/**
 * Full-screen title that animates IN over the first ~0.4s and OUT over the last
 * ~0.4s of its duration. The four animation styles must be reproducible in
 * FFmpeg `drawtext` for export parity (kept intentionally simple).
 */
export function IntroTitle({
  text,
  description,
  fontFamily,
  headingWeight,
  fontSizePx,
  color,
  align,
  vAlign,
  animation,
  durationInFrames,
  shadowEnabled,
  shadowIntensity,
  shadowX,
  shadowY,
}: IntroProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Hard shadow (blur 0) to match FFmpeg drawtext's shadowx/shadowy in export.
  const textShadow = shadowEnabled
    ? `${shadowX}px ${shadowY}px 0 rgba(0,0,0,${shadowIntensity})`
    : "none";

  const enter = Math.min(0.4 * fps, durationInFrames * 0.3);
  const keys = [0, enter, durationInFrames - enter, durationInFrames];
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  // Visible immediately (so it shows at the paused first frame), animates OUT at the end.
  const opacity = interpolate(frame, [durationInFrames - enter, durationInFrames], [1, 0], clamp);

  let translate = "0px 0px";
  let scale = 1;
  if (animation === "slideLeft") {
    translate = `${interpolate(frame, keys, [-220, 0, 0, 220], clamp)}px 0px`;
  } else if (animation === "slideUp") {
    translate = `0px ${interpolate(frame, keys, [140, 0, 0, -140], clamp)}px`;
  } else if (animation === "scale") {
    scale = interpolate(frame, keys, [0.7, 1, 1, 1.12], clamp);
  }

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        // AbsoluteFill defaults to column, which swaps the axes — force row so
        // justifyContent = horizontal (align) and alignItems = vertical (vAlign).
        flexDirection: "row",
        alignItems: ALIGN_ITEMS[vAlign],
        justifyContent: JUSTIFY[align],
        // ~6% inset so edge-aligned text isn't flush against the frame.
        padding: "6%",
      }}
    >
      <div
        style={{
          opacity,
          translate,
          scale,
          color,
          fontFamily,
          textAlign: align,
          textShadow,
          maxWidth: "84%",
        }}
      >
        <div style={{ fontSize: fontSizePx, fontWeight: headingWeight, lineHeight: 1.1 }}>{text}</div>
        {description ? (
          <div
            style={{
              fontSize: Math.round(fontSizePx * 0.42),
              fontWeight: 500,
              lineHeight: 1.25,
              marginTop: Math.round(fontSizePx * 0.28),
              opacity: 0.92,
            }}
          >
            {description}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
