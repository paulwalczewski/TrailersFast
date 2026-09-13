import { ModalHeader } from "../ui/ModalHeader";
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
      <ModalHeader title="Thumbnail" onClose={onClose} className="mb-0" />
      <ThumbnailPreview maxHeight="66vh" />
    </ModalShell>
  );
}
