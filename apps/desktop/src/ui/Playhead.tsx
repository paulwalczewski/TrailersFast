import type { Ref } from "react";

/**
 * Left offset for a playhead sitting `frac` of the way across a timeline. The
 * 0.5rem/1rem encode the timelines' `p-2` padding, so the marker lines up with
 * the ruler rather than the container — keep them in step if that padding moves.
 */
export function playheadLeft(frac: number): string {
  return `calc(0.5rem + ${frac} * (100% - 1rem))`;
}

/**
 * The marker every timeline draws over its ruler. Pass `frac` to place it;
 * omit it and write `ref.current.style.left = playheadLeft(f)` instead when the
 * position changes too often to re-render for (the trailer timeline follows the
 * player at 30fps, and re-rendering that row per frame starves the player).
 */
export function Playhead({ frac, ref }: { frac?: number; ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-2 w-[2px] bg-danger"
      // Left unset when driven imperatively, so a re-render can't reset the
      // position out from under the caller's own writes.
      style={frac === undefined ? undefined : { left: playheadLeft(frac) }}
    >
      <div className="absolute -left-[5px] -top-1 size-3 rounded-full border border-white bg-danger" />
    </div>
  );
}
