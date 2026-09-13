/**
 * Thumbnail export. The webview composites the final image with the very same
 * `drawThumbnail` pass the preview uses — just at output resolution and over
 * losslessly extracted frames — then FFmpeg encodes the PNG into the chosen
 * format. Shared by the export dialog (and any future MCP tool).
 */
import { byId, canvasFor, clipRenderBox, type ImageFormat, templateCells } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { engine } from "./engine";
import { ensureFontsLoaded } from "./fonts";
import { drawThumbnail, type LoadedFrame } from "./thumbnail/drawThumbnail";
import { extractFrame } from "./thumbnail/frameImages";

/** Composite the current thumbnail at `width`×`height`; returns base64 PNG. */
export async function renderThumbnailPng(width: number, height: number): Promise<string> {
  const { thumbnail, assets } = useTrailerStore.getState();
  const assetsById = byId(assets);
  const cells = templateCells(thumbnail.template, thumbnail.frames.length, width, height);

  // The title font may be a bundled @font-face; load it (concurrently with the
  // FFmpeg frame extraction below) so the synchronous canvas draw doesn't
  // silently fall back to a system font.
  const fontsReady = ensureFontsLoaded([thumbnail.title.fontFamily]);

  const images: (LoadedFrame | null)[] = await Promise.all(
    thumbnail.frames.map((f, i) => {
      const asset = assetsById[f.assetId];
      const cell = cells[i];
      if (!asset || !cell) return null;
      // Extract at exactly the width the tile draws it at (zoom included) —
      // never upscale past the source, never decode a 4K frame for a small tile.
      const box = clipRenderBox(
        asset.width,
        asset.height,
        cell.width,
        cell.height,
        "cover",
        f.transform,
      );
      const needed = Math.max(2, Math.ceil(box.width));
      const w = asset.width > 0 ? Math.min(asset.width, needed) : needed;
      return extractFrame(asset, f.atSec, w, { lossless: true });
    }),
  );

  await fontsReady;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not create the export canvas");
  drawThumbnail(ctx, width, height, thumbnail, images);
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("could not encode the thumbnail");
  return base64;
}

/**
 * Render + encode the thumbnail to `outPath`. `shortSide` is the output's short
 * edge; the thumbnail's aspect ratio sets the other one.
 */
export async function performThumbnailExport(
  outPath: string,
  opts: { shortSide: number; format: ImageFormat; quality: number },
): Promise<string> {
  const { thumbnail } = useTrailerStore.getState();
  const { width, height } = canvasFor(thumbnail.aspectRatio, opts.shortSide);
  const png = await renderThumbnailPng(width, height);
  return engine.saveImage(png, outPath, opts.format, opts.quality);
}
