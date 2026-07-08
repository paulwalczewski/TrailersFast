import type { WatermarkPosition } from "@trailerfast/core";
import type { CSSProperties } from "react";
import { AbsoluteFill } from "remotion";

export type WatermarkProps = {
  text: string;
  position: WatermarkPosition;
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
export function WatermarkOverlay({ text, position, fontSizePx, color, opacity }: WatermarkProps) {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...POS[position],
          color,
          opacity,
          fontSize: fontSizePx,
          fontWeight: 700,
          textShadow: "0 1px 8px rgba(0,0,0,0.6)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}
