import { placeAssets, totalDuration } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type RefObject, useEffect, useState } from "react";
import { SourcePreview } from "./SourcePreview";
import { SourceTimeline } from "./SourceTimeline";

type Props = { videoRef: RefObject<HTMLVideoElement | null> };

export function SourcePanel({ videoRef }: Props) {
  const assets = useTrailerStore((s) => s.assets);
  const clipLen = useTrailerStore((s) => s.settings.defaultClipLengthSec);
  const total = totalDuration(placeAssets(assets));
  const [playheadSec, setPlayheadSec] = useState(0);

  useEffect(() => {
    if (playheadSec > total) setPlayheadSec(total);
  }, [total, playheadSec]);

  return (
    <section className="flex flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Source</h2>
        <span className="text-xs text-muted">
          Click to mark {clipLen.toFixed(1)}s clips · drag the ruler / press Space to play
        </span>
      </div>
      <SourcePreview playheadSec={playheadSec} videoRef={videoRef} onScrub={setPlayheadSec} />
      <SourceTimeline playheadSec={playheadSec} onScrub={setPlayheadSec} />
    </section>
  );
}
