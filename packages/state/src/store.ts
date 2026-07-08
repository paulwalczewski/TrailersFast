import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type Asset,
  type ClipMarker,
  type IntroConfig,
  type Project,
  type Settings,
  type WatermarkConfig,
  centeredClip,
  emptyProject,
  nextOrder,
  orderedMarkers,
} from "@trailerfast/core";

let idSeq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${idSeq++}`;

type AssetInput = Omit<Asset, "id" | "selected" | "filmstripUrls" | "posterUrl" | "loading">;
type AssetProbe = Pick<Asset, "durationSec" | "width" | "height" | "fps" | "hasAudio">;

export type TrailerStore = Project & {
  // Assets
  addAssets: (assets: AssetInput[]) => void;
  /** Add a placeholder asset immediately (loading), returning its id. */
  addPlaceholder: (path: string, fileName: string) => string;
  /** Fill in probed metadata and clear the loading state. */
  setAssetProbed: (assetId: string, probe: AssetProbe) => void;
  setAssetMedia: (assetId: string, media: { posterUrl?: string; filmstripUrls?: string[] }) => void;
  toggleAssetSelected: (assetId: string) => void;
  removeAsset: (assetId: string) => void;

  // Settings
  setDefaultClipLength: (sec: number) => void;
  updateSettings: (patch: Partial<Settings>) => void;

  // Markers (clips)
  /** Mark a clip inside an asset, centered on `localSec`, click-ordered. */
  markClip: (assetId: string, localSec: number, assetDurationSec: number) => void;
  removeMarker: (markerId: string) => void;
  /** Reorder trailer clips (drag-and-drop): move `markerId` to `toIndex`. */
  reorderMarker: (markerId: string, toIndex: number) => void;

  // Intro & watermark
  updateIntro: (patch: Partial<IntroConfig>) => void;
  updateWatermark: (patch: Partial<WatermarkConfig>) => void;

  // Preview proxies (key -> proxy file path), see core `proxyKey`.
  proxies: Record<string, string>;
  setProxy: (key: string, path: string) => void;

  /** Last export destination, remembered across exports/restarts. */
  lastExportPath: string;
  setLastExportPath: (path: string) => void;
};

export const useTrailerStore = create<TrailerStore>()(
  persist(
    (set) => ({
  ...emptyProject(),
  proxies: {},
  lastExportPath: "",

  setProxy: (key, path) => set((s) => ({ proxies: { ...s.proxies, [key]: path } })),
  setLastExportPath: (path) => set({ lastExportPath: path }),

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
    set((s) => ({
      assets: s.assets.map((a) => (a.id === assetId ? { ...a, selected: !a.selected } : a)),
      // Dropping an asset from the selection also drops its markers.
      markers: s.assets.find((a) => a.id === assetId)?.selected
        ? s.markers.filter((m) => m.assetId !== assetId)
        : s.markers,
    })),

  removeAsset: (assetId) =>
    set((s) => ({
      assets: s.assets.filter((a) => a.id !== assetId),
      markers: s.markers.filter((m) => m.assetId !== assetId),
    })),

  setDefaultClipLength: (sec) =>
    set((s) => ({ settings: { ...s.settings, defaultClipLengthSec: sec } })),

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

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

  updateIntro: (patch) => set((s) => ({ intro: { ...s.intro, ...patch } })),

  updateWatermark: (patch) => set((s) => ({ watermark: { ...s.watermark, ...patch } })),
    }),
    {
      name: "trailerfast",
      storage: createJSONStorage(() => localStorage),
      // Only persist the user's "details" — not assets/markers/proxies (session data).
      partialize: (s) => ({
        settings: s.settings,
        intro: s.intro,
        watermark: s.watermark,
        lastExportPath: s.lastExportPath,
      }),
      // Deep-merge so fields added in newer versions keep their defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TrailerStore>;
        return {
          ...current,
          settings: { ...current.settings, ...(p.settings ?? {}) },
          intro: { ...current.intro, ...(p.intro ?? {}) },
          watermark: { ...current.watermark, ...(p.watermark ?? {}) },
          lastExportPath: p.lastExportPath ?? current.lastExportPath,
        };
      },
    },
  ),
);
