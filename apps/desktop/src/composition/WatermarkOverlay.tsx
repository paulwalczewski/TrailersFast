import type { ShadowConfig, WatermarkPosition } from "@trailerfast/core";
import type { CSSProperties } from "react";
import { AbsoluteFill } from "remotion";

export type WatermarkProps = ShadowConfig & {
  text: string;
  position: WatermarkPosition;
  fontFamily: string;
  fontSizePx: number;
  color: string;
  opacity: number;
};

const POS: Record<WatermarkPosition, CSSProperties> = {
  "top-left": { top: "4%", left: "4%" },
  "top-right": { top: "4%", right: "4%" },
  "bottom-left": { bottom: "4%", left: "4%" },
  "bottom-right": { bottom: "4%", right: "4%" },
};

/** Text watermark shown across the whole trailer. */
export function WatermarkOverlay({
  text,
  position,
  fontFamily,
  fontSizePx,
  color,
  opacity,
  shadowEnabled,
  shadowIntensity,
  shadowX,
  shadowY,
}: WatermarkProps) {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...POS[position],
          color,
          opacity,
          fontFamily,
          fontSize: fontSizePx,
          fontWeight: 700,
          // Hard shadow (blur 0) to match FFmpeg drawtext's shadowx/shadowy in export.
          textShadow: shadowEnabled
            ? `${shadowX}px ${shadowY}px 0 rgba(0,0,0,${shadowIntensity})`
            : undefined,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}
