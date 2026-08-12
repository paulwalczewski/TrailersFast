import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type Asset,
  type ClipMarker,
  type ClipTransform,
  FIT_MODES,
  type IntroConfig,
  type Project,
  type Settings,
  type ThumbnailConfig,
  type ThumbnailFrame,
  type ThumbnailTextConfig,
  type WatermarkConfig,
  centeredClip,
  clampClipResize,
  defaultTransform,
  emptyProject,
  nextOrder,
  orderedMarkers,
} from "@trailerfast/core";

let idSeq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${idSeq++}`;

type AssetInput = Omit<
  Asset,
  "id" | "selected" | "filmstripUrls" | "posterUrl" | "loading" | "mediaLoading"
>;
type AssetProbe = Pick<Asset, "durationSec" | "width" | "height" | "fps" | "hasAudio">;
/** The `Project` fields tracked for undo/redo — the single source of truth. */
const HISTORY_KEYS = [
  "assets",
  "markers",
  "intro",
  "outro",
  "watermark",
  "settings",
  "thumbnail",
] as const;
/** The editable document tracked for undo/redo. */
type HistoryDoc = Pick<Project, (typeof HISTORY_KEYS)[number]>;

/** Which editor the window shows. The two share assets, nothing else. */
export type EditorMode = "trailer" | "thumbnail";

export type TrailerStore = Project & {
  /** UI mode, not part of the document (never recorded in undo history). */
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;

  /**
   * Start a new trailer: drop every asset, clip and picked thumbnail frame.
   * Text/watermark/export settings are preferences, so they survive. Recorded
   * as a single undo step like any other document edit.
   */
  clearProject: () => void;

  // Assets
  addAssets: (assets: AssetInput[]) => void;
  /** Add a placeholder asset immediately (loading), returning its id. */
  addPlaceholder: (path: string, fileName: string) => string;
  /** Fill in probed metadata and clear the loading state. */
  setAssetProbed: (assetId: string, probe: AssetProbe) => void;
  setAssetMedia: (
    assetId: string,
    media: { posterUrl?: string; filmstripUrls?: string[]; mediaLoading?: boolean },
  ) => void;
  toggleAssetSelected: (assetId: string) => void;
  removeAsset: (assetId: string) => void;

  // Settings
  setDefaultClipLength: (sec: number) => void;
  updateSettings: (patch: Partial<Settings>) => void;

  // Markers (clips)
  /** Add a clip with explicit bounds (clamped); returns the new marker's id. */
  addClip: (assetId: string, startSec: number, lengthSec: number) => string;
  /** Mark a clip inside an asset, centered on `localSec`, click-ordered. */
  markClip: (assetId: string, localSec: number, assetDurationSec: number) => void;
  removeMarker: (markerId: string) => void;
  /** Reorder trailer clips (drag-and-drop): move `markerId` to `toIndex`. */
  reorderMarker: (markerId: string, toIndex: number) => void;
  /** Set a clip's in-point + length (edge-resize on the trailer timeline). */
  resizeMarker: (markerId: string, startSec: number, lengthSec: number) => void;
  /** Adjust a clip's framing (pan/zoom) within the trailer canvas. */
  setMarkerTransform: (markerId: string, patch: Partial<ClipTransform>) => void;

  // Intro, outro & watermark
  updateIntro: (patch: Partial<IntroConfig>) => void;
  updateOutro: (patch: Partial<IntroConfig>) => void;
  updateWatermark: (patch: Partial<WatermarkConfig>) => void;

  // Thumbnail
  updateThumbnail: (patch: Partial<Omit<ThumbnailConfig, "title" | "frames">>) => void;
  updateThumbnailTitle: (patch: Partial<ThumbnailTextConfig>) => void;
  /** Pick a frame off the source timeline; returns the new frame's id. */
  addThumbnailFrame: (assetId: string, atSec: number) => string;
  removeThumbnailFrame: (frameId: string) => void;
  /** Replace the whole picked-frame list (e.g. "use the trailer's clips"). */
  setThumbnailFrames: (frames: { assetId: string; atSec: number }[]) => void;
  /** Adjust one frame's framing (pan/zoom) within its tile. */
  setThumbnailFrameTransform: (frameId: string, patch: Partial<ClipTransform>) => void;

  // Preview proxies (key -> proxy file path), see core `proxyKey`.
  proxies: Record<string, string>;
  setProxy: (key: string, path: string) => void;

  /** Last export destination, remembered across exports/restarts. */
  lastExportPath: string;
  setLastExportPath: (path: string) => void;

  // Undo/redo history (session-only, populated by a store subscription below).
  past: HistoryDoc[];
  future: HistoryDoc[];
  undo: () => void;
  redo: () => void;
  /** Open a single undo step, then coalesce every edit until endHistoryBatch (e.g. a resize drag). */
  beginHistoryBatch: () => void;
  endHistoryBatch: () => void;
};

const HISTORY_LIMIT = 100;
/** Set while undo/redo apply a snapshot, so the recorder ignores those changes. */
let timeTraveling = false;
/** Set between begin/endHistoryBatch so a continuous gesture records only one step. */
let suppressHistory = false;

const docOf = (s: HistoryDoc): HistoryDoc =>
  Object.fromEntries(HISTORY_KEYS.map((k) => [k, s[k]])) as HistoryDoc;
/** Structural asset signature — ignores async fields (poster/filmstrip/probe/loading). */
const assetSig = (assets: Asset[]) => assets.map((a) => `${a.id}:${a.selected ? 1 : 0}`).join(",");
/** Which tracked fields differ between two docs (assets compared structurally). */
const changedFields = (a: HistoryDoc, b: HistoryDoc): string[] =>
  HISTORY_KEYS.filter((k) =>
    // Reference check first: this runs on every store mutation (incl. per-tick
    // slider drags), so only build signatures when the array actually changed.
    k === "assets"
      ? a.assets !== b.assets && assetSig(a.assets) !== assetSig(b.assets)
      : a[k] !== b[k],
  );
/** Drop the thumbnail frames picked from an asset that's leaving the timeline. */
const withoutAssetFrames = (t: ThumbnailConfig, assetId: string): ThumbnailConfig =>
  t.frames.some((f) => f.assetId === assetId)
    ? { ...t, frames: t.frames.filter((f) => f.assetId !== assetId) }
    : t;
/** Append `snapshot` to the undo stack (bounded) and drop the redo stack. */
const pushPast = (s: { past: HistoryDoc[] }, snapshot: HistoryDoc) => ({
  past: [...s.past, snapshot].slice(-HISTORY_LIMIT),
  future: [] as HistoryDoc[],
});

export const useTrailerStore = create<TrailerStore>()(
  persist(
    (set) => ({
  ...emptyProject(),
  proxies: {},
  lastExportPath: "",

  mode: "trailer",
  setMode: (mode) => set({ mode }),

  clearProject: () =>
    set((s) => ({
      assets: [],
      markers: [],
      thumbnail: { ...s.thumbnail, frames: [] },
    })),

  setProxy: (key, path) => set((s) => ({ proxies: { ...s.proxies, [key]: path } })),
  setLastExportPath: (path) => set({ lastExportPath: path }),

  past: [],
  future: [],
  undo: () => {
    timeTraveling = true;
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1]!;
      return { ...prev, past: s.past.slice(0, -1), future: [...s.future, docOf(s)] };
    });
    timeTraveling = false;
  },
  redo: () => {
    timeTraveling = true;
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[s.future.length - 1]!;
      return { ...next, past: [...s.past, docOf(s)], future: s.future.slice(0, -1) };
    });
    timeTraveling = false;
  },
  beginHistoryBatch: () => {
    if (suppressHistory) return;
    // Snapshot the pre-gesture doc once; edits during the batch aren't recorded.
    set((s) => pushPast(s, docOf(s)));
    suppressHistory = true;
  },
  endHistoryBatch: () => {
    suppressHistory = false;
  },

  addAssets: (assets) =>
    set((s) => ({
      assets: [
        ...s.assets,
        ...assets.map((a) => ({
          ...a,
          id: uid("asset"),
          selected: true,
          filmstripUrls: [],
          loading: false,
          mediaLoading: false,
        })),
      ],
    })),

  addPlaceholder: (path, fileName) => {
    const id = uid("asset");
    set((s) => ({
      assets: [
        ...s.assets,
        {
          id,
          path,
          fileName,
          durationSec: 0,
          width: 0,
          height: 0,
          fps: 0,
          hasAudio: false,
          filmstripUrls: [],
          selected: true,
          loading: true,
          mediaLoading: true,
        },
      ],
    }));
    return id;
  },

  setAssetProbed: (assetId, probe) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === assetId ? { ...a, ...probe, loading: false } : a)),
    })),

  setAssetMedia: (assetId, media) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === assetId ? { ...a, ...media } : a)),
    })),

  toggleAssetSelected: (assetId) =>
    set((s) => {
      const deselecting = s.assets.find((a) => a.id === assetId)?.selected === true;
      return {
        assets: s.assets.map((a) => (a.id === assetId ? { ...a, selected: !a.selected } : a)),
        // Dropping an asset from the selection also drops its markers and the
        // thumbnail frames picked from it — both live on the source timeline.
        markers: deselecting ? s.markers.filter((m) => m.assetId !== assetId) : s.markers,
        thumbnail: deselecting ? withoutAssetFrames(s.thumbnail, assetId) : s.thumbnail,
      };
    }),

  removeAsset: (assetId) =>
    set((s) => ({
      assets: s.assets.filter((a) => a.id !== assetId),
      markers: s.markers.filter((m) => m.assetId !== assetId),
      thumbnail: withoutAssetFrames(s.thumbnail, assetId),
    })),

  setDefaultClipLength: (sec) =>
    set((s) => ({ settings: { ...s.settings, defaultClipLengthSec: sec } })),

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  addClip: (assetId, startSec, lengthSec) => {
    const id = uid("clip");
    set((s) => {
      const dur = s.assets.find((a) => a.id === assetId)?.durationSec ?? 0;
      const marker: ClipMarker = {
        id,
        assetId,
        ...clampClipResize(startSec, lengthSec, dur),
        order: nextOrder(s.markers),
        transform: defaultTransform(),
      };
      return { markers: [...s.markers, marker] };
    });
    return id;
  },

  markClip: (assetId, localSec, assetDurationSec) =>
    set((s) => {
      const { startSec, lengthSec } = centeredClip(
        localSec,
        assetDurationSec,
        s.settings.defaultClipLengthSec,
      );
      const marker: ClipMarker = {
        id: uid("clip"),
        assetId,
        startSec,
        lengthSec,
        order: nextOrder(s.markers),
        transform: defaultTransform(),
      };
      return { markers: [...s.markers, marker] };
    }),

  removeMarker: (markerId) =>
    set((s) => {
      const remaining = orderedMarkers(s.markers.filter((m) => m.id !== markerId));
      return { markers: remaining.map((m, i) => ({ ...m, order: i })) };
    }),

  reorderMarker: (markerId, toIndex) =>
    set((s) => {
      const ordered = orderedMarkers(s.markers);
      const from = ordered.findIndex((m) => m.id === markerId);
      if (from === -1) return {};
      const [moved] = ordered.splice(from, 1);
      ordered.splice(Math.max(0, Math.min(toIndex, ordered.length)), 0, moved!);
      return { markers: ordered.map((m, i) => ({ ...m, order: i })) };
    }),

  resizeMarker: (markerId, startSec, lengthSec) =>
    set((s) => ({
      markers: s.markers.map((m) => {
        if (m.id !== markerId) return m;
        // Enforce the bounds here so every caller (drag, undo, future
        // programmatic trims) gets a valid clip, not just the drag handler.
        const dur = s.assets.find((a) => a.id === m.assetId)?.durationSec ?? 0;
        return { ...m, ...clampClipResize(startSec, lengthSec, dur) };
      }),
    })),

  setMarkerTransform: (markerId, patch) =>
    set((s) => ({
      markers: s.markers.map((m) =>
        m.id === markerId ? { ...m, transform: { ...m.transform, ...patch } } : m,
      ),
    })),

  updateIntro: (patch) => set((s) => ({ intro: { ...s.intro, ...patch } })),

  updateOutro: (patch) => set((s) => ({ outro: { ...s.outro, ...patch } })),

  updateWatermark: (patch) => set((s) => ({ watermark: { ...s.watermark, ...patch } })),

  updateThumbnail: (patch) => set((s) => ({ thumbnail: { ...s.thumbnail, ...patch } })),

  updateThumbnailTitle: (patch) =>
    set((s) => ({ thumbnail: { ...s.thumbnail, title: { ...s.thumbnail.title, ...patch } } })),

  addThumbnailFrame: (assetId, atSec) => {
    const id = uid("frame");
    set((s) => ({
      thumbnail: {
        ...s.thumbnail,
        frames: [...s.thumbnail.frames, { id, assetId, atSec, transform: defaultTransform() }],
      },
    }));
    return id;
  },

  removeThumbnailFrame: (frameId) =>
    set((s) => ({
      thumbnail: { ...s.thumbnail, frames: s.thumbnail.frames.filter((f) => f.id !== frameId) },
    })),

  setThumbnailFrames: (frames) =>
    set((s) => ({
      thumbnail: {
        ...s.thumbnail,
        frames: frames.map((f) => ({ ...f, id: uid("frame"), transform: defaultTransform() })),
      },
    })),

  setThumbnailFrameTransform: (frameId, patch) =>
    set((s) => ({
      thumbnail: {
        ...s.thumbnail,
        frames: s.thumbnail.frames.map((f) =>
          f.id === frameId ? { ...f, transform: { ...f.transform, ...patch } } : f,
        ),
      },
    })),
    }),
    {
      name: "trailerfast",
      storage: createJSONStorage(() => localStorage),
      // Only persist the user's "details" — not assets/markers/proxies (session data).
      partialize: (s) => ({
        settings: s.settings,
        intro: s.intro,
        outro: s.outro,
        watermark: s.watermark,
        // Frames point at session-only assets — keep the styling, drop the picks.
        thumbnail: { ...s.thumbnail, frames: [] },
        lastExportPath: s.lastExportPath,
      }),
      // Deep-merge so fields added in newer versions keep their defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TrailerStore>;
        const settings = { ...current.settings, ...(p.settings ?? {}) };
        // Drop persisted values that are no longer valid (e.g. removed "stretch").
        if (!FIT_MODES.some((f) => f.id === settings.fitMode)) {
          settings.fitMode = current.settings.fitMode;
        }
        return {
          ...current,
          settings,
          intro: { ...current.intro, ...(p.intro ?? {}) },
          outro: { ...current.outro, ...(p.outro ?? {}) },
          watermark: { ...current.watermark, ...(p.watermark ?? {}) },
          thumbnail: {
            ...current.thumbnail,
            ...(p.thumbnail ?? {}),
            frames: [],
            title: { ...current.thumbnail.title, ...(p.thumbnail?.title ?? {}) },
          },
          lastExportPath: p.lastExportPath ?? current.lastExportPath,
        };
      },
    },
  ),
);

// Record undo history whenever the tracked document changes. Async media updates
// (poster/filmstrip/probe) don't change the signature, so they're ignored; undo/redo
// set `timeTraveling`, so they aren't recorded; rapid intro/watermark/settings edits
// (typing, dragging a slider) coalesce into one step.
let lastRecordAt = 0;
let lastKind = "";
/** Marker signature ignoring per-clip transforms (pan/zoom slider drags). */
const markerSig = (markers: ClipMarker[]) =>
  markers.map((m) => `${m.id}:${m.order}:${m.startSec}:${m.lengthSec}`).join(",");
/** Thumbnail-frame signature ignoring per-frame transforms (same reason). */
const frameSig = (frames: ThumbnailFrame[]) =>
  frames.map((f) => `${f.id}:${f.assetId}:${f.atSec}`).join(",");
useTrailerStore.subscribe((state, prev) => {
  if (timeTraveling || suppressHistory) return;
  const fields = changedFields(state, prev);
  if (fields.length === 0) return;
  let kind = fields.length === 1 ? fields[0]! : "mixed";
  // A markers change that only touched transforms is a slider/drag gesture.
  if (kind === "markers" && markerSig(state.markers) === markerSig(prev.markers)) {
    kind = "markerTransform";
  }
  // Picking/dropping thumbnail frames is a discrete click — never coalesce it
  // with the typing/slider edits that share the `thumbnail` field. A frames
  // change that only touched transforms IS a drag, so it coalesces.
  if (kind === "thumbnail" && state.thumbnail.frames !== prev.thumbnail.frames) {
    kind =
      frameSig(state.thumbnail.frames) === frameSig(prev.thumbnail.frames)
        ? "thumbnailFrameTransform"
        : "thumbnailFrames";
  }
  const now = Date.now();
  const coalescible =
    kind === "intro" ||
    kind === "outro" ||
    kind === "watermark" ||
    kind === "settings" ||
    kind === "thumbnail" ||
    kind === "thumbnailFrameTransform" ||
    kind === "markerTransform";
  const coalesce = coalescible && kind === lastKind && now - lastRecordAt < 700 && state.future.length === 0;
  lastRecordAt = now;
  lastKind = kind;
  if (coalesce) return;
  useTrailerStore.setState((s) => pushPast(s, docOf(prev)));
});
