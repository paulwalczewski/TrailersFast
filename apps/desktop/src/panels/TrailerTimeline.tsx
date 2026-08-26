import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PlayerRef } from "@remotion/player";
import { MIN_CLIP_SEC, buildTrailerClips, byId, totalFrames, trailerDuration } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PREVIEW_FPS } from "../composition/TrailerComposition";
import { Playhead, playheadLeft } from "../ui/Playhead";
import { MediaLoadingPlaceholder } from "../ui/Spinner";
import { ClipTransformModal } from "./ClipTransformModal";

type ClipItem = {
  id: string;
  durationInFrames: number;
  /** In-point + length within the source, seconds (for edge-resize). */
  startSec: number;
  lengthSec: number;
  /** Source duration — the resize bound. */
  assetDurationSec: number;
  poster?: string;
  /** True while the source asset's thumbnails are still being generated. */
  mediaLoading: boolean;
  name: string;
};

type SortableClipProps = {
  item: ClipItem;
  index: number;
  isCurrent: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onConfigure: () => void;
  onResize: (markerId: string, startSec: number, lengthSec: number) => void;
  getPxPerSec: () => number;
  resizingRef: RefObject<boolean>;
  beginBatch: () => void;
  endBatch: () => void;
};

type ResizeState = {
  edge: "left" | "right";
  startX: number;
  origStart: number;
  origLen: number;
  pxPerSec: number;
  started: boolean;
};

