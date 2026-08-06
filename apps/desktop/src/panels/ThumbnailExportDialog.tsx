import { Button } from "@heroui/react";
import {
  IMAGE_FORMATS,
  type ImageFormat,
  THUMBNAIL_SIZES,
  type ThumbnailSize,
  canvasFor,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useState } from "react";
import { engine, isTauri } from "../engine";
import { performThumbnailExport } from "../exportThumbnail";
import { LabeledSlider } from "../ui/Fields";
import { ModalShell } from "../ui/ModalShell";
import { ThumbnailPreview } from "./ThumbnailPreview";

type Phase = "idle" | "exporting" | "done" | "error";

export function ThumbnailExportDialog({ onClose }: { onClose: () => void }) {
  const aspectRatio = useTrailerStore((s) => s.thumbnail.aspectRatio);

  const [size, setSize] = useState<ThumbnailSize>("1080");
  const [format, setFormat] = useState<ImageFormat>("png");
  const [quality, setQuality] = useState(90);
  const [available, setAvailable] = useState<ImageFormat[]>(["png", "jpeg"]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [savedPath, setSavedPath] = useState("");

  const busy = phase === "exporting";
  const spec = IMAGE_FORMATS.find((f) => f.id === format) ?? IMAGE_FORMATS[0];
  const shortSide = THUMBNAIL_SIZES.find((s) => s.id === size)?.shortSide ?? 1080;
  const output = canvasFor(aspectRatio, shortSide);

  // WebP/AVIF depend on how the bundled FFmpeg was built — only offer what it has.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    engine
      .imageFormats()
      .then((formats) => {
        if (!cancelled && formats.length) setAvailable(formats);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function onExport() {
    if (!isTauri()) {
      setError("Export runs in the desktop app — launch it with `pnpm dev`.");
      setPhase("error");
      return;
    }
    const outPath = await engine.pickSavePath(`thumbnail.${spec.ext}`, {
      name: `${spec.label} image`,
      extensions: [spec.ext],
    });
    if (!outPath) return;

    setPhase("exporting");
    setError("");
    try {
      await performThumbnailExport(outPath, { shortSide, format, quality });
      setSavedPath(outPath);
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }

  return (
    <ModalShell
      onClose={busy ? () => {} : onClose}
      className="w-[520px] max-w-full rounded-2xl bg-surface p-5 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Export thumbnail</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      <p className="mb-3 text-xs text-muted">
        {output.width}×{output.height} · {spec.label}
      </p>

      <div className="mb-4">
        <ThumbnailPreview maxHeight="28vh" interactive={false} />
      </div>

      <div className="mb-4 flex gap-2">
        {THUMBNAIL_SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            onClick={() => setSize(s.id)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              size === s.id
                ? "border-accent bg-accent/10"
                : "border-border bg-surface-secondary hover:bg-surface-tertiary"
            }`}
          >
            <span className="font-medium">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {IMAGE_FORMATS.map((f) => {
          const supported = available.includes(f.id);
          return (
            <button
              key={f.id}
              type="button"
              disabled={busy || !supported}
              onClick={() => setFormat(f.id)}
              title={supported ? undefined : "This FFmpeg build can't write this format"}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
                format === f.id
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface-secondary hover:bg-surface-tertiary"
              }`}
            >
              <span className="font-medium">{f.label}</span>
              <span className="text-xs text-muted">{f.hint}</span>
            </button>
          );
        })}
      </div>

      {spec.lossless ? null : (
        <div className="mb-4">
          <LabeledSlider
            label="Quality"
            value={quality}
            min={30}
            max={100}
            step={1}
            disabled={busy}
            onChange={setQuality}
            format={(v) => `${Math.round(v)}%`}
          />
        </div>
      )}

      {busy ? (
        <p className="mb-4 rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">
          Rendering at full resolution…
        </p>
      ) : null}
      {phase === "done" ? (
        <p className="mb-4 break-all rounded-lg bg-success/10 px-3 py-2 text-xs text-success-foreground">
          ✅ Saved to {savedPath}
        </p>
      ) : null}
      {phase === "error" ? (
        <p className="mb-4 break-all rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="tertiary" onPress={onClose} isDisabled={busy}>
          {phase === "done" ? "Close" : "Cancel"}
        </Button>
        <Button onPress={onExport} isDisabled={busy}>
          {busy ? "Exporting…" : phase === "done" ? "Export again" : "Export"}
        </Button>
      </div>
    </ModalShell>
  );
}
