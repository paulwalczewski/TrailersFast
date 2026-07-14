import { VIDEO_EXTENSIONS } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import type { FileRef } from "@trailerfast/video-engine";
import { useCallback } from "react";
import { engine, isTauri } from "./engine";

const FILMSTRIP_FRAMES = 8;

/**
 * Cap concurrent thumbnail jobs so dropping many files doesn't spawn dozens of
 * FFmpeg processes at once (each extraction is its own process). Probes are not
 * gated — they're near-instant and fill in duration/dimensions right away.
 */
const MAX_CONCURRENT_THUMBNAIL_JOBS = 3;
let activeThumbnailJobs = 0;
const thumbnailQueue: Array<() => void> = [];

function acquireThumbnailSlot(): Promise<void> {
  if (activeThumbnailJobs < MAX_CONCURRENT_THUMBNAIL_JOBS) {
    activeThumbnailJobs++;
    return Promise.resolve();
  }
  return new Promise((resolve) =>
    thumbnailQueue.push(() => {
      activeThumbnailJobs++;
      resolve();
    }),
  );
}

function releaseThumbnailSlot(): void {
  activeThumbnailJobs--;
  thumbnailQueue.shift()?.();
}

export function isVideoPath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.includes(ext);
}

export function fileRefFromPath(path: string): FileRef {
  return { path, fileName: path.split(/[/\\]/).pop() ?? path };
}

/** Per-file import outcome, resolved once metadata is probed. */
export type IngestOutcome = { id: string; fileName: string; ok: boolean; error?: string };

/**
 * Adds placeholder cards immediately (instant feedback), then probes metadata
 * and generates thumbnails in the background, updating each card as it resolves.
 * Returns one promise per file that settles when its probe completes (thumbnails
 * keep generating afterwards) — UI callers ignore them; the MCP bridge awaits them.
 */
export function useIngest(): (files: FileRef[]) => Promise<IngestOutcome>[] {
  const addPlaceholder = useTrailerStore((s) => s.addPlaceholder);
  const setAssetProbed = useTrailerStore((s) => s.setAssetProbed);
  const setAssetMedia = useTrailerStore((s) => s.setAssetMedia);
  const removeAsset = useTrailerStore((s) => s.removeAsset);

  return useCallback(
    (files: FileRef[]) =>
      files.map(async (f): Promise<IngestOutcome> => {
        const id = addPlaceholder(f.path, f.fileName);
        let info;
        try {
          info = await engine.probe(f);
          setAssetProbed(id, info);
        } catch (err) {
          console.error(`Failed to import ${f.fileName}`, err);
          removeAsset(id);
          return { id, fileName: f.fileName, ok: false, error: String(err) };
        }

        // Thumbnails are cosmetic — a failure logs but keeps the asset.
        void (async () => {
          const times = Array.from({ length: FILMSTRIP_FRAMES }, (_, i) =>
            Math.max(0, (info.durationSec * (i + 0.5)) / FILMSTRIP_FRAMES),
          );
          await acquireThumbnailSlot();
          try {
            // Poster first, so the card gets an image as soon as possible…
            const [poster] = await engine.thumbnails(f, times.slice(0, 1));
            if (poster) setAssetMedia(id, { posterUrl: poster });
            // …then the rest of the filmstrip.
            const rest = await engine.thumbnails(f, times.slice(1));
            const urls = poster ? [poster, ...rest] : rest;
            setAssetMedia(id, { filmstripUrls: urls, posterUrl: urls[0], mediaLoading: false });
          } catch (err) {
            console.error(`Thumbnails failed for ${f.fileName}`, err);
            setAssetMedia(id, { mediaLoading: false });
          } finally {
            releaseThumbnailSlot();
          }
        })();

        return { id, fileName: f.fileName, ok: true };
      }),
    [addPlaceholder, setAssetProbed, setAssetMedia, removeAsset],
  );
}

/** Opens the OS file picker (or adds a demo clip in `dev:web`) and ingests the result. */
export function useBrowseAssets(): () => Promise<void> {
  const assets = useTrailerStore((s) => s.assets);
  const addAssets = useTrailerStore((s) => s.addAssets);
  const ingest = useIngest();

  return useCallback(async () => {
    if (!isTauri()) {
      const n = assets.length + 1;
      addAssets([
        {
          path: `demo-${n}.mp4`,
          fileName: `demo_clip_${n}.mp4`,
          durationSec: 24 + n * 6,
          width: 1920,
          height: 1080,
          fps: 30,
          hasAudio: true,
        },
      ]);
      return;
    }
    const files = await engine.pickFiles();
    if (files.length) ingest(files);
  }, [assets.length, addAssets, ingest]);
}
