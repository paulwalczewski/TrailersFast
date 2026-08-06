import type { IntroConfig } from "@trailerfast/core";
import { quoteFamily } from "./fonts";

/**
 * Render the intro (heading + description) to a transparent PNG at the export
 * resolution, using the webview's own text engine — which renders color emoji
 * and the chosen fonts exactly like the preview. Returns base64 (no data-URL
 * prefix), or null if there's nothing to draw. Animation is applied later by
 * FFmpeg overlay; this is the static, final-position frame.
 */
export function renderIntroImage(intro: IntroConfig, width: number, height: number): string | null {
  const heading = intro.text.trim();
  const description = intro.description.trim();
  if (!heading && !description) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const pad = Math.round(Math.min(width, height) * 0.06);
  const headSize = Math.round((intro.fontSizePx * Math.min(width, height)) / 1080);
  const descSize = Math.round(headSize * 0.42);
  const gap = Math.round(headSize * 0.28);

  ctx.fillStyle = intro.color;
  ctx.textBaseline = "top";
  ctx.textAlign = intro.align === "left" ? "left" : intro.align === "right" ? "right" : "center";

  if (intro.shadowEnabled) {
    const scale = Math.min(width, height) / 1080;
    ctx.shadowColor = `rgba(0,0,0,${intro.shadowIntensity})`;
    ctx.shadowOffsetX = intro.shadowX * scale;
    ctx.shadowOffsetY = intro.shadowY * scale;
    ctx.shadowBlur = 0;
  }

  // Horizontal anchor.
  const x = intro.align === "left" ? pad : intro.align === "right" ? width - pad : width / 2;

  // Vertical: stack heading + description, place the block per vAlign.
  const blockH = headSize + (description ? gap + descSize : 0);
  const topY =
    intro.vAlign === "top" ? pad : intro.vAlign === "bottom" ? height - pad - blockH : (height - blockH) / 2;

  if (heading) {
    ctx.font = `${intro.headingWeight} ${headSize}px ${quoteFamily(intro.fontFamily)}`;
    ctx.fillText(heading, x, topY);
  }
  if (description) {
    ctx.font = `400 ${descSize}px ${quoteFamily(intro.fontFamily)}`;
    ctx.fillText(description, x, topY + headSize + gap);
  }

  return canvas.toDataURL("image/png").split(",")[1] ?? null;
}
