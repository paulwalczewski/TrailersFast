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

/** Title-card text alignments — the UI buttons and MCP validation share these. */
export const ALIGNMENTS = ["left", "center", "right"] as const;
export const VALIGNS = ["top", "middle", "bottom"] as const;
export type Align = (typeof ALIGNMENTS)[number];
export type VAlign = (typeof VALIGNS)[number];

/** Value ranges shared by the settings sliders and MCP input clamping. */
export const TITLE_CARD_DURATION_RANGE = [1, 10] as const;
export const TITLE_CARD_FONT_SIZE_RANGE = [20, 160] as const;
export const WATERMARK_FONT_SIZE_RANGE = [12, 96] as const;
export const WATERMARK_OPACITY_RANGE = [0.1, 1] as const;
export const CLIP_LENGTH_RANGE = [1, 10] as const;
/** Thumbnail titles run bigger than trailer title cards — one glanceable line. */
export const THUMBNAIL_FONT_SIZE_RANGE = [24, 240] as const;
export const SHADOW_INTENSITY_RANGE = [0, 1] as const;
export const SHADOW_OFFSET_RANGE = [-15, 15] as const;

/**
 * Drop shadow behind overlaid text — shared by the title cards, the watermark
 * and the thumbnail title. Hard-edged (no blur) so the CSS preview, the canvas
 * render and FFmpeg's `drawtext` shadowx/shadowy all produce the same pixels.
 */
export type ShadowConfig = {
  shadowEnabled: boolean;
  /** Shadow opacity, 0..1. */
  shadowIntensity: number;
  /** Shadow offset in px (canvas units). */
  shadowX: number;
  shadowY: number;
};

export const defaultShadow = (): ShadowConfig => ({
  shadowEnabled: true,
  shadowIntensity: 0.55,
  shadowX: 2,
  shadowY: 2,
});

export type IntroConfig = ShadowConfig & {
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
  align: Align;
  /** Vertical alignment. */
  vAlign: VAlign;
  animation: IntroAnimation;
  durationSec: number;
};

/**
 * Curated font list shared by the intro/outro cards, the watermark and the
 * thumbnail title. Avenir first, then popular web/desktop fonts, then a group
 * of decorative / hand-written faces for a more expressive look.
 */
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
  // Bundled decorative / hand-written faces — embedded with the app (OFL/Apache),
  // so they render identically in the preview, thumbnail and export on every OS.
  "Pacifico",
  "Permanent Marker",
  "Great Vibes",
  "Lobster",
  "Bangers",
  "Sacramento",
  "Kalam",
  // Decorative / hand-written (macOS system faces; render in the canvas preview
  // and thumbnail, and are mapped to font files for the FFmpeg trailer export).
  "Bradley Hand",
  "Marker Felt",
  "Noteworthy",
  "Chalkboard SE",
  "Snell Roundhand",
  "Brush Script MT",
  "Zapfino",
  "Comic Sans MS",
  "Papyrus",
  "Apple Chancery",
];

/** `INTRO_FONTS` as `{ id, label }` options, shared by every font picker. */
export const FONT_OPTIONS = INTRO_FONTS.map((f) => ({ id: f, label: f }));

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
  /** The still image built from the same assets — see the Thumbnail mode. */
  thumbnail: ThumbnailConfig;
};

/**
 * Thumbnail mode. A still image built from frames picked off the same source
 * timeline the trailer uses, arranged by a template, with a title on top.
 */

/** Layouts the picked frames can be arranged in. `single` uses the first frame. */
export const THUMBNAIL_TEMPLATES = [
  {
    id: "mosaic",
    label: "Mosaic",
    hint: "Every picked frame, tiled edge-to-edge as the background",
  },
  {
    id: "stripes-horizontal",
    label: "Horizontal stripes",
    hint: "Full-width bands, stacked top to bottom",
  },
  {
    id: "stripes-vertical",
    label: "Vertical stripes",
    hint: "Full-height columns, left to right",
  },
  { id: "single", label: "Single frame", hint: "Just the first picked frame, full bleed" },
] as const;
export type ThumbnailTemplate = (typeof THUMBNAIL_TEMPLATES)[number]["id"];

