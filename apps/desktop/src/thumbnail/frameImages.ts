/**
 * Frame images for the thumbnail: FFmpeg extracts the exact frame at the
 * requested width, decoded into an <img> the canvas renderer can draw.
 * Everything is cached by (path, time, width) — the preview re-renders on every
 * keystroke and must never re-shell FFmpeg for a frame it already has.
 */
import { type Asset, type ThumbnailFrame, byId, filmstripFrameAt } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../engine";
import type { LoadedFrame } from "./drawThumbnail";

/** Width the live preview extracts at — sharp enough on-screen, cheap to make. */
export const PREVIEW_FRAME_WIDTH = 720;

const decoded = new Map<string, Promise<LoadedFrame | null>>();
const extracted = new Map<string, Promise<LoadedFrame | null>>();

/** Decode a URL (data: or asset:) into a drawable image. Never rejects. */
export function loadImage(url: string): Promise<LoadedFrame | null> {
  const hit = decoded.get(url);
  if (hit) return hit;
  const p = new Promise<LoadedFrame | null>((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight, url });
    img.onerror = () => resolve(null);
    img.src = url;
  });
  decoded.set(url, p);
  return p;
}

const frameKey = (path: string, atSec: number, width: number, lossless = false) =>
  `${path}|${atSec.toFixed(3)}|${width}${lossless ? "|png" : ""}`;

/** Extract one frame via FFmpeg and decode it. Resolves to null if it fails. */
export function extractFrame(
  asset: Pick<Asset, "path" | "fileName">,
  atSec: number,
  width: number,
  opts: { lossless?: boolean } = {},
): Promise<LoadedFrame | null> {
  const key = frameKey(asset.path, atSec, width, opts.lossless);
  const hit = extracted.get(key);
  if (hit) return hit;
  const p = engine
    .frames({ path: asset.path, fileName: asset.fileName }, [atSec], {
      width,
      lossless: opts.lossless,
    })
    .then((urls) => (urls[0] ? loadImage(urls[0]) : null))
    .catch(() => null);
  extracted.set(key, p);
  return p;
}

/**
 * Drawable images for the picked frames, parallel to `frames`. Starts with the
 * filmstrip thumbnail nearest each timestamp (already in memory → instant), then
 * swaps in the sharp extracted frame as it arrives.
 */
export function useFrameImages(
  frames: ThumbnailFrame[],
  width = PREVIEW_FRAME_WIDTH,
): (LoadedFrame | null)[] {
  const assets = useTrailerStore((s) => s.assets);
  const assetsById = useMemo(() => byId(assets), [assets]);
  const [loaded, setLoaded] = useState<Record<string, LoadedFrame>>({});
  const started = useRef(new Set<string>());
  // Kicked-off loads are remembered in `started`, so a result may arrive after
  // the effect that requested it was torn down (a dependency changed, or
  // StrictMode's double-invoke). It must still land, or nothing would ever
  // re-request it and the mosaic would stay blank. Only a real unmount stops us.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const remember = (key: string) => (img: LoadedFrame | null) => {
      if (img && alive.current) setLoaded((m) => (m[key] ? m : { ...m, [key]: img }));
    };
    for (const f of frames) {
      const asset = assetsById[f.assetId];
      if (!asset) continue;
      const fallback = filmstripFrameAt(asset.filmstripUrls, f.atSec, asset.durationSec);
      if (fallback && !started.current.has(fallback)) {
        started.current.add(fallback);
        void loadImage(fallback).then(remember(fallback));
      }
      const key = frameKey(asset.path, f.atSec, width);
      if (started.current.has(key)) continue;
      started.current.add(key);
      void extractFrame(asset, f.atSec, width).then(remember(key));
    }
  }, [frames, assetsById, width]);

  return frames.map((f) => {
    const asset = assetsById[f.assetId];
    if (!asset) return null;
    const sharp = loaded[frameKey(asset.path, f.atSec, width)];
    if (sharp) return sharp;
    const fallback = filmstripFrameAt(asset.filmstripUrls, f.atSec, asset.durationSec);
    return (fallback ? loaded[fallback] : null) ?? null;
  });
}
