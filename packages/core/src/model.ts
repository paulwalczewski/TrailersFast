/**
 * Trailers Fast — core domain model.
 * Pure data types shared by the UI (Remotion preview) and the export engine
 * (FFmpeg arg builder). No platform or React dependencies live here.
 */

/** Accepted video file extensions (import filter). */
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];

/** Index a list of `{id}` items by id. */
export function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

/** Whether the intro should render (enabled + has heading or description). */
export function introActive(intro: IntroConfig): boolean {
  return intro.enabled && (intro.text.trim() !== "" || intro.description.trim() !== "");
}

/** Whether the watermark should render (enabled + has text). */
export function watermarkActive(wm: WatermarkConfig): boolean {
  return wm.enabled && wm.text.trim() !== "";
}

/** A source video the user imported. */
export type Asset = {
  id: string;
  /** Absolute path on disk (desktop) or object-URL/key (web). */
  path: string;
  fileName: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Single poster frame for the asset card. */
  posterUrl?: string;
  /** Thumbnail strip along the source timeline. */
  filmstripUrls: string[];
  /** The checkbox in the asset card corner. */
  selected: boolean;
  /** True while metadata is still being probed (shows a placeholder card). */
  loading: boolean;
  /** True while the poster/filmstrip thumbnails are still being generated. */
  mediaLoading: boolean;
};

/**
 * Per-clip framing within the trailer canvas. Offsets are normalized against
 * the overflow (how far the fitted clip extends past the canvas), so every
 * value in [-1, 1] keeps the canvas fully covered — no black space possible.
 */
export type ClipTransform = {
  /** Pan across the horizontal overflow: -1 = left edge, 0 = center, 1 = right edge. */
  offsetX: number;
  /** Pan across the vertical overflow: -1 = top edge, 0 = center, 1 = bottom edge. */
  offsetY: number;
  /** Extra zoom on top of the fit, 1..MAX_CLIP_ZOOM. */
  zoom: number;
};

export const MAX_CLIP_ZOOM = 3;

export const defaultTransform = (): ClipTransform => ({ offsetX: 0, offsetY: 0, zoom: 1 });

export const isDefaultTransform = (t: ClipTransform): boolean =>
  t.offsetX === 0 && t.offsetY === 0 && t.zoom === 1;

/** One marked segment that will appear in the final trailer. */
export type ClipMarker = {
  id: string;
  assetId: string;
  /** In-point within the asset, seconds. */
  startSec: number;
  /** Clip length, seconds — inherited from settings at creation time. */
  lengthSec: number;
  /** Position in the final trailer. Assigned in click order; mutable via drag. */
  order: number;
  /** Framing (pan/zoom) within the trailer canvas. */
  transform: ClipTransform;
};

export type IntroAnimation = "fade" | "slideLeft" | "slideUp" | "scale";

export type IntroConfig = {
  enabled: boolean;
  /** Heading line. */
  text: string;
  /** Optional longer description line below the heading. */
  description: string;
  fontFamily: string;
  /** CSS font weight for the heading (400–800). */
  headingWeight: number;
  fontSizePx: number;
  color: string;
  /** Horizontal alignment. */
  align: "left" | "center" | "right";
  /** Vertical alignment. */
  vAlign: "top" | "middle" | "bottom";
  animation: IntroAnimation;
  durationSec: number;
  /** Drop shadow behind the intro text. */
  shadowEnabled: boolean;
  /** Shadow opacity, 0..1. */
  shadowIntensity: number;
  /** Shadow offset in px (canvas units). */
  shadowX: number;
  shadowY: number;
};

/** Curated font list for the intro — Avenir first, then popular web/desktop fonts. */
export const INTRO_FONTS: string[] = [
  "Avenir Next",
  "Avenir",
  "Helvetica Neue",
  "Futura",
  "Gill Sans",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Trebuchet MS",
  "Courier New",
  "Impact",
  "Inter",
];

export const HEADING_WEIGHTS: { id: string; label: string }[] = [
  { id: "400", label: "Regular" },
  { id: "500", label: "Medium" },
  { id: "600", label: "Semibold" },
  { id: "700", label: "Bold" },
  { id: "800", label: "Extrabold" },
];

