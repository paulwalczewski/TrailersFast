import { assetAt, placeAssets, totalDuration } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type RefObject, useEffect, useMemo } from "react";
import { engine } from "../engine";

type Props = {
  playheadSec: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  onScrub: (sec: number) => void;
};

/** Shows the source footage at the current playhead; plays with native controls. */
export function SourcePreview({ playheadSec, videoRef, onScrub }: Props) {
  const assets = useTrailerStore((s) => s.assets);
  const placed = useMemo(() => placeAssets(assets), [assets]);
  const total = totalDuration(placed);

  const clamped = Math.min(playheadSec, Math.max(0, total - 0.01));
  const current = assetAt(placed, clamped) ?? placed[placed.length - 1];
  const localTime = current ? Math.max(0, clamped - current.startSec) : 0;
  const src = current ? engine.toPlayableUrl(current.asset.path) : "";
  const startSec = current ? current.startSec : 0;

  // Seek to the scrubbed position, but don't fight active playback (threshold).
  useEffect(() => {
    const v = videoRef.current;
    if (v && Number.isFinite(localTime) && Math.abs(v.currentTime - localTime) > 0.05) {
      try {
        v.currentTime = localTime;
      } catch {
        /* not seekable yet */
      }
    }
  }, [localTime, videoRef]);

  if (!current) {
    return (
      <div className="grid aspect-video max-h-[36vh] min-h-40 w-full place-items-center rounded-xl border border-separator bg-black/90 text-sm text-white/60">
        Add &amp; select videos to preview the source
      </div>
    );
  }

  return (
    <div className="max-h-[36vh] overflow-hidden rounded-xl border border-separator bg-black">
      <video
        key={current.asset.id}
        ref={videoRef}
        src={src}
        playsInline
        preload="auto"
        onLoadedData={() => {
          const v = videoRef.current;
          if (v) {
            try {
              v.currentTime = localTime;
            } catch {
              /* ignore */
            }
          }
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (!v.paused) onScrub(startSec + v.currentTime);
        }}
        className="mx-auto aspect-video max-h-[36vh] w-full object-contain"
      />
    </div>
  );
}
