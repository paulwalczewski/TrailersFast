import type { PlayerRef } from "@remotion/player";
import type { RefObject } from "react";
import { MarkFirstClipOverlay } from "./OnboardingOverlay";
import { TrailerPreview } from "./TrailerPreview";
import { TrailerTimeline } from "./TrailerTimeline";

type Props = { playerRef: RefObject<PlayerRef | null>; onExpand: () => void };

export function TrailerSection({ playerRef, onExpand }: Props) {
  return (
    <section className="relative rounded-2xl border border-separator bg-surface-secondary p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Trailer</h2>
        <button
          type="button"
          onClick={onExpand}
          aria-label="Enlarge trailer"
          className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>

      {/* Timeline on top, preview below */}
      <div className="flex flex-col gap-2">
        <TrailerTimeline playerRef={playerRef} />
        <TrailerPreview playerRef={playerRef} maxHeight="30vh" />
      </div>

      <MarkFirstClipOverlay />
    </section>
  );
}
