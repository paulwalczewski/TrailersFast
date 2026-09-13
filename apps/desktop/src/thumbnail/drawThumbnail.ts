/**
 * The one and only thumbnail renderer. The live preview draws it into an
 * on-screen canvas and the export draws it into an off-screen canvas at output
 * resolution — same function, so what you see is exactly what gets saved.
 */
import {
  type ClipTransform,
  clipRenderBox,
  effectiveScrim,
  PREVIEW_SHORT_SIDE,
  type ThumbnailConfig,
  type ThumbnailTextConfig,
  templateCells,
  thumbnailTextActive,
} from "@trailerfast/core";
import { quoteFamily } from "../fonts";

/** A decoded frame ready to draw (an <img> or a seeked <video>). */
export type LoadedFrame = {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Source URL, when the image came from one — lets DOM previews reuse it. */
  url?: string;
};

const BACKDROP = "#000000";

/**
 * Paint the whole thumbnail. `images` is parallel to `cfg.frames`; entries that
 * haven't loaded yet are left as backdrop, so the preview fills in progressively.
 */
export function drawThumbnail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cfg: ThumbnailConfig,
  images: (LoadedFrame | null)[],
): void {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);

  const cells = templateCells(cfg.template, cfg.frames.length, width, height);
  cells.forEach((cell, i) => {
    const frame = images[i];
    if (frame) {
      drawCover(ctx, frame, cell, cfg.frames[i]?.transform);
    }
  });

  const scrim = effectiveScrim(cfg);
  if (scrim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${scrim})`;
    ctx.fillRect(0, 0, width, height);
  }

  if (thumbnailTextActive(cfg.title)) drawTitle(ctx, width, height, cfg.title);
  ctx.restore();
}

/**
 * Draw a frame filling its tile, cropping the overflow — the trailer's clip
 * framing math, so the per-frame pan/zoom behaves identically here.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  frame: LoadedFrame,
  cell: { x: number; y: number; width: number; height: number },
  transform: ClipTransform | undefined,
): void {
  const box = clipRenderBox(frame.width, frame.height, cell.width, cell.height, "cover", transform);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cell.x, cell.y, cell.width, cell.height);
  ctx.clip();
  ctx.drawImage(frame.image, cell.x + box.left, cell.y + box.top, box.width, box.height);
  ctx.restore();
}

/** Split `text` into lines that each fit `maxWidth` under the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      // A single word wider than the box still gets its own line (no mid-word
      // breaking) — better an overflowing word than an invisible one.
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cfg: ThumbnailTextConfig,
): void {
  const short = Math.min(width, height);
  // Sizes are authored against a 1080 short side, like the trailer's title cards.
  const scale = short / PREVIEW_SHORT_SIDE;
  const pad = short * 0.06;
  const maxWidth = width * 0.84;
  const headSize = cfg.fontSizePx * scale;
  const descSize = headSize * 0.42;
  const headLine = headSize * 1.1;
  const descLine = descSize * 1.25;
  const gap = headSize * 0.28;
  const family = quoteFamily(cfg.fontFamily);

  const headFont = `${cfg.headingWeight} ${headSize}px ${family}`;
  const descFont = `500 ${descSize}px ${family}`;

  ctx.font = headFont;
  const headLines = cfg.text.trim() ? wrap(ctx, cfg.text.trim(), maxWidth) : [];
  ctx.font = descFont;
  const descLines = cfg.description.trim() ? wrap(ctx, cfg.description.trim(), maxWidth) : [];

  const blockHeight =
    headLines.length * headLine + (descLines.length ? gap + descLines.length * descLine : 0);

  const x = cfg.align === "left" ? pad : cfg.align === "right" ? width - pad : width / 2;
  let y =
    cfg.vAlign === "top"
      ? pad
      : cfg.vAlign === "bottom"
        ? height - pad - blockHeight
        : (height - blockHeight) / 2;

  ctx.textAlign = cfg.align === "left" ? "left" : cfg.align === "right" ? "right" : "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = cfg.color;
  if (cfg.shadowEnabled) {
    // Hard shadow (no blur), matching the trailer's title cards.
    ctx.shadowColor = `rgba(0,0,0,${cfg.shadowIntensity})`;
    ctx.shadowOffsetX = cfg.shadowX * scale;
    ctx.shadowOffsetY = cfg.shadowY * scale;
    ctx.shadowBlur = 0;
  }

  ctx.font = headFont;
  for (const line of headLines) {
    // Center each line within its line box so the leading sits evenly.
    ctx.fillText(line, x, y + (headLine - headSize) / 2);
    y += headLine;
  }
  if (descLines.length) {
    y += gap;
    ctx.font = descFont;
    ctx.globalAlpha = 0.92;
    for (const line of descLines) {
      ctx.fillText(line, x, y + (descLine - descSize) / 2);
      y += descLine;
    }
  }
}
