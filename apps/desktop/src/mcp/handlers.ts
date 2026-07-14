import {
  ASPECT_RATIOS,
  type Asset,
  type ClipMarker,
  EXPORT_PRESETS,
  FIT_MODES,
  INTRO_ANIMATIONS,
  MAX_CLIP_ZOOM,
  MIN_CLIP_SEC,
  WATERMARK_POSITIONS,
  byId,
  orderedMarkers,
  trailerDuration,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { performExport } from "../exportTrailer";
import { type IngestOutcome, fileRefFromPath, isVideoPath } from "../useIngest";

/** What the bridge hook injects: ingest lives in a React hook, not the store. */
export type McpDeps = {
  ingest: (files: ReturnType<typeof fileRefFromPath>[]) => Promise<IngestOutcome>[];
};

function fail(msg: string): never {
  throw new Error(msg);
}

function oneOf(value: string, allowed: readonly string[], what: string): void {
  if (!allowed.includes(value)) fail(`${what} must be one of: ${allowed.join(", ")} (got "${value}")`);
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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

function getClip(clipId: string): ClipMarker {
  return (
    useTrailerStore.getState().markers.find((m) => m.id === clipId) ??
    fail(`no clip with id "${clipId}" — call get_project for current clip ids`)
  );
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
      const asset =
        s().assets.find((a) => a.id === p.assetId) ??
        fail(`no asset with id "${p.assetId}" — call list_assets for current ids`);
      if (asset.loading || asset.durationSec <= 0)
        fail(`asset "${asset.fileName}" is still being analyzed — retry in a moment`);
      return { path: asset.path, durationSec: asset.durationSec, fileName: asset.fileName };
    }

    case "remove_asset": {
      const asset =
        s().assets.find((a) => a.id === p.assetId) ??
        fail(`no asset with id "${p.assetId}" — call list_assets for current ids`);
      s().removeAsset(asset.id);
      return { removed: asset.id, remainingAssets: s().assets.length };
    }

    case "get_project": {
      const { settings, intro, outro, watermark, markers, assets } = s();
      const assetsById = byId(assets);
      return {
        settings,
        intro,
        outro,
        watermark,
        clips: orderedMarkers(markers).map((m) => clipSummary(m, assetsById)),
        trailerDurationSec: trailerDuration(markers),
      };
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
        patch.defaultClipLengthSec = clamp(p.defaultClipLengthSec, MIN_CLIP_SEC, 60);
      }
      if (p.flipHorizontal !== undefined) patch.flipHorizontal = p.flipHorizontal;
      s().updateSettings(patch);
      return { settings: s().settings };
    }

    case "update_intro":
    case "update_outro": {
      const patch: Record<string, unknown> = { ...(p as object) };
      if (p.align !== undefined) oneOf(p.align, ["left", "center", "right"], "align");
      if (p.vAlign !== undefined) oneOf(p.vAlign, ["top", "middle", "bottom"], "vAlign");
      if (p.animation !== undefined)
        oneOf(p.animation, INTRO_ANIMATIONS.map((a) => a.id), "animation");
      if (p.headingWeight !== undefined)
        patch.headingWeight = clamp(Math.round((p.headingWeight as number) / 100) * 100, 400, 800);
      if (p.durationSec !== undefined) patch.durationSec = clamp(p.durationSec, 0.5, 15);
      if (p.fontSizePx !== undefined) patch.fontSizePx = clamp(p.fontSizePx, 12, 300);
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
      if (p.opacity !== undefined) patch.opacity = clamp(p.opacity, 0, 1);
      if (p.fontSizePx !== undefined) patch.fontSizePx = clamp(p.fontSizePx, 8, 200);
      s().updateWatermark(patch);
      return { watermark: s().watermark };
    }

    case "add_clip": {
      const asset =
        s().assets.find((a) => a.id === p.assetId) ??
        fail(`no asset with id "${p.assetId}" — call list_assets for current ids`);
      if (asset.loading || asset.durationSec <= 0)
        fail(`asset "${asset.fileName}" is still being analyzed — retry in a moment`);
      const startSec = p.startSec as number;
      if (startSec < 0 || startSec >= asset.durationSec)
        fail(`startSec must be within 0..${asset.durationSec.toFixed(1)}s for this asset`);
      // Marking an unselected asset would leave the clip invisible on the
      // source timeline — include the asset like a user checkbox click would.
      if (!asset.selected) s().toggleAssetSelected(asset.id);
      const lengthSec = (p.lengthSec as number | undefined) ?? s().settings.defaultClipLengthSec;
      s().markClip(asset.id, startSec + lengthSec / 2, asset.durationSec);
      const created = s().markers[s().markers.length - 1]!;
      // markClip centers on a point; pin the exact requested in-point/length.
      s().resizeMarker(created.id, startSec, lengthSec);
      return { clip: clipSummary(getClip(created.id), byId(s().assets)) };
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
