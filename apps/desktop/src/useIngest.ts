import { VIDEO_EXTENSIONS } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import type { FileRef } from "@trailerfast/video-engine";
import { useCallback } from "react";
import { engine, isTauri } from "./engine";

const FILMSTRIP_FRAMES = 8;

export function isVideoPath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.includes(ext);
}

export function fileRefFromPath(path: string): FileRef {
  return { path, fileName: path.split(/[/\\]/).pop() ?? path };
}

/**
 * Adds placeholder cards immediately (instant feedback), then probes metadata
 * and generates thumbnails in the background, updating each card as it resolves.
 */
export function useIngest(): (files: FileRef[]) => void {
  const addPlaceholder = useTrailerStore((s) => s.addPlaceholder);
  const setAssetProbed = useTrailerStore((s) => s.setAssetProbed);
  const setAssetMedia = useTrailerStore((s) => s.setAssetMedia);

  return useCallback(
    (files: FileRef[]) => {
      for (const f of files) {
        const id = addPlaceholder(f.path, f.fileName);
        void (async () => {
          try {
            const info = await engine.probe(f);
            setAssetProbed(id, info);
            const times = Array.from({ length: FILMSTRIP_FRAMES }, (_, i) =>
              Math.max(0, (info.durationSec * (i + 0.5)) / FILMSTRIP_FRAMES),
            );
            const urls = await engine.thumbnails(f, times);
            setAssetMedia(id, { filmstripUrls: urls, posterUrl: urls[0] });
          } catch (err) {
            console.error(`Failed to import ${f.fileName}`, err);
          }
        })();
      }
    },
    [addPlaceholder, setAssetProbed, setAssetMedia],
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
