/**
 * Shared bits for painting a clip's media into its render box — used by both
 * the Remotion composition and the reposition modal so they can't drift.
 */
import type { ClipRenderBox } from "@trailerfast/core";
import { type CSSProperties, useState } from "react";

/**
 * Position media to exactly cover a clip's render box. The box intentionally
 * overflows its container (that's how pan/crop works), so `maxWidth: none` must
 * beat Tailwind preflight's `img, video { max-width: 100% }`, and the media
 * must fill the box exactly — the box already encodes the fit.
 *
 * Pass `canvas` to emit percentages (for containers sized via aspect-ratio);
 * omit it for px values (Remotion composition coordinates).
 */
export function clipBoxStyle(
  box: ClipRenderBox,
  opts: { flip?: boolean; canvas?: { width: number; height: number } } = {},
): CSSProperties {
  const { flip, canvas } = opts;
  const pos = canvas
    ? {
        left: `${(box.left / canvas.width) * 100}%`,
        top: `${(box.top / canvas.height) * 100}%`,
        width: `${(box.width / canvas.width) * 100}%`,
        height: `${(box.height / canvas.height) * 100}%`,
      }
    : { left: box.left, top: box.top, width: box.width, height: box.height };
  return {
    position: "absolute",
    ...pos,
    maxWidth: "none",
    objectFit: "fill",
    transform: flip ? "scaleX(-1)" : undefined,
  };
}

/**
 * Whether the <video> for `src` has produced a frame. The webview paints video
 * elements black until then, so callers keep the video invisible (showing an
 * instant thumbnail behind it) until `markReady` fires from a media event.
 */
export function useMediaReady(src: string): [boolean, () => void] {
  const [readySrc, setReadySrc] = useState("");
  return [readySrc === src, () => setReadySrc(src)];
}
