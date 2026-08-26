import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useRef, useState } from "react";
import { SourcePreview } from "./SourcePreview";
import { ThumbnailSection } from "./ThumbnailSection";
import { ThumbnailSourceTimeline } from "./ThumbnailSourceTimeline";

/** Thumbnail mode: pick frames off the source above, see the result below. */
export function ThumbnailWorkArea() {
  const frameCount = useTrailerStore((s) => s.thumbnail.frames.length);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const prevFrames = useRef(0);

  // On the first picked frame, scroll down to reveal the thumbnail preview.
  useEffect(() => {
    if (prevFrames.current === 0 && frameCount > 0) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
    prevFrames.current = frameCount;
  }, [frameCount]);

  return (
    <div ref={scrollRef} className="relative flex h-full flex-col gap-5 overflow-y-auto p-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Source</h2>
          <span className="text-xs text-muted">
            Click the filmstrip to add a frame · click a numbered pick to remove it
          </span>
        </div>
        <SourcePreview playheadSec={playheadSec} videoRef={videoRef} onScrub={setPlayheadSec} />
        <ThumbnailSourceTimeline playheadSec={playheadSec} onScrub={setPlayheadSec} />
      </section>

      <ThumbnailSection />
    </div>
  );
}
