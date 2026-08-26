import { Button } from "@heroui/react";
import { type ExportPreset, exportPresetsFor } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useState } from "react";
import { engine, isTauri } from "../engine";
import { performExport } from "../exportTrailer";
import { ModalShell } from "../ui/ModalShell";

type Phase = "idle" | "exporting" | "done" | "error";

const CODECS = [
  { id: "h264", label: "H.264", hint: "plays everywhere" },
  { id: "hevc", label: "H.265", hint: "smaller file" },
] as const;

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const lastExportPath = useTrailerStore((s) => s.lastExportPath);
  const setLastExportPath = useTrailerStore((s) => s.setLastExportPath);
  const aspectRatio = useTrailerStore((s) => s.settings.aspectRatio);

  const [preset, setPreset] = useState<ExportPreset>("standard-1080");
  const [codec, setCodec] = useState<"h264" | "hevc">("h264");
  const [phase, setPhase] = useState<Phase>("idle");
  const [frac, setFrac] = useState(0);
  const [error, setError] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [warning, setWarning] = useState("");

  const busy = phase === "exporting";
  const presets = exportPresetsFor(aspectRatio);

  async function onExport() {
    if (!isTauri()) {
      setError("Export runs in the desktop app — launch it with `pnpm dev`.");
      setPhase("error");
      return;
    }
    const outPath = await engine.pickSavePath(lastExportPath || "trailer.mp4");
    if (!outPath) return;
    setLastExportPath(outPath);

    setPhase("exporting");
    setFrac(0);
    setError("");
    try {
      const w = await performExport(outPath, { preset, codec }, setFrac);
      setSavedPath(outPath);
      setWarning(w);
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }

  return (
    <ModalShell
      onClose={busy ? () => {} : onClose}
      className="w-[460px] max-w-full rounded-2xl bg-surface p-5 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Export trailer</h2>
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
      <p className="mb-4 text-xs text-muted">
        Choose a quality preset and codec — sizes are for the {aspectRatio} canvas.
      </p>

        <div className="mb-4 flex flex-col gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => setPreset(p.id)}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                preset === p.id
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface-secondary hover:bg-surface-tertiary"
              }`}
            >
              <span className="font-medium">{p.label}</span>
              <span className="text-xs text-muted">{p.hint}</span>
            </button>
          ))}
        </div>

        <div className="mb-4 flex gap-2">
          {CODECS.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => setCodec(c.id)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                codec === c.id
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface-secondary hover:bg-surface-tertiary"
              }`}
            >
              <span className="font-medium">{c.label}</span>
              <span className="ml-1 text-xs text-muted">{c.hint}</span>
            </button>
          ))}
        </div>

        {phase === "exporting" ? (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>Encoding…</span>
              <span>{Math.round(frac * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-tertiary">
              <div className="h-full bg-accent transition-all" style={{ width: `${frac * 100}%` }} />
            </div>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="mb-4 flex flex-col gap-2">
            <p className="break-all rounded-lg bg-success/10 px-3 py-2 text-xs text-success-foreground">
              ✅ Saved to {savedPath}
            </p>
            {warning ? (
              <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs text-warning-foreground">
                ⚠️ {warning}
              </p>
            ) : null}
          </div>
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
