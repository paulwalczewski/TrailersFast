import type { PlayerRef } from "@remotion/player";
import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useRef } from "react";
import { useProxies } from "../useProxies";
import { SourcePanel } from "./SourcePanel";
import { TrailerSection } from "./TrailerSection";

export function TrailerWorkArea() {
  const markers = useTrailerStore((s) => s.markers);
  useProxies();

  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<PlayerRef | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMarkers = useRef(0);

  // On the first marked clip, scroll down to reveal the trailer preview.
  useEffect(() => {
    if (prevMarkers.current === 0 && markers.length > 0) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
    prevMarkers.current = markers.length;
  }, [markers.length]);

  // Space plays the trailer preview; falls back to the source only when there
  // are no marked clips yet (nothing to preview).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (markers.length > 0) {
        const p = playerRef.current;
        if (p) (p.isPlaying() ? p.pause() : p.play());
      } else {
        const v = sourceVideoRef.current;
        if (v) v.paused ? void v.play().catch(() => {}) : v.pause();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markers.length]);

  return (
    <div ref={scrollRef} className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <SourcePanel videoRef={sourceVideoRef} />
      <TrailerSection playerRef={playerRef} />
    </div>
  );
}
