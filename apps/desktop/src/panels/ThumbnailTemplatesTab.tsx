import { Button } from "@heroui/react";
import {
  byId,
  filmstripFrameAt,
  THUMBNAIL_TEMPLATES,
  type ThumbnailTemplate,
  templateCells,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useMemo, useState } from "react";
import { AspectRatioPicker } from "../ui/AspectRatioPicker";
import { Icon } from "../ui/Icon";
import { ThumbnailFrameModal } from "./ThumbnailFrameModal";

/** Miniature of the tile layout a template produces for `count` frames. */
function LayoutDiagram({ template, count }: { template: ThumbnailTemplate; count: number }) {
  const w = 40;
  const h = 24;
  const cells = templateCells(template, Math.max(1, count), w, h);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x + 0.5}
          y={c.y + 0.5}
          width={Math.max(1, c.width - 1)}
          height={Math.max(1, c.height - 1)}
          rx="1.5"
          className="fill-accent/25 stroke-accent"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

/** Template picker + canvas shape + the frames the template lays out. */
export function ThumbnailTemplatesTab() {
  const thumbnail = useTrailerStore((s) => s.thumbnail);
  const update = useTrailerStore((s) => s.updateThumbnail);
  const removeFrame = useTrailerStore((s) => s.removeThumbnailFrame);
  const setFrames = useTrailerStore((s) => s.setThumbnailFrames);
  const assets = useTrailerStore((s) => s.assets);
  const markers = useTrailerStore((s) => s.markers);

  const assetsById = useMemo(() => byId(assets), [assets]);
  const { frames, template } = thumbnail;
  const [framingId, setFramingId] = useState<string | null>(null);

  /** Seed the picks from the trailer's clips — one frame per clip, at its middle. */
  function seedFromTrailerClips() {
    setFrames(
      [...markers]
        .sort((a, b) => a.order - b.order)
        .map((m) => ({ assetId: m.assetId, atSec: m.startSec + m.lengthSec / 2 })),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Template</h3>
        {THUMBNAIL_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => update({ template: t.id })}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              template === t.id
                ? "border-accent bg-accent/10"
                : "border-border bg-surface-secondary hover:bg-surface-tertiary"
            }`}
          >
            <LayoutDiagram template={t.id} count={frames.length} />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-muted">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <AspectRatioPicker
        value={thumbnail.aspectRatio}
        onChange={(aspectRatio) => update({ aspectRatio })}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Frames ({frames.length})
          </h3>
          {frames.length > 0 ? (
            <button
              type="button"
              onClick={() => setFrames([])}
              className="text-xs text-muted transition-colors hover:text-danger"
            >
              Clear all
            </button>
          ) : null}
        </div>

        {frames.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface-secondary px-3 py-4 text-center text-xs text-muted">
            Click the source filmstrip in the middle to pick frames. They tile in the order you pick
            them.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {frames.map((f, i) => {
              const asset = assetsById[f.assetId];
              const poster = asset
                ? (filmstripFrameAt(asset.filmstripUrls, f.atSec, asset.durationSec) ??
                  asset.posterUrl)
                : undefined;
              const used = template === "single" && i > 0;
              return (
                <li
                  key={f.id}
                  className={`flex items-center gap-2 rounded-lg border border-separator bg-surface-secondary p-1.5 ${
                    used ? "opacity-45" : ""
                  }`}
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFramingId(f.id)}
                    aria-label={`Position & zoom frame ${i + 1}`}
                    title="Position & zoom this frame"
                    className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-surface-tertiary"
                  >
                    {poster ? <img src={poster} alt="" className="size-full object-cover" /> : null}
                    <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity hover:opacity-100">
                      <Icon size={14}>
                        <path d="M20 7h-9M14 17H5" />
                        <circle cx="17" cy="17" r="3" />
                        <circle cx="7" cy="7" r="3" />
                      </Icon>
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{asset?.fileName ?? "—"}</p>
                    <p className="text-[11px] text-muted">
                      {f.atSec.toFixed(1)}s{used ? " · unused by this template" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFrame(f.id)}
                    aria-label={`Remove frame ${i + 1}`}
                    className="grid size-6 shrink-0 place-items-center rounded text-muted transition-colors hover:text-danger"
                  >
                    <Icon size={14}>
                      <path d="M18 6 6 18M6 6l12 12" />
                    </Icon>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {markers.length > 0 ? (
          <Button variant="outline" onPress={seedFromTrailerClips}>
            Use the trailer&apos;s {markers.length} clip{markers.length === 1 ? "" : "s"}
          </Button>
        ) : null}
      </div>

      {framingId ? (
        <ThumbnailFrameModal frameId={framingId} onClose={() => setFramingId(null)} />
      ) : null}
    </div>
  );
}
