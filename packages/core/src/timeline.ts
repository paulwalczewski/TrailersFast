/**
 * Source-timeline math: the selected assets are laid end-to-end in full, and
 * the user clicks a spot to mark a clip. A click CENTERS a clip on the cursor,
 * clamped to the asset's start/end so the clip always stays in bounds.
 */
import type { Asset, ClipMarker } from "./model";

/** An asset placed on the global source timeline with its absolute offset. */
export type PlacedAsset = { asset: Asset; startSec: number; endSec: number };

/** Lay the selected assets end-to-end, in their given order. */
export function placeAssets(assets: Asset[]): PlacedAsset[] {
  const placed: PlacedAsset[] = [];
  let cursor = 0;
  for (const asset of assets) {
    if (!asset.selected) continue;
    placed.push({ asset, startSec: cursor, endSec: cursor + asset.durationSec });
    cursor += asset.durationSec;
  }
  return placed;
}

export function totalDuration(placed: PlacedAsset[]): number {
  return placed.length ? placed[placed.length - 1]!.endSec : 0;
}

/** Which placed asset covers a global timeline time. */
export function assetAt(placed: PlacedAsset[], globalSec: number): PlacedAsset | undefined {
  return placed.find((p) => globalSec >= p.startSec && globalSec < p.endSec);
}

/**
 * Given a click at `localSec` inside an asset of `assetDurationSec`, return the
 * in-point + length of a clip of `lengthSec` CENTERED on the click and clamped
 * to [0, assetDuration]. If the asset is shorter than the clip, the clip spans
 * the whole asset.
 */
export function centeredClip(
  localSec: number,
  assetDurationSec: number,
  lengthSec: number,
): { startSec: number; lengthSec: number } {
  const length = Math.min(lengthSec, assetDurationSec);
  const half = length / 2;
  let start = localSec - half;
  if (start < 0) start = 0;
  if (start + length > assetDurationSec) start = assetDurationSec - length;
  return { startSec: start, lengthSec: length };
}

/** Next order index for a new marker (click order). */
export function nextOrder(markers: ClipMarker[]): number {
  return markers.reduce((max, m) => Math.max(max, m.order), -1) + 1;
}

/** Markers sorted by their trailer order. */
export function orderedMarkers(markers: ClipMarker[]): ClipMarker[] {
  return [...markers].sort((a, b) => a.order - b.order);
}

/** Total runtime of the assembled trailer (sum of clip lengths; intro overlays). */
export function trailerDuration(markers: ClipMarker[]): number {
  return markers.reduce((sum, m) => sum + m.lengthSec, 0);
}