export const INTRO_ANIMATIONS: { id: IntroAnimation; label: string }[] = [
  { id: "fade", label: "Fade" },
  { id: "slideLeft", label: "Slide in" },
  { id: "slideUp", label: "Slide up" },
  { id: "scale", label: "Zoom" },
];

export type ExportPreset =
  | "full-4k"
  | "full-1080"
  | "standard-1080"
  | "standard-720"
  | "low-720"
  | "low-480";

export type ExportCodec = "h264" | "hevc" | "av1";

export type ExportOpts = {
  preset: ExportPreset;
  codec: ExportCodec;
  container: "mp4";
};

export const ASPECT_RATIOS = [
  { id: "16:9", label: "16:9 — Landscape", w: 16, h: 9 },
  { id: "9:16", label: "9:16 — Vertical", w: 9, h: 16 },
  { id: "1:1", label: "1:1 — Square", w: 1, h: 1 },
  { id: "4:5", label: "4:5 — Portrait", w: 4, h: 5 },
  { id: "4:3", label: "4:3 — Classic", w: 4, h: 3 },
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number]["id"];

export const FIT_MODES = [
  { id: "cover", label: "Cover — crop to fill" },
  { id: "contain", label: "Contain — fit, letterbox" },
] as const;
export type FitMode = (typeof FIT_MODES)[number]["id"];

/** Canvas dimensions for an aspect ratio with the short side = `shortSide` px (even). */
export function canvasFor(ar: AspectRatio, shortSide: number): { width: number; height: number } {
  const { w, h } = ASPECT_RATIOS.find((a) => a.id === ar) ?? ASPECT_RATIOS[0];
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return w >= h
    ? { width: even((shortSide * w) / h), height: even(shortSide) }
    : { width: even(shortSide), height: even((shortSide * h) / w) };
}

export type Settings = {
  /** Default trailer clip length, seconds. */
  defaultClipLengthSec: number;
  /** Mirror every clip horizontally. */
  flipHorizontal: boolean;
  /** Output aspect ratio. */
  aspectRatio: AspectRatio;
  /** How a clip fits the canvas when its ratio differs. */
  fitMode: FitMode;
};

export type Project = {
  assets: Asset[];
  markers: ClipMarker[];
  intro: IntroConfig;
  /** Same shape as the intro — a title card over the last seconds of the trailer. */
  outro: IntroConfig;
  watermark: WatermarkConfig;
  settings: Settings;
};

export const DEFAULT_CLIP_LENGTH_SEC = 3;

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const WATERMARK_POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "top-right", label: "Top right" },
  { id: "top-left", label: "Top left" },
];

/** A text watermark shown across the whole trailer. */
export type WatermarkConfig = {
  enabled: boolean;
  text: string;
  position: WatermarkPosition;
  fontSizePx: number;
  color: string;
  /** 0..1 */
  opacity: number;
};

export const defaultWatermark = (): WatermarkConfig => ({
  enabled: false,
  text: "",
  position: "bottom-right",
  fontSizePx: 32,
  color: "#ffffff",
  opacity: 0.8,
});

export const defaultIntro = (): IntroConfig => ({
  enabled: false,
  text: "",
  description: "",
  fontFamily: "Avenir Next",
  headingWeight: 700,
  fontSizePx: 72,
  color: "#ffffff",
  align: "center",
  vAlign: "middle",
  animation: "fade",
  durationSec: 3,
  shadowEnabled: true,
  shadowIntensity: 0.55,
  shadowX: 2,
  shadowY: 2,
});

/** Outros share the intro's config shape and defaults. */
export const defaultOutro = (): IntroConfig => defaultIntro();

export const emptyProject = (): Project => ({
  assets: [],
  markers: [],
  intro: defaultIntro(),
  outro: defaultOutro(),
  watermark: defaultWatermark(),
  settings: {
    defaultClipLengthSec: DEFAULT_CLIP_LENGTH_SEC,
    flipHorizontal: false,
    aspectRatio: "16:9",
    fitMode: "cover",
  },
});
