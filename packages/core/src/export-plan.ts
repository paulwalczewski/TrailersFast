/**
 * Resolves user-facing export options into concrete encode params, and builds
 * the platform-agnostic ExportPlan the engine executes (FFmpeg on desktop).
 */
import {
  type ExportOpts,
  type ExportPreset,
  type FitMode,
  type IntroAnimation,
  type Project,
  type Settings,
  type WatermarkPosition,
  byId,
  canvasFor,
  introActive,
  watermarkActive,
} from "./model";
import { orderedMarkers } from "./timeline";
import { type ClipCropSpec, clipCropSpec } from "./transform";

type PresetRow = { height: number; crf: number; ffPreset: string; audioKbps: number };

const PRESET_TABLE: Record<ExportPreset, PresetRow> = {
  "full-4k": { height: 2160, crf: 18, ffPreset: "slow", audioKbps: 256 },
  "full-1080": { height: 1080, crf: 18, ffPreset: "slow", audioKbps: 192 },
  "standard-1080": { height: 1080, crf: 21, ffPreset: "medium", audioKbps: 192 },
  "standard-720": { height: 720, crf: 22, ffPreset: "medium", audioKbps: 160 },
  "low-720": { height: 720, crf: 26, ffPreset: "veryfast", audioKbps: 128 },
  "low-480": { height: 480, crf: 28, ffPreset: "veryfast", audioKbps: 96 },
};

export const EXPORT_PRESETS: { id: ExportPreset; label: string; hint: string }[] = [
  { id: "full-4k", label: "Full quality — 4K", hint: "3840×2160 · CRF 18" },
  { id: "full-1080", label: "Full quality — 1080p", hint: "1920×1080 · CRF 18" },
  { id: "standard-1080", label: "Standard — 1080p", hint: "1920×1080 · CRF 21" },
  { id: "standard-720", label: "Standard — 720p", hint: "1280×720 · CRF 22" },
  { id: "low-720", label: "Lower — 720p", hint: "smaller file · CRF 26" },
  { id: "low-480", label: "Lower — 480p", hint: "smallest · CRF 28" },
];

export type ResolvedEncode = {
  width: number;
  height: number;
  fps: number;
  crf: number;
  ffPreset: string;
  vcodec: "libx264" | "libx265";
  audioKbps: number;
};

export function resolveEncode(opts: ExportOpts, settings: Settings, fps = 30): ResolvedEncode {
  const row = PRESET_TABLE[opts.preset];
  const { width, height } = canvasFor(settings.aspectRatio, row.height);
  return {
    width,
    height,
    fps,
    crf: row.crf,
    ffPreset: row.ffPreset,
    vcodec: opts.codec === "hevc" ? "libx265" : "libx264",
    audioKbps: row.audioKbps,
  };
}

export type ExportPlanClip = ClipCropSpec & {
  path: string;
  startSec: number;
  lengthSec: number;
  hasAudio: boolean;
};

export type ExportPlanIntro = {
  text: string;
  description: string;
  fontFamily: string;
  headingWeight: number;
  color: string;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  animation: IntroAnimation;
  durationSec: number;
  fontSizePx: number;
  shadowEnabled: boolean;
  shadowIntensity: number;
  shadowX: number;
  shadowY: number;
};

export type ExportPlanWatermark = {
  text: string;
  position: WatermarkPosition;
  fontSizePx: number;
  color: string;
  opacity: number;
};

export type ExportPlan = ResolvedEncode & {
  clips: ExportPlanClip[];
  intro: ExportPlanIntro | null;
  /** Base64 PNG of the intro (rendered by the UI, supports emoji); overlaid by FFmpeg. */
  introImage: string | null;
  watermark: ExportPlanWatermark | null;
  flipHorizontal: boolean;
  fitMode: FitMode;
};

/** The short-side reference the UI authors text sizes against (preview canvas). */
export const PREVIEW_SHORT_SIDE = 1080;

export function buildExportPlan(project: Project, opts: ExportOpts, fps = 30): ExportPlan {
  const assetsById = byId(project.assets);
  const enc = resolveEncode(opts, project.settings, fps);
  const clips: ExportPlanClip[] = orderedMarkers(project.markers).map((m) => {
    const a = assetsById[m.assetId];
    return {
      path: a?.path ?? "",
      startSec: m.startSec,
      lengthSec: m.lengthSec,
      hasAudio: a?.hasAudio ?? false,
      ...clipCropSpec(
        a?.width ?? 0,
        a?.height ?? 0,
        enc.width,
        enc.height,
        project.settings.fitMode,
        m.transform,
      ),
    };
  });
  // Text sizes/offsets are authored against a 1080 short side; scale to the export canvas.
  const s = Math.min(enc.width, enc.height) / PREVIEW_SHORT_SIDE;
  const px = (v: number) => Math.round(v * s);

  const clipTotal = clips.reduce((n, c) => n + c.lengthSec, 0);
  const intro: ExportPlanIntro | null =
    introActive(project.intro) && clipTotal > 0
      ? {
          text: project.intro.text,
          description: project.intro.description,
          fontFamily: project.intro.fontFamily,
          headingWeight: project.intro.headingWeight,
          color: project.intro.color,
          align: project.intro.align,
          vAlign: project.intro.vAlign,
          animation: project.intro.animation,
          durationSec: Math.min(project.intro.durationSec, clipTotal),
          fontSizePx: px(project.intro.fontSizePx),
          shadowEnabled: project.intro.shadowEnabled,
          shadowIntensity: project.intro.shadowIntensity,
          shadowX: px(project.intro.shadowX),
          shadowY: px(project.intro.shadowY),
        }
      : null;

  const wm = project.watermark;
  const watermark: ExportPlanWatermark | null = watermarkActive(wm)
    ? {
        text: wm.text,
        position: wm.position,
        fontSizePx: px(wm.fontSizePx),
        color: wm.color,
        opacity: wm.opacity,
      }
    : null;

  return {
    clips,
    intro,
    introImage: null, // filled in by the UI (canvas render) before export
    watermark,
    flipHorizontal: project.settings.flipHorizontal,
    fitMode: project.settings.fitMode,
    ...enc,
  };
}
