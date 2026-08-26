import type { PlayerRef } from "@remotion/player";
import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useRef, useState } from "react";
import { useProxies } from "../useProxies";
import { SourcePanel } from "./SourcePanel";
import { TrailerModal } from "./TrailerModal";
import { TrailerSection } from "./TrailerSection";

export function TrailerWorkArea() {
  const markers = useTrailerStore((s) => s.markers);
  useProxies();

  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<PlayerRef | null>(null);
  // The modal draws its own player over this one, so the work area owns both and
  // hands keys to whichever is actually on screen.
  const modalPlayerRef = useRef<PlayerRef | null>(null);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMarkers = useRef(0);

  // On the first marked clip, scroll down to reveal the trailer preview.
  useEffect(() => {
    if (prevMarkers.current === 0 && markers.length > 0) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
    prevMarkers.current = markers.length;
  }, [markers.length]);

  // Space plays the trailer preview — the enlarged one when it's open, since the
  // inline player is behind the overlay. Falls back to the source only when there
  // are no marked clips yet (nothing to preview).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (markers.length > 0) {
        const p = expanded ? modalPlayerRef.current : playerRef.current;
        if (p) (p.isPlaying() ? p.pause() : p.play());
      } else {
        const v = sourceVideoRef.current;
        if (v) v.paused ? void v.play().catch(() => {}) : v.pause();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markers.length, expanded]);

  return (
    <div ref={scrollRef} className="relative flex h-full flex-col gap-5 overflow-y-auto p-4">
      <SourcePanel videoRef={sourceVideoRef} />
      <TrailerSection
        playerRef={playerRef}
        onExpand={() => {
          // Nothing pauses the inline player when it's covered, and a second
          // player decoding the same clips behind the overlay is pure waste.
          playerRef.current?.pause();
          setExpanded(true);
        }}
      />
      {expanded ? (
        <TrailerModal playerRef={modalPlayerRef} onClose={() => setExpanded(false)} />
      ) : null}
    </div>
  );
}
