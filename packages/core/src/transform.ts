/**
 * Clip framing math, shared by the Remotion preview, the reposition modal and
 * the FFmpeg export plan so all three always show the same crop.
 *
 * A clip is fitted to the canvas (per the fit mode), scaled further by `zoom`,
 * then panned by `offsetX/offsetY` — normalized so ±1 reaches the clip's edge
 * without ever uncovering the canvas.
 */
import { type ClipTransform, type FitMode, MAX_CLIP_ZOOM } from "./model";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The rectangle the scaled clip occupies, in canvas coordinates (the canvas
 * spans [0,0..canvasW,canvasH]; the box extends past it when cropping).
 */
export type ClipRenderBox = { left: number; top: number; width: number; height: number };

export function clipRenderBox(
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  fit: FitMode,
  t: Partial<ClipTransform> | undefined,
): ClipRenderBox {
  // Tolerate markers that predate the transform field (stale sessions/HMR).
  const zoom = clamp(t?.zoom ?? 1, 1, MAX_CLIP_ZOOM);
  let width: number;
  let height: number;
  if (srcW <= 0 || srcH <= 0) {
    width = canvasW * zoom;
    height = canvasH * zoom;
  } else {
    const base =
      fit === "contain" ? Math.min(canvasW / srcW, canvasH / srcH) : Math.max(canvasW / srcW, canvasH / srcH);
    width = srcW * base * zoom;
    height = srcH * base * zoom;
  }
  // Half the overflow per axis = how far the clip can pan without uncovering
  // the canvas (0 when it doesn't overflow, e.g. the letterboxed axis of contain).
  const panX = Math.max(0, (width - canvasW) / 2);
  const panY = Math.max(0, (height - canvasH) / 2);
  return {
    left: (canvasW - width) / 2 - clamp(t?.offsetX ?? 0, -1, 1) * panX,
    top: (canvasH - height) / 2 - clamp(t?.offsetY ?? 0, -1, 1) * panY,
    width,
    height,
  };
}

/**
 * Integer scale + crop for the FFmpeg export: scale the source to
 * `scaleW×scaleH`, crop the `cropW×cropH` window at `cropX/cropY`, then pad to
 * the canvas (pad is a no-op unless the clip letterboxes). Mirrors
 * `clipRenderBox` exactly.
 */
export type ClipCropSpec = {
  scaleW: number;
  scaleH: number;
  cropW: number;
  cropH: number;
  cropX: number;
  cropY: number;
};

export function clipCropSpec(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  fit: FitMode,
  t: Partial<ClipTransform> | undefined,
): ClipCropSpec {
  const box = clipRenderBox(srcW, srcH, outW, outH, fit, t);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const scaleW = even(box.width);
  const scaleH = even(box.height);
  const cropW = Math.min(scaleW, outW);
  const cropH = Math.min(scaleH, outH);
  return {
    scaleW,
    scaleH,
    cropW,
    cropH,
    cropX: clamp(Math.round(-box.left), 0, scaleW - cropW),
    cropY: clamp(Math.round(-box.top), 0, scaleH - cropH),
  };
}
