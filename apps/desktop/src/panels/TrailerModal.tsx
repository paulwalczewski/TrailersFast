import type { PlayerRef } from "@remotion/player";
import { useRef, useState } from "react";
import { ModalShell } from "../ui/ModalShell";
import { TrailerPreview } from "./TrailerPreview";
import { TrailerTimeline } from "./TrailerTimeline";

/** Fullscreen view of the trailer timeline + preview. Uses its own player. */
export function TrailerModal({ onClose }: { onClose: () => void }) {
  const playerRef = useRef<PlayerRef | null>(null);
  const [frame, setFrame] = useState(0);

  return (
    <ModalShell
      onClose={onClose}
      className="flex max-h-[94vh] w-[92vw] max-w-6xl flex-col gap-3 rounded-2xl bg-surface p-4 shadow-xl"
    >
      <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Trailer</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
          >
            ✕
          </button>
        </div>
      <TrailerTimeline currentFrame={frame} onSeekFrame={(f) => playerRef.current?.seekTo(f)} />
      <TrailerPreview playerRef={playerRef} onFrame={setFrame} maxHeight="66vh" />
    </ModalShell>
  );
}
