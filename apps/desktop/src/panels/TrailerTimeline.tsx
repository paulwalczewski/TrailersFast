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
import { buildTrailerClips, byId, totalFrames } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type PointerEvent, useMemo, useRef } from "react";
import { PREVIEW_FPS } from "../composition/TrailerComposition";

type ClipItem = {
  id: string;
  durationInFrames: number;
  poster?: string;
  name: string;
};

type SortableClipProps = {
  item: ClipItem;
  index: number;
  isCurrent: boolean;
  onSelect: () => void;
  onRemove: () => void;
};

function SortableClip({ item, index, isCurrent, onSelect, onRemove }: SortableClipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
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
      className={`relative flex min-w-16 cursor-pointer items-stretch overflow-hidden rounded-lg border-2 bg-surface-secondary ${
        isCurrent ? "border-accent" : "border-border"
      } ${isDragging ? "opacity-70" : ""}`}
    >
      {item.poster ? (
        <img src={item.poster} alt="" className="pointer-events-none size-full object-cover" />
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
        className="absolute left-1 top-1 grid size-5 cursor-grab place-items-center rounded bg-black/55 text-[11px] text-white"
        aria-label="Drag to reorder"
      >
        ⠿
      </button>

      {/* Remove */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute right-1 top-1 grid size-5 place-items-center rounded bg-black/55 text-[11px] text-white transition-colors hover:bg-danger"
        aria-label="Remove clip"
      >
        ✕
      </button>

      <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded bg-black/50 px-1 text-[10px] text-white">
        {index + 1}. {item.name}
      </span>
    </div>
  );
}

type Props = { currentFrame: number; onSeekFrame: (frame: number) => void };

export function TrailerTimeline({ currentFrame, onSeekFrame }: Props) {
  const markers = useTrailerStore((s) => s.markers);
  const assets = useTrailerStore((s) => s.assets);
  const reorderMarker = useTrailerStore((s) => s.reorderMarker);
  const removeMarker = useTrailerStore((s) => s.removeMarker);

  const rulerRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const assetsById = useMemo(() => byId(assets), [assets]);
  const items: ClipItem[] = useMemo(
    () =>
      buildTrailerClips(markers, assetsById, PREVIEW_FPS).map((c) => ({
        id: c.markerId,
        durationInFrames: c.durationInFrames,
        poster: assetsById[c.assetId]?.posterUrl,
        name: assetsById[c.assetId]?.fileName ?? "clip",
      })),
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
  const currentIndex = starts.findLastIndex((s) => currentFrame >= s);

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
    onSeekFrame(Math.round(frac * total));
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

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const newIndex = items.findIndex((it) => it.id === over.id);
    if (newIndex !== -1) reorderMarker(String(active.id), newIndex);
  }

  const frac = total > 0 ? currentFrame / total : 0;

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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((it) => it.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex h-16 items-stretch gap-1">
            {items.map((it, i) => (
              <SortableClip
                key={it.id}
                item={it}
                index={i}
                isCurrent={i === currentIndex}
                onSelect={() => onSeekFrame(starts[i] ?? 0)}
                onRemove={() => removeMarker(it.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Playhead */}
      <div
        className="pointer-events-none absolute inset-y-2 w-[2px] bg-danger"
        style={{ left: `calc(0.5rem + ${frac} * (100% - 1rem))` }}
      >
        <div className="absolute -left-[5px] -top-1 size-3 rounded-full border border-white bg-danger" />
      </div>
    </div>
  );
}
