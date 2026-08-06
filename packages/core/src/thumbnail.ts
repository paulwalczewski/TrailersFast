/**
 * Thumbnail layout math, shared by the on-screen preview and the export render
 * (both go through the same `drawThumbnail` canvas pass, at different sizes).
 * Pure geometry — no DOM, no canvas.
 */
import { type ThumbnailConfig, type ThumbnailTemplate, thumbnailTextActive } from "./model";

/** A tile of the thumbnail canvas that one picked frame fills (cover-cropped). */
export type MosaicCell = { x: number; y: number; width: number; height: number };

/**
 * Split the canvas into `count` tiles that together cover it exactly — rows of
 * equal height, each row split into equal-width cells. The row count is the one
 * whose cells come out closest to square, so a mosaic never degenerates into
 * slivers (4 frames on a 16:9 canvas → 2×2, not 1×4).
 */
export function mosaicCells(count: number, width: number, height: number): MosaicCell[] {
  if (count <= 0 || width <= 0 || height <= 0) return [];
  if (count === 1) return [{ x: 0, y: 0, width, height }];

  let rows = 1;
  let best = Number.POSITIVE_INFINITY;
  for (let r = 1; r <= count; r++) {
    const cols = Math.ceil(count / r);
    // Distortion of a cell vs. a square, measured symmetrically (log ratio).
    const score = Math.abs(Math.log(width / cols / (height / r)));
    if (score < best - 1e-9) {
      best = score;
      rows = r;
    }
  }

  // Distribute the frames over the rows as evenly as possible; the remainder
  // goes to the top rows, so any short row sits at the bottom.
  const base = Math.floor(count / rows);
  const extra = count % rows;
  const rowHeight = height / rows;
  const cells: MosaicCell[] = [];
  for (let r = 0; r < rows; r++) {
    const cols = base + (r < extra ? 1 : 0);
    const cellWidth = width / cols;
    for (let c = 0; c < cols; c++) {
      cells.push({ x: c * cellWidth, y: r * rowHeight, width: cellWidth, height: rowHeight });
    }
  }
  return cells;
}

/** Equal bands across one axis: `horizontal` stacks rows, `vertical` splits columns. */
export function stripeCells(
  count: number,
  width: number,
  height: number,
  axis: "horizontal" | "vertical",
): MosaicCell[] {
  if (count <= 0 || width <= 0 || height <= 0) return [];
  return Array.from({ length: count }, (_, i) =>
    axis === "horizontal"
      ? { x: 0, y: (i * height) / count, width, height: height / count }
      : { x: (i * width) / count, y: 0, width: width / count, height },
  );
}

/** The tiles a template lays out for `frameCount` picked frames. */
export function templateCells(
  template: ThumbnailTemplate,
  frameCount: number,
  width: number,
  height: number,
): MosaicCell[] {
  if (frameCount <= 0) return [];
  switch (template) {
    // `single` ignores every frame after the first — one full-bleed tile.
    case "single":
      return [{ x: 0, y: 0, width, height }];
    case "stripes-horizontal":
      return stripeCells(frameCount, width, height, "horizontal");
    case "stripes-vertical":
      return stripeCells(frameCount, width, height, "vertical");
    default:
      return mosaicCells(frameCount, width, height);
  }
}

/** How many of the picked frames a template actually draws. */
export function framesUsed(cfg: ThumbnailConfig): number {
  return cfg.template === "single" ? Math.min(1, cfg.frames.length) : cfg.frames.length;
}

/**
 * The scrim actually painted. It exists to keep the title readable, so with no
 * title on the thumbnail there's nothing to dim for — the frames show clean.
 */
export function effectiveScrim(cfg: ThumbnailConfig): number {
  return thumbnailTextActive(cfg.title) ? cfg.scrim : 0;
}
