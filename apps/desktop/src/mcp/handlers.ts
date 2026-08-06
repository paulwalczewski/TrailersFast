import {
  ALIGNMENTS,
  ASPECT_RATIOS,
  type Asset,
  CLIP_LENGTH_RANGE,
  type ClipMarker,
  EXPORT_PRESETS,
  FIT_MODES,
  HEADING_WEIGHTS,
  IMAGE_FORMATS,
  INTRO_ANIMATIONS,
  type ImageFormat,
  MAX_CLIP_ZOOM,
  THUMBNAIL_FONT_SIZE_RANGE,
  THUMBNAIL_SIZES,
  THUMBNAIL_TEMPLATES,
  TITLE_CARD_DURATION_RANGE,
  TITLE_CARD_FONT_SIZE_RANGE,
  type ThumbnailFrame,
  VALIGNS,
  WATERMARK_FONT_SIZE_RANGE,
  WATERMARK_OPACITY_RANGE,
  WATERMARK_POSITIONS,
  byId,
  clamp,
  effectiveScrim,
  framesUsed,
  orderedMarkers,
  trailerDuration,
} from "@trailerfast/core";
import { type EditorMode, useTrailerStore } from "@trailerfast/state";
import type { FileRef } from "@trailerfast/video-engine";
import { performExport } from "../exportTrailer";
import { performThumbnailExport } from "../exportThumbnail";
import { type IngestOutcome, fileRefFromPath, isVideoPath } from "../useIngest";

/** What the bridge hook injects: ingest lives in a React hook, not the store. */
export type McpDeps = {
  ingest: (files: FileRef[]) => Promise<IngestOutcome>[];
};

function fail(msg: string): never {
  throw new Error(msg);
}

function oneOf(value: string, allowed: readonly string[], what: string): void {
  if (!allowed.includes(value)) fail(`${what} must be one of: ${allowed.join(", ")} (got "${value}")`);
}

const inRange = (v: number, [lo, hi]: readonly [number, number]) => clamp(v, lo, hi);

function assetSummary(a: Asset) {
  return {
    id: a.id,
    fileName: a.fileName,
    path: a.path,
    durationSec: a.durationSec,
    width: a.width,
    height: a.height,
    fps: a.fps,
    hasAudio: a.hasAudio,
    selected: a.selected,
  };
}

function clipSummary(m: ClipMarker, assets: Record<string, Asset>) {
  return {
    id: m.id,
    order: m.order,
    assetId: m.assetId,
    assetFileName: assets[m.assetId]?.fileName ?? "",
    startSec: m.startSec,
    lengthSec: m.lengthSec,
    transform: m.transform,
  };
}

function frameSummary(f: ThumbnailFrame, index: number, assets: Record<string, Asset>) {
  return {
    id: f.id,
    index,
    assetId: f.assetId,
    assetFileName: assets[f.assetId]?.fileName ?? "",
    atSec: f.atSec,
    transform: f.transform,
  };
}

function getFrame(frameId: string): ThumbnailFrame {
  return (
    useTrailerStore.getState().thumbnail.frames.find((f) => f.id === frameId) ??
    fail(`no thumbnail frame with id "${frameId}" — call get_project for current frame ids`)
  );
}

/** frameSummary for a frame id, resolving its current index + assets. */
function frameResult(frameId: string) {
  const { thumbnail, assets } = useTrailerStore.getState();
  return frameSummary(
    getFrame(frameId),
    thumbnail.frames.findIndex((f) => f.id === frameId),
    byId(assets),
  );
}

/** The thumbnail as reported by get_project and every thumbnail mutation. */
function thumbnailSummary() {
  const { thumbnail, assets } = useTrailerStore.getState();
  const assetsById = byId(assets);
  return {
    template: thumbnail.template,
    aspectRatio: thumbnail.aspectRatio,
    scrim: thumbnail.scrim,
    // The scrim only paints while there's a title to keep readable.
    effectiveScrim: effectiveScrim(thumbnail),
    title: thumbnail.title,
    framesUsedByTemplate: framesUsed(thumbnail),
    frames: thumbnail.frames.map((f, i) => frameSummary(f, i, assetsById)),
  };
}

