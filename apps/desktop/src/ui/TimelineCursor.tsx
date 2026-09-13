import { type MouseEvent, type ReactNode, type RefObject, useState } from "react";

type Point = { x: number; y: number };

/**
 * A custom cursor that follows the mouse inside `containerRef`. The container
 * hides the native cursor (`cursor-none`) and shows this bubble instead, so the
 * click action — mark, pick, remove — reads before the click happens.
 */
export function useTimelineCursor(containerRef: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState<Point | null>(null);
  return {
    position,
    onMouseMove: (e: MouseEvent<HTMLElement>) => {
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    hide: () => setPosition(null),
  };
}

export function TimelineCursor({
  position,
  danger,
  children,
}: {
  position: Point | null;
  /** Red (a click removes something) instead of accent (a click adds). */
  danger: boolean;
  /** SVG path elements for the 24×24 icon. */
  children: ReactNode;
}) {
  if (!position) return null;
  return (
    <div
      className={`pointer-events-none absolute z-10 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-white shadow-lg ${
        danger ? "bg-danger" : "bg-accent"
      }`}
      style={{ left: position.x, top: position.y }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </div>
  );
}

/** Trash-can path, the "click removes this" cursor icon shared by the timelines. */
export const TRASH_PATH =
  "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6";
