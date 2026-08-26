import { ModalShell } from "../ui/ModalShell";
import { ThumbnailPreview } from "./ThumbnailPreview";

/** Fullscreen view of the thumbnail. Tiles stay reframeable at this size — it's
 *  the view you open to judge the crop. */
export function ThumbnailModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell
      onClose={onClose}
      className="flex max-h-[94vh] w-[92vw] max-w-6xl flex-col gap-3 rounded-2xl bg-surface p-4 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Thumbnail</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <ThumbnailPreview maxHeight="66vh" />
    </ModalShell>
  );
}