function getClip(clipId: string): ClipMarker {
  return (
    useTrailerStore.getState().markers.find((m) => m.id === clipId) ??
    fail(`no clip with id "${clipId}" — call get_project for current clip ids`)
  );
}

function getAsset(assetId: string, opts: { probed?: boolean } = {}): Asset {
  const asset =
    useTrailerStore.getState().assets.find((a) => a.id === assetId) ??
    fail(`no asset with id "${assetId}" — call list_assets for current ids`);
  if (opts.probed && (asset.loading || asset.durationSec <= 0))
    fail(`asset "${asset.fileName}" is still being analyzed — retry in a moment`);
  return asset;
}

/** Execute one MCP tool request against the live store. Throws on invalid input. */
export async function handleMcpRequest(
  method: string,
  params: unknown,
  deps: McpDeps,
): Promise<unknown> {
  // Params were schema-validated by the Rust tool layer; treat them loosely here.
  // biome-ignore lint/suspicious/noExplicitAny: IPC boundary
  const p = (params ?? {}) as Record<string, any>;
  const s = () => useTrailerStore.getState();

  switch (method) {
    case "list_assets":
      return { assets: s().assets.map(assetSummary) };

    case "add_assets": {
      const paths = p.paths as string[];
      const unsupported = paths.filter((x) => !isVideoPath(x));
      if (unsupported.length) fail(`unsupported file types: ${unsupported.join(", ")}`);
      const outcomes = await Promise.all(deps.ingest(paths.map(fileRefFromPath)));
      const assets = byId(s().assets);
      return {
        added: outcomes.filter((o) => o.ok).flatMap((o) => (assets[o.id] ? [assetSummary(assets[o.id]!)] : [])),
        failed: outcomes
          .filter((o) => !o.ok)
          .map((o) => ({ fileName: o.fileName, error: o.error })),
      };
    }

    // Internal: the Rust detect_scenes/get_frames tools need the file path.
    case "resolve_asset": {
      const asset = getAsset(p.assetId, { probed: true });
      return { path: asset.path, durationSec: asset.durationSec, fileName: asset.fileName };
    }

    case "remove_asset": {
      const asset = getAsset(p.assetId);
      s().removeAsset(asset.id);
      return { removed: asset.id, remainingAssets: s().assets.length };
    }

    case "get_project": {
      const { settings, intro, outro, watermark, markers, assets, mode } = s();
      const assetsById = byId(assets);
      return {
        mode,
        settings,
        intro,
        outro,
        watermark,
        clips: orderedMarkers(markers).map((m) => clipSummary(m, assetsById)),
        trailerDurationSec: trailerDuration(markers),
        thumbnail: thumbnailSummary(),
      };
    }

    case "set_mode": {
      oneOf(p.mode, ["trailer", "thumbnail"], "mode");
      s().setMode(p.mode as EditorMode);
      return { mode: s().mode };
    }

    case "update_settings": {
      const patch: Record<string, unknown> = {};
      if (p.aspectRatio !== undefined) {
        oneOf(p.aspectRatio, ASPECT_RATIOS.map((a) => a.id), "aspectRatio");
        patch.aspectRatio = p.aspectRatio;
      }
      if (p.fitMode !== undefined) {
        oneOf(p.fitMode, FIT_MODES.map((f) => f.id), "fitMode");
        patch.fitMode = p.fitMode;
      }
      if (p.defaultClipLengthSec !== undefined) {
        patch.defaultClipLengthSec = inRange(p.defaultClipLengthSec, CLIP_LENGTH_RANGE);
      }
      if (p.flipHorizontal !== undefined) patch.flipHorizontal = p.flipHorizontal;
      s().updateSettings(patch);
      return { settings: s().settings };
    }

    case "update_intro":
    case "update_outro": {
      const patch: Record<string, unknown> = { ...(p as object) };
      if (p.align !== undefined) oneOf(p.align, ALIGNMENTS, "align");
      if (p.vAlign !== undefined) oneOf(p.vAlign, VALIGNS, "vAlign");
      if (p.animation !== undefined)
        oneOf(p.animation, INTRO_ANIMATIONS.map((a) => a.id), "animation");
      if (p.headingWeight !== undefined)
        oneOf(String(p.headingWeight), HEADING_WEIGHTS.map((w) => w.id), "headingWeight");
      if (p.durationSec !== undefined)
        patch.durationSec = inRange(p.durationSec, TITLE_CARD_DURATION_RANGE);
      if (p.fontSizePx !== undefined)
        patch.fontSizePx = inRange(p.fontSizePx, TITLE_CARD_FONT_SIZE_RANGE);
      if (method === "update_intro") {
        s().updateIntro(patch);
        return { intro: s().intro };
      }
      s().updateOutro(patch);
      return { outro: s().outro };
    }

    case "update_watermark": {
      const patch: Record<string, unknown> = { ...(p as object) };
      if (p.position !== undefined)
        oneOf(p.position, WATERMARK_POSITIONS.map((w) => w.id), "position");
      if (p.opacity !== undefined) patch.opacity = inRange(p.opacity, WATERMARK_OPACITY_RANGE);
      if (p.fontSizePx !== undefined)
        patch.fontSizePx = inRange(p.fontSizePx, WATERMARK_FONT_SIZE_RANGE);
      s().updateWatermark(patch);
      return { watermark: s().watermark };
    }

    case "add_clip": {
      const asset = getAsset(p.assetId, { probed: true });
      const startSec = p.startSec as number;
      if (startSec < 0 || startSec >= asset.durationSec)
        fail(`startSec must be within 0..${asset.durationSec.toFixed(1)}s for this asset`);
      // Marking an unselected asset would leave the clip invisible on the
      // source timeline — include the asset like a user checkbox click would.
      if (!asset.selected) s().toggleAssetSelected(asset.id);
      const lengthSec = (p.lengthSec as number | undefined) ?? s().settings.defaultClipLengthSec;
      const id = s().addClip(asset.id, startSec, lengthSec);
      return { clip: clipSummary(getClip(id), byId(s().assets)) };
    }

    case "update_clip": {
      const clip = getClip(p.clipId);
      if (p.startSec !== undefined || p.lengthSec !== undefined) {
        s().resizeMarker(clip.id, p.startSec ?? clip.startSec, p.lengthSec ?? clip.lengthSec);
      }
      if (p.order !== undefined) s().reorderMarker(clip.id, p.order);
      return { clip: clipSummary(getClip(clip.id), byId(s().assets)) };
    }

    case "remove_clip": {
      const clip = getClip(p.clipId);
      s().removeMarker(clip.id);
      return { removed: clip.id, remainingClips: s().markers.length };
    }

    case "set_clip_transform": {
      const clip = getClip(p.clipId);
      const patch: Record<string, number> = {};
      if (p.offsetX !== undefined) patch.offsetX = clamp(p.offsetX, -1, 1);
      if (p.offsetY !== undefined) patch.offsetY = clamp(p.offsetY, -1, 1);
      if (p.zoom !== undefined) patch.zoom = clamp(p.zoom, 1, MAX_CLIP_ZOOM);
      s().setMarkerTransform(clip.id, patch);
      return { clip: clipSummary(getClip(clip.id), byId(s().assets)) };
    }

    case "update_thumbnail": {
      const patch: Record<string, unknown> = {};
      if (p.template !== undefined) {
        oneOf(p.template, THUMBNAIL_TEMPLATES.map((t) => t.id), "template");
        patch.template = p.template;
      }
      if (p.aspectRatio !== undefined) {
        oneOf(p.aspectRatio, ASPECT_RATIOS.map((a) => a.id), "aspectRatio");
        patch.aspectRatio = p.aspectRatio;
      }
      if (p.scrim !== undefined) patch.scrim = clamp(p.scrim, 0, 0.8);
      s().updateThumbnail(patch);
      return { thumbnail: thumbnailSummary() };
    }

    case "update_thumbnail_title": {
      const patch: Record<string, unknown> = { ...(p as object) };
      if (p.align !== undefined) oneOf(p.align, ALIGNMENTS, "align");
      if (p.vAlign !== undefined) oneOf(p.vAlign, VALIGNS, "vAlign");
      if (p.headingWeight !== undefined)
        oneOf(String(p.headingWeight), HEADING_WEIGHTS.map((w) => w.id), "headingWeight");
      if (p.fontSizePx !== undefined)
        patch.fontSizePx = inRange(p.fontSizePx, THUMBNAIL_FONT_SIZE_RANGE);
      s().updateThumbnailTitle(patch);
      return { thumbnail: thumbnailSummary() };
    }

    case "add_thumbnail_frame": {
      const asset = getAsset(p.assetId, { probed: true });
      const atSec = p.atSec as number;
      if (atSec < 0 || atSec >= asset.durationSec)
        fail(`atSec must be within 0..${asset.durationSec.toFixed(1)}s for this asset`);
      // An unselected asset isn't on the source timeline, and deselecting drops
      // its frames — include it like a user checkbox click would.
      if (!asset.selected) s().toggleAssetSelected(asset.id);
      const id = s().addThumbnailFrame(asset.id, atSec);
      return { frame: frameResult(id), totalFrames: s().thumbnail.frames.length };
    }

    case "remove_thumbnail_frame": {
      const frame = getFrame(p.frameId);
      s().removeThumbnailFrame(frame.id);
      return { removed: frame.id, remainingFrames: s().thumbnail.frames.length };
    }

    case "set_thumbnail_frame_transform": {
      const frame = getFrame(p.frameId);
      const patch: Record<string, number> = {};
      if (p.offsetX !== undefined) patch.offsetX = clamp(p.offsetX, -1, 1);
      if (p.offsetY !== undefined) patch.offsetY = clamp(p.offsetY, -1, 1);
      if (p.zoom !== undefined) patch.zoom = clamp(p.zoom, 1, MAX_CLIP_ZOOM);
      s().setThumbnailFrameTransform(frame.id, patch);
      return { frame: frameResult(frame.id) };
    }

    case "export_thumbnail": {
      if (s().thumbnail.frames.length === 0)
        fail("the thumbnail has no frames — add_thumbnail_frame first");
      const format = (p.format as string | undefined) ?? "png";
      oneOf(format, IMAGE_FORMATS.map((f) => f.id), "format");
      const size = (p.size as string | undefined) ?? "1080";
      oneOf(size, THUMBNAIL_SIZES.map((x) => x.id), "size");
      const shortSide = THUMBNAIL_SIZES.find((x) => x.id === size)?.shortSide ?? 1080;
      const quality = clamp((p.quality as number | undefined) ?? 90, 30, 100);
      const outputPath = p.outputPath as string;
      await performThumbnailExport(outputPath, {
        shortSide,
        format: format as ImageFormat,
        quality,
      });
      return { outputPath, format, size, quality };
    }

    case "export_trailer": {
      if (s().markers.length === 0) fail("the trailer has no clips — add_clip first");
      const preset = (p.preset as string | undefined) ?? "standard-1080";
      oneOf(preset, EXPORT_PRESETS.map((x) => x.id), "preset");
      const codec = (p.codec as string | undefined) ?? "h264";
      oneOf(codec, ["h264", "hevc"], "codec");
      const outputPath = p.outputPath as string;
      const warning = await performExport(outputPath, {
        preset: preset as (typeof EXPORT_PRESETS)[number]["id"],
        codec: codec as "h264" | "hevc",
      });
      s().setLastExportPath(outputPath);
      return { outputPath, ...(warning ? { warning } : {}) };
    }

    default:
      fail(`unknown method "${method}"`);
  }
}