/** Output sizes, expressed as the short side (the aspect ratio sets the rest). */
export const THUMBNAIL_SIZES = [
  { id: "720", label: "720p", shortSide: 720 },
  { id: "1080", label: "1080p", shortSide: 1080 },
  { id: "1440", label: "1440p", shortSide: 1440 },
  { id: "2160", label: "4K", shortSide: 2160 },
] as const;
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number]["id"];

/** Encoders the export can target. Availability is probed at runtime (FFmpeg build). */
export const IMAGE_FORMATS = [
  { id: "png", label: "PNG", ext: "png", hint: "lossless, largest", lossless: true },
  { id: "jpeg", label: "JPEG", ext: "jpg", hint: "plays everywhere", lossless: false },
  { id: "webp", label: "WebP", ext: "webp", hint: "smaller, modern", lossless: false },
  { id: "avif", label: "AVIF", ext: "avif", hint: "smallest, newest", lossless: false },
] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number]["id"];

/** One frame picked off the source timeline, in click order. */
export type ThumbnailFrame = {
  id: string;
  assetId: string;
  /** Timestamp within the asset. */
  atSec: number;
  /** Framing (pan/zoom) within the tile the template gives it. */
  transform: ClipTransform;
};

/** The heading + description drawn over the thumbnail background. */
export type ThumbnailTextConfig = ShadowConfig & {
  enabled: boolean;
  /** Heading line. */
  text: string;
  /** Optional longer line below the heading. */
  description: string;
  fontFamily: string;
  /** CSS font weight for the heading (400–800). */
  headingWeight: number;
  fontSizePx: number;
  color: string;
  align: Align;
  vAlign: VAlign;
};

export type ThumbnailConfig = {
  template: ThumbnailTemplate;
  /** Independent of the trailer's — a 9:16 trailer can still have a 16:9 thumbnail. */
  aspectRatio: AspectRatio;
  /** Frames picked off the source timeline, in click order. */
  frames: ThumbnailFrame[];
  /** Dark scrim over the background, 0..1 — keeps the title readable. */
  scrim: number;
  title: ThumbnailTextConfig;
};

/** Whether the title should render (enabled + has heading or description). */
export function thumbnailTextActive(t: ThumbnailTextConfig): boolean {
  return t.enabled && (t.text.trim() !== "" || t.description.trim() !== "");
}

export const defaultThumbnailText = (): ThumbnailTextConfig => ({
  enabled: true,
  text: "",
  description: "",
  fontFamily: "Avenir Next",
  headingWeight: 800,
  fontSizePx: 96,
  color: "#ffffff",
  align: "center",
  vAlign: "middle",
  ...defaultShadow(),
});

export const defaultThumbnail = (): ThumbnailConfig => ({
  template: "mosaic",
  aspectRatio: "16:9",
  frames: [],
  scrim: 0.25,
  title: defaultThumbnailText(),
});

export const DEFAULT_CLIP_LENGTH_SEC = 3;

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const WATERMARK_POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "top-right", label: "Top right" },
  { id: "top-left", label: "Top left" },
];

/** A text watermark shown across the whole trailer. */
export type WatermarkConfig = ShadowConfig & {
  enabled: boolean;
  text: string;
  position: WatermarkPosition;
  fontFamily: string;
  fontSizePx: number;
  color: string;
  /** 0..1 */
  opacity: number;
};

export const defaultWatermark = (): WatermarkConfig => ({
  enabled: false,
  text: "",
  position: "bottom-right",
  fontFamily: "Avenir Next",
  fontSizePx: 32,
  color: "#ffffff",
  opacity: 0.8,
  ...defaultShadow(),
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
  ...defaultShadow(),
});

export const emptyProject = (): Project => ({
  assets: [],
  markers: [],
  intro: defaultIntro(),
  // Outros share the intro's config shape and defaults.
  outro: defaultIntro(),
  watermark: defaultWatermark(),
  settings: {
    defaultClipLengthSec: DEFAULT_CLIP_LENGTH_SEC,
    flipHorizontal: false,
    aspectRatio: "16:9",
    fitMode: "cover",
  },
  thumbnail: defaultThumbnail(),
});
