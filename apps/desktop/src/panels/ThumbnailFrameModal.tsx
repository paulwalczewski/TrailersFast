import {
  canvasFor,
  clipRenderBox,
  defaultTransform,
  filmstripFrameAt,
  templateCells,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useMemo } from "react";
import { useFrameImages } from "../thumbnail/frameImages";
import { clipBoxStyle } from "../ui/clipMedia";
import { ModalHeader } from "../ui/ModalHeader";
import { ModalShell } from "../ui/ModalShell";
import { TransformEditor } from "../ui/TransformEditor";

/**
 * Reposition one picked frame inside the tile its template gives it: pan (drag
 * or sliders) + zoom. Offsets are normalized to the overflow, so the tile always
 * stays fully covered — the same rules as the trailer's clip framing.
 */
export function ThumbnailFrameModal({
  frameId,
  onClose,
}: {
  frameId: string;
  onClose: () => void;
}) {
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

  if (!frame || !asset) return null;

  const src =
    loaded?.url ??
    filmstripFrameAt(asset.filmstripUrls, frame.atSec, asset.durationSec) ??
    asset.posterUrl;

  return (
    <ModalShell
      onClose={onClose}
      className="w-[560px] max-w-full rounded-2xl bg-surface p-5 shadow-xl"
    >
      <ModalHeader title={<>Frame {index + 1} — position &amp; zoom</>} onClose={onClose} />
      <p className="mb-3 truncate text-xs text-muted">
        {asset.fileName} · {frame.atSec.toFixed(1)}s
      </p>
      <TransformEditor
        frame={cell}
        box={box}
        transform={transform}
        maxHeight="42vh"
        onChange={(patch) => setTransform(frameId, patch)}
        onReset={() => setTransform(frameId, defaultTransform())}
        onDone={onClose}
      >
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            style={clipBoxStyle(box, { canvas: { width: cell.width, height: cell.height } })}
          />
        ) : null}
      </TransformEditor>
    </ModalShell>
  );
}
