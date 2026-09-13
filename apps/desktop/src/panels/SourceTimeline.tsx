import { centeredClip, type PlacedAsset, placeAssets, totalDuration } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type MouseEvent, useCallback, useRef, useState } from "react";
import { Playhead } from "../ui/Playhead";
import { ScrubRuler, useScrubRuler } from "../ui/ScrubRuler";
import { MediaLoadingPlaceholder } from "../ui/Spinner";
import { TimelineCursor, TRASH_PATH, useTimelineCursor } from "../ui/TimelineCursor";

type Props = { playheadSec: number; onScrub: (sec: number) => void };
type Ghost = { assetId: string; left: number; width: number };

export function SourceTimeline({ playheadSec, onScrub }: Props) {
  const assets = useTrailerStore((s) => s.assets);
  const markers = useTrailerStore((s) => s.markers);
  const clipLen = useTrailerStore((s) => s.settings.defaultClipLengthSec);
  const markClip = useTrailerStore((s) => s.markClip);
  const removeMarker = useTrailerStore((s) => s.removeMarker);

  const placed = placeAssets(assets);
  const total = totalDuration(placed);
  const containerRef = useRef<HTMLDivElement>(null);
  const ruler = useScrubRuler(useCallback((frac) => onScrub(frac * total), [onScrub, total]));
  const cursor = useTimelineCursor(containerRef);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [overMarker, setOverMarker] = useState(false);

  if (placed.length === 0) {
    return (
      <div className="grid min-h-28 place-items-center rounded-xl border border-separator bg-surface text-sm text-muted">
        Select videos in the Assets tab — they appear here to mark clips.
      </div>
    );
  }

  function onBlockMove(e: MouseEvent<HTMLDivElement>, p: PlacedAsset) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const localSec = frac * p.asset.durationSec;
    const clip = centeredClip(localSec, p.asset.durationSec, clipLen);
    setGhost({
      assetId: p.asset.id,
      left: (clip.startSec / p.asset.durationSec) * 100,
      width: (clip.lengthSec / p.asset.durationSec) * 100,
    });
    // Live-preview the frame under the cursor (where the clip will be centered).
    onScrub(p.startSec + localSec);
  }

  function onMark(e: MouseEvent<HTMLDivElement>, p: PlacedAsset) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    markClip(p.asset.id, frac * p.asset.durationSec, p.asset.durationSec);
  }

  const frac = total > 0 ? playheadSec / total : 0;

  return (
    <div ref={containerRef} className="relative rounded-xl border border-separator bg-surface p-2">
      <ScrubRuler ruler={ruler} title="Drag to scrub the source" />

      {/* Filmstrip (fills width, proportional to duration) */}
      <div
        className="flex h-16 cursor-none items-stretch gap-1"
        onMouseMove={cursor.onMouseMove}
        onMouseLeave={() => {
          cursor.hide();
          setGhost(null);
          setOverMarker(false);
        }}
      >
        {placed.map((p) => {
          const assetMarkers = markers.filter((m) => m.assetId === p.asset.id);
          return (
            <div
              key={p.asset.id}
              onClick={(e) => onMark(e, p)}
              onMouseMove={(e) => onBlockMove(e, p)}
              className="relative flex min-w-0 items-stretch overflow-hidden rounded-lg border border-border bg-surface-secondary"
              style={{ flex: `${p.asset.durationSec} 1 0%` }}
              title="Click to mark a clip"
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

              {/* Ghost preview of the clip that a click would place */}
              {ghost && ghost.assetId === p.asset.id && !overMarker ? (
                <div
                  className="pointer-events-none absolute inset-y-0 rounded border-2 border-dashed border-accent/80 bg-accent/15"
                  style={{ left: `${ghost.left}%`, width: `${ghost.width}%` }}
                />
              ) : null}

              {assetMarkers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseEnter={() => {
                    setOverMarker(true);
                    setGhost(null);
                  }}
                  onMouseLeave={() => setOverMarker(false)}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMarker(m.id);
                  }}
                  className="absolute inset-y-0 rounded border-2 border-accent bg-accent/30 transition-colors hover:border-danger hover:bg-danger/40"
                  style={{
                    left: `${(m.startSec / p.asset.durationSec) * 100}%`,
                    width: `${(m.lengthSec / p.asset.durationSec) * 100}%`,
                  }}
                  title={`Clip ${m.lengthSec.toFixed(1)}s — click to remove`}
                />
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

      {/* Custom cursor: mark-here (accent + pin) or delete (red + trash) over a mark */}
      <TimelineCursor position={cursor.position} danger={overMarker}>
        {overMarker ? (
          <path d={TRASH_PATH} />
        ) : (
          <>
            <path d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10Z" />
            <circle cx="12" cy="11" r="2" fill="currentColor" stroke="none" />
          </>
        )}
      </TimelineCursor>
    </div>
  );
}
