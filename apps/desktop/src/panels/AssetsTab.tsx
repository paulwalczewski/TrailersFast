import { Card, Checkbox } from "@heroui/react";
import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useState } from "react";
import { isTauri } from "../engine";
import { Spinner } from "../ui/Spinner";
import { fileRefFromPath, isVideoPath, useBrowseAssets, useIngest } from "../useIngest";

export function AssetsTab() {
  const assets = useTrailerStore((s) => s.assets);
  const toggle = useTrailerStore((s) => s.toggleAssetSelected);
  const removeAsset = useTrailerStore((s) => s.removeAsset);
  const ingest = useIngest();
  const onBrowse = useBrowseAssets();
  const [isOver, setIsOver] = useState(false);

  // OS drag-and-drop: Tauri delivers real file paths via a native window event.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const un = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsOver(true);
        } else if (payload.type === "leave") {
          setIsOver(false);
        } else if (payload.type === "drop") {
          setIsOver(false);
          const paths = payload.paths.filter(isVideoPath);
          if (paths.length) ingest(paths.map(fileRefFromPath));
        }
      });
      if (cancelled) un();
      else unlisten = un;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ingest]);


  return (
    <div className="flex h-full flex-col gap-3">
      {assets.length > 0 && (
        <ul className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {assets.map((a) => (
            <li key={a.id}>
              <Card className="relative border border-separator bg-surface-secondary p-3 shadow-sm">
                <button
                  type="button"
                  onClick={() => removeAsset(a.id)}
                  aria-label={`Delete ${a.fileName}`}
                  className="absolute right-1 top-1 z-10 grid size-5 place-items-center text-muted transition-colors hover:text-danger"
                >
                  ✕
                </button>
                <div className="flex flex-row items-center gap-2.5">
                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-tertiary text-xs text-muted">
                    {a.posterUrl ? (
                      <img src={a.posterUrl} alt="" className="size-full object-cover" />
                    ) : a.loading || a.mediaLoading ? (
                      <Spinner />
                    ) : (
                      "▶"
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.fileName}</p>
                    <p className="text-xs text-muted">
                      {a.loading
                        ? "Analyzing…"
                        : `${a.width}×${a.height} · ${Math.round(a.durationSec)}s · ${Math.round(a.fps)}fps`}
                    </p>
                  </div>
                  <Checkbox
                    isSelected={a.selected}
                    onChange={() => toggle(a.id)}
                    isDisabled={a.loading}
                    aria-label={`Include ${a.fileName} on the source timeline`}
                    className="mr-1.5"
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                    </Checkbox.Content>
                  </Checkbox>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onBrowse}
        className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 text-center transition-colors ${
          assets.length === 0 ? "min-h-32 flex-1" : "shrink-0 py-5"
        } ${
          isOver
            ? "border-accent bg-accent/10"
            : "border-border bg-surface-secondary hover:border-accent/60 hover:bg-surface-tertiary"
        }`}
      >
        <span className="text-2xl text-accent">⬆</span>
        <span className="text-sm font-medium">Drag &amp; drop videos here</span>
        <span className="text-xs text-muted">or click to browse</span>
      </button>
    </div>
  );
}
