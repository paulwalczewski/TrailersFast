import { Button } from "@heroui/react";
import {
  MAX_CLIP_ZOOM,
  byId,
  canvasFor,
  clipRenderBox,
  defaultTransform,
  filmstripFrameAt,
  isDefaultTransform,
  proxyKey,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type PointerEvent, useMemo, useRef } from "react";
import { engine } from "../engine";
import { clipBoxStyle, useMediaReady } from "../ui/clipMedia";
import { LabeledSlider } from "../ui/Fields";
import { ModalShell } from "../ui/ModalShell";

/**
 * Reposition a clip within the trailer canvas: pan (drag or sliders) + zoom.
 * Offsets are normalized to the clip's overflow, so every reachable position
 * keeps the canvas fully covered — no black space can appear in the export.
 */
export function ClipTransformModal({ markerId, onClose }: { markerId: string; onClose: () => void }) {
  const marker = useTrailerStore((s) => s.markers.find((m) => m.id === markerId));
  const assets = useTrailerStore((s) => s.assets);
  const settings = useTrailerStore((s) => s.settings);
  const proxies = useTrailerStore((s) => s.proxies);
  const setMarkerTransform = useTrailerStore((s) => s.setMarkerTransform);

  const asset = marker ? byId(assets)[marker.assetId] : undefined;
  const previewRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const canvas = canvasFor(settings.aspectRatio, 1080);
  const transform = marker?.transform ?? defaultTransform();

  const box = useMemo(
    () =>
      clipRenderBox(
        asset?.width ?? 0,
        asset?.height ?? 0,
        canvas.width,
        canvas.height,
        settings.fitMode,
        transform,
      ),
    [asset?.width, asset?.height, canvas.width, canvas.height, settings.fitMode, transform],
  );
  // How far (canvas px) each axis can pan — half the box's overflow.
  const pan = {
    x: Math.max(0, (box.width - canvas.width) / 2),
    y: Math.max(0, (box.height - canvas.height) / 2),
  };

  // Proxy (already the trimmed clip) when ready; the raw source otherwise.
  const proxyPath = marker ? proxies[proxyKey(marker)] : undefined;
  const mediaUrl = proxyPath
    ? engine.toPlayableUrl(proxyPath)
    : asset
      ? engine.toPlayableUrl(asset.path)
      : "";
  // Show the middle frame of the clip — most representative for framing.
  const mediaTime = marker ? (proxyPath ? marker.lengthSec / 2 : marker.startSec + marker.lengthSec / 2) : 0;
  // The webview paints <video> black until a frame is decoded — keep it hidden
  // (showing the instant filmstrip backdrop) until the seek target is ready.
  const [videoReady, markReady] = useMediaReady(mediaUrl);

  if (!marker || !asset) return null;

  // Filmstrip frame nearest the clip middle: an instant, representative backdrop.
  const backdrop =
    filmstripFrameAt(
      asset.filmstripUrls,
      marker.startSec + marker.lengthSec / 2,
      asset.durationSec,
    ) ?? asset.posterUrl;

  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
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
    // Pointer px → canvas units → normalized offset (drag right = content follows).
    const pxToCanvas = canvas.width / el.clientWidth;
    const patch: { offsetX?: number; offsetY?: number } = {};
    if (pan.x > 0) patch.offsetX = clamp(start.offsetX - ((e.clientX - start.x) * pxToCanvas) / pan.x);
    if (pan.y > 0) patch.offsetY = clamp(start.offsetY - ((e.clientY - start.y) * pxToCanvas) / pan.y);
    if (Object.keys(patch).length) setMarkerTransform(markerId, patch);
  }
  function onPanUp() {
    dragStart.current = null;
  }

  const mediaStyle = clipBoxStyle(box, { flip: settings.flipHorizontal, canvas });

  return (
    <ModalShell onClose={onClose} className="w-[560px] max-w-full rounded-2xl bg-surface p-5 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Position &amp; zoom</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-6 place-items-center text-muted transition-colors hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {/* Live preview: the trailer canvas with this clip framed exactly as exported. */}
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
          // Cap by width so the box always keeps the exact canvas ratio (a
          // max-height would win over aspect-ratio and skew all the % math).
          width: `min(100%, calc(48vh * ${canvas.width} / ${canvas.height}))`,
          aspectRatio: `${canvas.width} / ${canvas.height}`,
        }}
      >
        {backdrop ? <img src={backdrop} alt="" style={mediaStyle} /> : null}
        <video
          key={mediaUrl}
          src={mediaUrl}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = mediaTime;
          }}
          onSeeked={markReady}
          style={{ ...mediaStyle, opacity: videoReady ? 1 : 0 }}
        />
        {pannable ? (
          <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/55 px-2 py-0.5 text-[11px] text-white/90">
            Drag to reposition
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <LabeledSlider
          label="Horizontal"
          value={Math.round(transform.offsetX * 100)}
          min={-100}
          max={100}
          step={1}
          disabled={pan.x <= 0}
          onChange={(v) => setMarkerTransform(markerId, { offsetX: v / 100 })}
          format={(v) => (pan.x > 0 ? `${v}%` : "—")}
        />
        <LabeledSlider
          label="Vertical"
          value={Math.round(transform.offsetY * 100)}
          min={-100}
          max={100}
          step={1}
          disabled={pan.y <= 0}
          onChange={(v) => setMarkerTransform(markerId, { offsetY: v / 100 })}
          format={(v) => (pan.y > 0 ? `${v}%` : "—")}
        />
        <LabeledSlider
          label="Zoom"
          value={Math.round(transform.zoom * 100)}
          min={100}
          max={MAX_CLIP_ZOOM * 100}
          step={1}
          onChange={(v) => setMarkerTransform(markerId, { zoom: v / 100 })}
          format={(v) => `${v}%`}
        />
        {!pannable ? (
          <p className="text-xs text-muted">
            The clip fits the canvas exactly on both axes — zoom in to unlock repositioning.
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex justify-between">
        <Button
          variant="tertiary"
          isDisabled={isDefaultTransform(transform)}
          onPress={() => setMarkerTransform(markerId, defaultTransform())}
        >
          Reset
        </Button>
        <Button onPress={onClose}>Done</Button>
      </div>
    </ModalShell>
  );
}
