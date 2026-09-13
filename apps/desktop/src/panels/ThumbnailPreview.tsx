import { canvasFor, templateCells } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useState } from "react";
import { useFrameImages } from "../thumbnail/frameImages";
import { ThumbnailCanvas } from "../thumbnail/ThumbnailCanvas";
import { Icon } from "../ui/Icon";
import { ThumbnailFrameModal } from "./ThumbnailFrameModal";

type Props = {
  maxHeight?: string;
  /** Show the per-tile framing buttons (off in the export dialog's preview). */
  interactive?: boolean;
};

/** The live thumbnail: exactly what the export writes, at screen size. */
export function ThumbnailPreview({ maxHeight = "44vh", interactive = true }: Props) {
  const thumbnail = useTrailerStore((s) => s.thumbnail);
  const removeFrame = useTrailerStore((s) => s.removeThumbnailFrame);
  const images = useFrameImages(thumbnail.frames);
  const canvas = canvasFor(thumbnail.aspectRatio, 1080);
  const [framingId, setFramingId] = useState<string | null>(null);

  // Tiles in percentages, so the overlay lines up with the canvas at any size.
  const cells = templateCells(thumbnail.template, thumbnail.frames.length, 100, 100);

  return (
    <>
      <div
        className="relative mx-auto overflow-hidden rounded-xl bg-black ring-1 ring-separator"
        style={{
          // Cap by width so the box keeps the exact output ratio (a max-height
          // would win over aspect-ratio and skew it).
          width: `min(100%, calc(${maxHeight} * ${canvas.width} / ${canvas.height}))`,
          aspectRatio: `${canvas.width} / ${canvas.height}`,
        }}
      >
        <ThumbnailCanvas config={thumbnail} images={images} className="block size-full" />

        {interactive
          ? cells.map((cell, i) => {
              const frame = thumbnail.frames[i];
              if (!frame) return null;
              return (
                <div
                  key={frame.id}
                  className="group absolute"
                  style={{
                    left: `${cell.x}%`,
                    top: `${cell.y}%`,
                    width: `${cell.width}%`,
                    height: `${cell.height}%`,
                  }}
                >
                  <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setFramingId(frame.id)}
                      aria-label={`Position & zoom frame ${i + 1}`}
                      title="Position & zoom this frame"
                      className="grid size-7 place-items-center rounded-lg bg-black/55 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
                    >
                      <Icon size={15}>
                        <path d="M20 7h-9M14 17H5" />
                        <circle cx="17" cy="17" r="3" />
                        <circle cx="7" cy="7" r="3" />
                      </Icon>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFrame(frame.id)}
                      aria-label={`Remove frame ${i + 1}`}
                      title="Remove this frame from the thumbnail"
                      className="grid size-7 place-items-center rounded-lg bg-black/55 text-white/80 backdrop-blur-sm transition-colors hover:bg-danger hover:text-white"
                    >
                      <Icon size={15}>
                        <path d="M18 6 6 18M6 6l12 12" />
                      </Icon>
                    </button>
                  </div>
                </div>
              );
            })
          : null}

        {thumbnail.frames.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/60">
            Click the source filmstrip above to pick the frames this thumbnail is built from
          </div>
        ) : null}
      </div>

      {framingId ? (
        <ThumbnailFrameModal frameId={framingId} onClose={() => setFramingId(null)} />
      ) : null}
    </>
  );
}