function SortableClip({
  item,
  index,
  isCurrent,
  onSelect,
  onRemove,
  onConfigure,
  onResize,
  getPxPerSec,
  resizingRef,
  beginBatch,
  endBatch,
}: SortableClipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const resize = useRef<ResizeState | null>(null);

  function onResizeDown(e: PointerEvent, edge: "left" | "right") {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = true;
    resize.current = {
      edge,
      startX: e.clientX,
      origStart: item.startSec,
      origLen: item.lengthSec,
      pxPerSec: getPxPerSec(),
      started: false,
    };
  }
  function onResizeMove(e: PointerEvent) {
    const st = resize.current;
    if (!st) return;
    e.stopPropagation();
    const dxSec = (e.clientX - st.startX) / st.pxPerSec;
    if (!st.started) {
      if (Math.abs(e.clientX - st.startX) < 2) return;
      st.started = true;
      beginBatch(); // one undo step for the whole drag
    }
    if (st.edge === "left") {
      // Right edge stays put; drag the in-point, clamped to [0, end - min].
      const end = st.origStart + st.origLen;
      const newStart = Math.max(0, Math.min(st.origStart + dxSec, end - MIN_CLIP_SEC));
      onResize(item.id, newStart, end - newStart);
    } else {
      // In-point stays put; grow/shrink length up to the source end.
      const maxLen = item.assetDurationSec - st.origStart;
      const newLen = Math.max(MIN_CLIP_SEC, Math.min(st.origLen + dxSec, maxLen));
      onResize(item.id, st.origStart, newLen);
    }
  }
  function onResizeUp() {
    const st = resize.current;
    resize.current = null;
    resizingRef.current = false;
    if (st?.started) endBatch();
  }

  return (
    <div
      ref={setNodeRef}
      onClick={onSelect}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        flex: `${item.durationInFrames} 1 0%`,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={`group relative flex min-w-16 cursor-pointer items-stretch overflow-hidden rounded-lg border-2 bg-surface-secondary ${
        isCurrent ? "border-accent" : "border-border"
      } ${isDragging ? "opacity-70" : ""}`}
    >
      {item.poster ? (
        <img src={item.poster} alt="" className="pointer-events-none size-full object-cover" />
      ) : item.mediaLoading ? (
        <MediaLoadingPlaceholder />
      ) : (
        <div className="pointer-events-none grid size-full place-items-center text-xs text-muted">
          {index + 1}
        </div>
      )}

      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        type="button"
        onClick={(e) => e.stopPropagation()}
        className="absolute left-1 top-1 z-20 grid size-5 cursor-grab place-items-center rounded bg-black/55 text-[11px] text-white"
        aria-label="Drag to reorder"
      >
        ⠿
      </button>

      {/* Position & zoom */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onConfigure();
        }}
        className="absolute right-7 top-1 z-20 grid size-5 place-items-center rounded bg-black/55 text-white transition-colors hover:bg-accent"
        aria-label="Position & zoom"
        title="Position & zoom"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>

      {/* Remove */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute right-1 top-1 z-20 grid size-5 place-items-center rounded bg-black/55 text-[11px] text-white transition-colors hover:bg-danger"
        aria-label="Remove clip"
      >
        ✕
      </button>

      {/* Trim handles — drag either edge to lengthen/shorten (bounded to the source). */}
      {(["left", "right"] as const).map((edge) => (
        <div
          key={edge}
          onPointerDown={(e) => onResizeDown(e, edge)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onClick={(e) => e.stopPropagation()}
          className={`absolute inset-y-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100 ${
            edge === "left" ? "left-0 bg-gradient-to-r" : "right-0 bg-gradient-to-l"
          }`}
          aria-label={edge === "left" ? "Trim clip start" : "Trim clip end"}
        >
          <span className="pointer-events-none h-6 w-0.5 rounded-full bg-white/85" />
        </div>
      ))}

      <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded bg-black/50 px-1 text-[10px] text-white">
        {index + 1}. {item.name} · {item.lengthSec.toFixed(1)}s
      </span>
    </div>
  );
}

/**
 * Follows the player by writing the marker's `left` directly, never by
 * re-rendering. The row below is a dnd-kit tree, and re-rendering it on every
 * frame starved the player's frame loop: its clock only advances on a committed
 * React render, so a render that misses the next tick loses that time for good —
 * the preview ran at ~20fps while the videos ran at 1x and hit the end of each
 * clip early. Only the clip highlight goes through state, and only when it moves.
 */
function LivePlayhead({
  playerRef,
  total,
  onFrame,
}: {
  playerRef: RefObject<PlayerRef | null>;
  total: number;
  onFrame: (frame: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const apply = () => {
      const frame = p.getCurrentFrame();
      if (ref.current) ref.current.style.left = playheadLeft(total > 0 ? frame / total : 0);
      onFrame(frame);
    };
    apply();
    p.addEventListener("frameupdate", apply);
    return () => p.removeEventListener("frameupdate", apply);
  }, [playerRef, total, onFrame]);

  return <Playhead ref={ref} />;
}

type Props = { playerRef: RefObject<PlayerRef | null> };

export function TrailerTimeline({ playerRef }: Props) {
  const markers = useTrailerStore((s) => s.markers);
  const assets = useTrailerStore((s) => s.assets);
  const reorderMarker = useTrailerStore((s) => s.reorderMarker);
  const removeMarker = useTrailerStore((s) => s.removeMarker);
  const resizeMarker = useTrailerStore((s) => s.resizeMarker);
  const beginBatch = useTrailerStore((s) => s.beginHistoryBatch);
  const endBatch = useTrailerStore((s) => s.endHistoryBatch);

  const seek = useCallback((frame: number) => playerRef.current?.seekTo(frame), [playerRef]);

  const rulerRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const dragging = useRef(false);
  const resizing = useRef(false);
  const [configMarkerId, setConfigMarkerId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const assetsById = useMemo(() => byId(assets), [assets]);
  const items: ClipItem[] = useMemo(
    () =>
      buildTrailerClips(markers, assetsById, PREVIEW_FPS).map((c) => {
        const asset = assetsById[c.assetId];
        return {
          id: c.markerId,
          durationInFrames: c.durationInFrames,
          startSec: c.startSec,
          lengthSec: c.lengthSec,
          assetDurationSec: c.assetDurationSec,
          poster: asset?.posterUrl,
          mediaLoading: asset?.mediaLoading ?? false,
          name: asset?.fileName ?? "clip",
        };
      }),
    [markers, assetsById],
  );

  const starts = useMemo(() => {
    let acc = 0;
    return items.map((it) => {
      const s = acc;
      acc += it.durationInFrames;
      return s;
    });
  }, [items]);
  const total = totalFrames(items);

  // setState with an unchanged value bails out, so this costs nothing per frame —
  // it only re-renders when the playhead actually crosses into another clip.
  const trackFrame = useCallback(
    (frame: number) => setCurrentIndex(starts.findLastIndex((s) => frame >= s)),
    [starts],
  );

  if (items.length === 0) {
    return (
      <div className="grid min-h-28 place-items-center rounded-xl border border-separator bg-surface text-sm text-muted">
        Mark clips on the source timeline — they land here to reorder &amp; preview.
      </div>
    );
  }

  function seekFrom(clientX: number) {
    const el = rulerRef.current;
    if (!el || total === 0) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seek(Math.round(frac * total));
  }
  function onRulerDown(e: PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    seekFrom(e.clientX);
  }
  function onRulerMove(e: PointerEvent) {
    if (scrubbing.current) seekFrom(e.clientX);
  }
  function stopScrub() {
    scrubbing.current = false;
  }
  // Hovering the clips row moves the playhead (like the source timeline). The
  // per-clip buttons still get their clicks — a mouse-move here never blocks them.
  function onClipsHover(e: PointerEvent) {
    if (dragging.current || scrubbing.current || resizing.current) return;
    seekFrom(e.clientX);
  }
  // Pixels per second across the whole strip, for edge-resize math.
  function getPxPerSec() {
    const el = rulerRef.current;
    const totalSec = trailerDuration(markers);
    if (!el || totalSec === 0) return 1;
    return el.getBoundingClientRect().width / totalSec;
  }

  function onDragEnd(e: DragEndEvent) {
    dragging.current = false;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const newIndex = items.findIndex((it) => it.id === over.id);
    if (newIndex !== -1) reorderMarker(String(active.id), newIndex);
  }

  return (
    <div className="relative rounded-xl border border-separator bg-surface p-2">
      {/* Scrub ruler */}
      <div
        ref={rulerRef}
        onPointerDown={onRulerDown}
        onPointerMove={onRulerMove}
        onPointerUp={stopScrub}
        onPointerCancel={stopScrub}
        className="mb-1 h-5 cursor-ew-resize rounded bg-surface-tertiary"
        title="Drag to scrub the trailer"
      />

      {/* Clips (proportional, draggable to reorder) */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => {
          dragging.current = true;
        }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={items.map((it) => it.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex h-16 items-stretch gap-1" onPointerMove={onClipsHover}>
            {items.map((it, i) => (
              <SortableClip
                key={it.id}
                item={it}
                index={i}
                isCurrent={i === currentIndex}
                onSelect={() => seek(starts[i] ?? 0)}
                onRemove={() => removeMarker(it.id)}
                onConfigure={() => setConfigMarkerId(it.id)}
                onResize={resizeMarker}
                getPxPerSec={getPxPerSec}
                resizingRef={resizing}
                beginBatch={beginBatch}
                endBatch={endBatch}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <LivePlayhead playerRef={playerRef} total={total} onFrame={trackFrame} />

      {configMarkerId ? (
        <ClipTransformModal markerId={configMarkerId} onClose={() => setConfigMarkerId(null)} />
      ) : null}
    </div>
  );
}
