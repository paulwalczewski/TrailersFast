import { type PointerEvent, type RefObject, useCallback, useRef } from "react";

export type ScrubRulerState = {
  /** The ruler element — measure it for px↔time math. */
  rulerRef: RefObject<HTMLDivElement | null>;
  /** True while a pointer drag on the ruler is in progress. */
  scrubbing: RefObject<boolean>;
  /** Report the fraction (0..1) of the ruler under `clientX`. */
  scrubAt: (clientX: number) => void;
  /** Spread onto the ruler element. */
  rulerProps: {
    ref: RefObject<HTMLDivElement | null>;
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
};

/**
 * Pointer-drag scrubbing across a horizontal ruler, reported as a fraction of
 * its width. Shared by every timeline so they all scrub the same way.
 */
export function useScrubRuler(onFraction: (frac: number) => void): ScrubRulerState {
  const rulerRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const scrubAt = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onFraction(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
    },
    [onFraction],
  );

  const stop = () => {
    scrubbing.current = false;
  };

  return {
    rulerRef,
    scrubbing,
    scrubAt,
    rulerProps: {
      ref: rulerRef,
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubbing.current = true;
        scrubAt(e.clientX);
      },
      onPointerMove: (e) => {
        if (scrubbing.current) scrubAt(e.clientX);
      },
      onPointerUp: stop,
      onPointerCancel: stop,
    },
  };
}

/** The thin scrub bar above a timeline's filmstrip. */
export function ScrubRuler({ ruler, title }: { ruler: ScrubRulerState; title: string }) {
  return (
    <div
      {...ruler.rulerProps}
      className="mb-1 h-5 cursor-ew-resize rounded bg-surface-tertiary"
      title={title}
    />
  );
}
