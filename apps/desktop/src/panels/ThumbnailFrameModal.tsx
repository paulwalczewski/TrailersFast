import { Button } from "@heroui/react";
import {
  MAX_CLIP_ZOOM,
  canvasFor,
  clamp,
  clipRenderBox,
  defaultTransform,
  filmstripFrameAt,
  isDefaultTransform,
  templateCells,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type PointerEvent, useMemo, useRef } from "react";
import { LabeledSlider } from "../ui/Fields";
import { Icon } from "../ui/Icon";
import { ModalShell } from "../ui/ModalShell";
import { clipBoxStyle } from "../ui/clipMedia";
import { useFrameImages } from "../thumbnail/frameImages";

const LOCKED_AXIS_HINT =
  "The frame fills this tile exactly on this axis — zoom in to unlock repositioning.";

/**
 * Reposition one picked frame inside the tile its template gives it: pan (drag
 * or sliders) + zoom. Offsets are normalized to the overflow, so the tile always
 * stays fully covered — the same rules as the trailer's clip framing.
 */
export function ThumbnailFrameModal({ frameId, onClose }: { frameId: string; onClose: () => void }) {
  const thumbnail = useTrailerStore((s) => s.thumbnail);
  const assets = useTrailerStore((s) => s.assets);
  const setTransform = useTrailerStore((s) => s.setThumbnailFrameTransform);

  const index = thumbnail.frames.findIndex((f) => f.id === frameId);
  const frame = index >= 0 ? thumbnail.frames[index] : undefined;
  const asset = assets.find((a) => a.id === frame?.assetId);

  // The tile this frame occupies, in canvas units — that's what we're framing into.
  const canvas = canvasFor(thumbnail.aspectRatio, 1080);
  const cell = useMemo(() => {
    const cells = templateCells(
      thumbnail.template,
      thumbnail.frames.length,
      canvas.width,
      canvas.height,
    );
    return cells[index] ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }, [thumbnail.template, thumbnail.frames.length, canvas.width, canvas.height, index]);

  // Sharp frame when FFmpeg has handed it over; the filmstrip thumb meanwhile.
  const single = useMemo(() => (frame ? [frame] : []), [frame]);
  const [loaded] = useFrameImages(single);

  const previewRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const transform = frame?.transform ?? defaultTransform();
  const box = useMemo(
    () =>
      clipRenderBox(
        asset?.width ?? 0,
        asset?.height ?? 0,
        cell.width,
        cell.height,
        "cover",
        transform,
      ),
    [asset?.width, asset?.height, cell.width, cell.height, transform],
  );
  // How far (canvas units) each axis can pan — half the tile's overflow.
  const pan = {
    x: Math.max(0, (box.width - cell.width) / 2),
    y: Math.max(0, (box.height - cell.height) / 2),
  };

  if (!frame || !asset) return null;

  const src =
    loaded?.url ?? filmstripFrameAt(asset.filmstripUrls, frame.atSec, asset.durationSec) ?? asset.posterUrl;
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
    // Pointer px → tile units → normalized offset (drag right = content follows).
    const pxToCell = cell.width / el.clientWidth;
    const patch: { offsetX?: number; offsetY?: number } = {};
    if (pan.x > 0)
      patch.offsetX = clamp(start.offsetX - ((e.clientX - start.x) * pxToCell) / pan.x, -1, 1);
    if (pan.y > 0)
      patch.offsetY = clamp(start.offsetY - ((e.clientY - start.y) * pxToCell) / pan.y, -1, 1);
    if (Object.keys(patch).length) setTransform(frameId, patch);
  }
  function onPanUp() {
    dragStart.current = null;
  }

  return (
    <ModalShell onClose={onClose} className="w-[560px] max-w-full rounded-2xl bg-surface p-5 shadow-xl">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Frame {index + 1} — position &amp; zoom
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-6 place-items-center text-muted transition-colors hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <p className="mb-3 truncate text-xs text-muted">
        {asset.fileName} · {frame.atSec.toFixed(1)}s
      </p>

      {/* Live preview of this frame's tile, framed exactly as it exports. */}
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
          // Cap by width so the box keeps the tile's exact ratio (a max-height
          // would win over aspect-ratio and skew all the % math).
          width: `min(100%, calc(42vh * ${cell.width} / ${cell.height}))`,
          aspectRatio: `${cell.width} / ${cell.height}`,
        }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            style={clipBoxStyle(box, { canvas: { width: cell.width, height: cell.height } })}
          />
        ) : null}
        {pannable ? (
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
          onChange={(v) => setTransform(frameId, { zoom: v / 100 })}
          format={(v) => `${v}%`}
        />
        <div title={pan.x <= 0 ? LOCKED_AXIS_HINT : undefined}>
          <LabeledSlider
            label="Horizontal"
            value={Math.round(transform.offsetX * 100)}
            min={-100}
            max={100}
            step={1}
            disabled={pan.x <= 0}
            onChange={(v) => setTransform(frameId, { offsetX: v / 100 })}
            format={(v) => (pan.x > 0 ? `${v}%` : "—")}
          />
        </div>
        <div title={pan.y <= 0 ? LOCKED_AXIS_HINT : undefined}>
          <LabeledSlider
            label="Vertical"
            value={Math.round(transform.offsetY * 100)}
            min={-100}
            max={100}
            step={1}
            disabled={pan.y <= 0}
            onChange={(v) => setTransform(frameId, { offsetY: v / 100 })}
            format={(v) => (pan.y > 0 ? `${v}%` : "—")}
          />
        </div>
      </div>

      <div className="mt-5 flex justify-between">
        <Button
          variant="tertiary"
          isDisabled={isDefaultTransform(transform)}
          onPress={() => setTransform(frameId, defaultTransform())}
        >
          Reset
        </Button>
        <Button onPress={onClose}>Done</Button>
      </div>
    </ModalShell>
  );
}
