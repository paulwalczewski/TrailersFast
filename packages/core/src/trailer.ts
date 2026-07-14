/**
 * Turns markers into the ordered clip list the Remotion preview (and, later,
 * the FFmpeg export) consume. Frame values are computed against the preview fps.
 */
import { type Asset, type ClipMarker, type ClipTransform, defaultTransform } from "./model";
import { orderedMarkers } from "./timeline";

export type TrailerClip = {
  markerId: string;
  assetId: string;
  /** Source video path; the UI maps this to a playable URL per platform. */
  assetPath: string;
  /** In-point within the source, in frames. */
  trimBeforeInFrames: number;
  /** Visible length, in frames. */
  durationInFrames: number;
  /** In-point + length within the source, seconds (exact marker values). */
  startSec: number;
  lengthSec: number;
  /** Source duration, seconds. */
  assetDurationSec: number;
  /** Cache key for this clip's preview proxy. */
  proxyKey: string;
  /** Framing (pan/zoom) within the trailer canvas. */
  transform: ClipTransform;
};

export function buildTrailerClips(
  markers: ClipMarker[],
  assetsById: Record<string, Asset>,
  fps: number,
): TrailerClip[] {
  return orderedMarkers(markers).map((m) => ({
    markerId: m.id,
    assetId: m.assetId,
    assetPath: assetsById[m.assetId]?.path ?? "",
    trimBeforeInFrames: Math.round(m.startSec * fps),
    durationInFrames: Math.max(1, Math.round(m.lengthSec * fps)),
    startSec: m.startSec,
    lengthSec: m.lengthSec,
    assetDurationSec: assetsById[m.assetId]?.durationSec ?? 0,
    proxyKey: proxyKey(m),
    transform: m.transform ?? defaultTransform(),
  }));
}

/** The filmstrip frame nearest a source time (undefined when none available). */
export function filmstripFrameAt(
  urls: string[],
  sec: number,
  durationSec: number,
): string | undefined {
  if (urls.length === 0 || durationSec <= 0) return undefined;
  return urls[Math.min(urls.length - 1, Math.max(0, Math.floor((sec / durationSec) * urls.length)))];
}

export function totalFrames(clips: { durationInFrames: number }[]): number {
  return clips.reduce((n, c) => n + c.durationInFrames, 0);
}

/** Stable cache key for a clip's preview proxy (source + in-point + length). */
export function proxyKey(m: { assetId: string; startSec: number; lengthSec: number }): string {
  return `${m.assetId}:${m.startSec.toFixed(3)}:${m.lengthSec.toFixed(3)}`;
}
