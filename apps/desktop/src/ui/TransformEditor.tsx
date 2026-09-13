import { Button } from "@heroui/react";
import {
  type ClipRenderBox,
  type ClipTransform,
  clamp,
  isDefaultTransform,
  MAX_CLIP_ZOOM,
} from "@trailerfast/core";
import { type PointerEvent, type ReactNode, useRef } from "react";
import { LabeledSlider } from "./Fields";
import { Icon } from "./Icon";

const LOCKED_AXIS_HINT = "Fits exactly on this axis — zoom in to unlock repositioning.";

type Size = { width: number; height: number };

/** How far (canvas units) each axis can pan — half the box's overflow past the frame. */
export function panRange(box: ClipRenderBox, frame: Size): { x: number; y: number } {
  return {
    x: Math.max(0, (box.width - frame.width) / 2),
    y: Math.max(0, (box.height - frame.height) / 2),
  };
}

/**
 * Pan (drag or sliders) + zoom for one piece of media inside a frame — the
 * trailer canvas for a clip, a template tile for a thumbnail frame. Offsets are
 * normalized to the overflow, so every reachable position keeps the frame fully
 * covered. The caller renders the media itself as `children`, positioned with
 * `clipBoxStyle(box, …)`.
 */
export function TransformEditor({
  frame,
  box,
  transform,
  onChange,
  onReset,
  onDone,
  maxHeight,
  showHint = true,
  children,
}: {
  /** The frame being filled, in canvas units. */
  frame: Size;
  /** Where the media sits relative to that frame (from `clipRenderBox`). */
  box: ClipRenderBox;
  transform: ClipTransform;
  onChange: (patch: Partial<ClipTransform>) => void;
  onReset: () => void;
  onDone: () => void;
  /** CSS length capping the preview's height. */
  maxHeight: string;
  showHint?: boolean;
  children: ReactNode;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const pan = panRange(box, frame);
  const pannable = pan.x > 0 || pan.y > 0;

  function onPanDown(e: PointerEvent<HTMLDivElement>) {
    if (!pannable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
    };
  }
  function onPanMove(e: PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    const el = previewRef.current;
    if (!start || !el) return;
    // Pointer px → frame units → normalized offset (drag right = content follows).
    const pxToUnits = frame.width / el.clientWidth;
    const patch: Partial<ClipTransform> = {};
    if (pan.x > 0)
      patch.offsetX = clamp(start.offsetX - ((e.clientX - start.x) * pxToUnits) / pan.x, -1, 1);
    if (pan.y > 0)
      patch.offsetY = clamp(start.offsetY - ((e.clientY - start.y) * pxToUnits) / pan.y, -1, 1);
    if (Object.keys(patch).length) onChange(patch);
  }
  function onPanUp() {
    dragStart.current = null;
  }

  const axisSlider = (axis: "x" | "y") => {
    const key = axis === "x" ? "offsetX" : "offsetY";
    const range = pan[axis];
    return (
      <div title={range <= 0 ? LOCKED_AXIS_HINT : undefined}>
        <LabeledSlider
          label={axis === "x" ? "Horizontal" : "Vertical"}
          value={Math.round(transform[key] * 100)}
          min={-100}
          max={100}
          step={1}
          disabled={range <= 0}
          onChange={(v) => onChange({ [key]: v / 100 })}
          format={(v) => (range > 0 ? `${v}%` : "—")}
        />
      </div>
    );
  };

  return (
    <>
      {/* Live preview, framed exactly as it exports. */}
      <div
        ref={previewRef}
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanUp}
        onPointerCancel={onPanUp}
        className={`relative mx-auto touch-none overflow-hidden rounded-xl border border-separator bg-black ${
          pannable ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{
          // Cap by width so the box keeps the frame's exact ratio (a max-height
          // would win over aspect-ratio and skew all the % math).
          width: `min(100%, calc(${maxHeight} * ${frame.width} / ${frame.height}))`,
          aspectRatio: `${frame.width} / ${frame.height}`,
        }}
      >
        {children}
        {pannable && showHint ? (
          <span className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded bg-black/55 px-2 py-0.5 text-[11px] text-white/90">
            <Icon size={12}>
              <path d="M12 2v20M2 12h20" />
              <path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9 2 12l3 3M19 9l3 3-3 3" />
            </Icon>
            Drag to reposition
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <LabeledSlider
          label="Zoom"
          value={Math.round(transform.zoom * 100)}
          min={100}
          max={MAX_CLIP_ZOOM * 100}
          step={1}
          onChange={(v) => onChange({ zoom: v / 100 })}
          format={(v) => `${v}%`}
        />
        {axisSlider("x")}
        {axisSlider("y")}
      </div>

      <div className="mt-5 flex justify-between">
        <Button variant="tertiary" isDisabled={isDefaultTransform(transform)} onPress={onReset}>
          Reset
        </Button>
        <Button onPress={onDone}>Done</Button>
      </div>
    </>
  );
}
