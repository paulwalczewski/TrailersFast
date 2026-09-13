import { type PlacedAsset, placeAssets, totalDuration } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type MouseEvent, useCallback, useRef, useState } from "react";
import { Playhead } from "../ui/Playhead";
import { ScrubRuler, useScrubRuler } from "../ui/ScrubRuler";
import { MediaLoadingPlaceholder } from "../ui/Spinner";
import { TimelineCursor, TRASH_PATH, useTimelineCursor } from "../ui/TimelineCursor";

type Props = { playheadSec: number; onScrub: (sec: number) => void };

/**
 * The source filmstrip in Thumbnail mode: clicking picks the frame under the
 * cursor into the thumbnail (numbered in pick order — that's the mosaic order);
 * clicking a pick removes it. Same timeline as the trailer's, points not ranges.
 */
export function ThumbnailSourceTimeline({ playheadSec, onScrub }: Props) {
  const assets = useTrailerStore((s) => s.assets);
  const frames = useTrailerStore((s) => s.thumbnail.frames);
  const addFrame = useTrailerStore((s) => s.addThumbnailFrame);
  const removeFrame = useTrailerStore((s) => s.removeThumbnailFrame);

  const placed = placeAssets(assets);
  const total = totalDuration(placed);
  const containerRef = useRef<HTMLDivElement>(null);
  const ruler = useScrubRuler(useCallback((frac) => onScrub(frac * total), [onScrub, total]));
  const cursor = useTimelineCursor(containerRef);
  const [overFrame, setOverFrame] = useState(false);

  if (placed.length === 0) {
    return (
      <div className="grid min-h-28 place-items-center rounded-xl border border-separator bg-surface text-sm text-muted">
        Select videos in the Assets tab — they appear here to pick thumbnail frames.
      </div>
    );
  }

  /** Seconds within the asset at the pointer, from a click on its block. */
  function localSecOf(e: MouseEvent<HTMLDivElement>, p: PlacedAsset): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return frac * p.asset.durationSec;
  }

  const frac = total > 0 ? playheadSec / total : 0;

  return (
    <div ref={containerRef} className="relative rounded-xl border border-separator bg-surface p-2">
      <ScrubRuler ruler={ruler} title="Drag to scrub the source" />

      <div
        className="flex h-16 cursor-none items-stretch gap-1"
        onMouseMove={cursor.onMouseMove}
        onMouseLeave={() => {
          cursor.hide();
          setOverFrame(false);
        }}
      >
        {placed.map((p) => {
          const picks = frames
            .map((f, i) => ({ frame: f, index: i }))
            .filter((x) => x.frame.assetId === p.asset.id);
          return (
            <div
              key={p.asset.id}
              onClick={(e) => addFrame(p.asset.id, localSecOf(e, p))}
              onMouseMove={(e) => onScrub(p.startSec + localSecOf(e, p))}
              className="relative flex min-w-0 items-stretch overflow-hidden rounded-lg border border-border bg-surface-secondary"
              style={{ flex: `${p.asset.durationSec} 1 0%` }}
              title="Click to add this frame to the thumbnail"
            >
              {p.asset.filmstripUrls.length > 0 ? (
                <div className="pointer-events-none flex size-full">
                  {p.asset.filmstripUrls.map((u, i) => (
                    <img key={i} src={u} alt="" className="h-full min-w-0 flex-1 object-cover" />
                  ))}
                </div>
              ) : p.asset.mediaLoading ? (
                <MediaLoadingPlaceholder />
              ) : (
                <div className="pointer-events-none grid size-full place-items-center text-xs text-muted">
                  …
                </div>
              )}

              {picks.map(({ frame, index }) => (
                <button
                  key={frame.id}
                  type="button"
                  onMouseEnter={() => setOverFrame(true)}
                  onMouseLeave={() => setOverFrame(false)}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFrame(frame.id);
                  }}
                  className="group absolute inset-y-0 w-1 -translate-x-1/2 bg-accent transition-colors hover:bg-danger"
                  style={{ left: `${(frame.atSec / p.asset.durationSec) * 100}%` }}
                  title={`Frame ${index + 1} at ${frame.atSec.toFixed(1)}s — click to remove`}
                >
                  <span className="absolute -top-0.5 left-1/2 grid size-4 -translate-x-1/2 place-items-center rounded-full bg-accent text-[9px] font-semibold text-white group-hover:bg-danger">
                    {index + 1}
                  </span>
                </button>
              ))}

              <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded bg-black/50 px-1 text-[10px] text-white">
                {p.asset.fileName}
              </span>
            </div>
          );
        })}
      </div>

      {/* Playhead spanning ruler + filmstrip */}
      <Playhead frac={frac} />

      {/* Custom cursor: add-frame (accent +) or remove (red trash) over a pick */}
      <TimelineCursor position={cursor.position} danger={overFrame}>
        {overFrame ? (
          <path d={TRASH_PATH} />
        ) : (
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M12 9v6M9 12h6" />
          </>
        )}
      </TimelineCursor>
    </div>
  );
}
