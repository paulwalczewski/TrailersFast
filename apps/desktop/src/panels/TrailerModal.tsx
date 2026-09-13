import type { PlayerRef } from "@remotion/player";
import { PROXY_SIDE } from "@trailerfast/core";
import type { RefObject } from "react";
import { ModalHeader } from "../ui/ModalHeader";
import { ModalShell } from "../ui/ModalShell";
import { useProxies } from "../useProxies";
import { TrailerPreview } from "./TrailerPreview";
import { TrailerTimeline } from "./TrailerTimeline";

/** Fullscreen view of the trailer timeline + preview. Its player is owned by the
 *  work area, which routes the play/pause key to whichever preview is on screen. */
export function TrailerModal({
  playerRef,
  onClose,
}: {
  playerRef: RefObject<PlayerRef | null>;
  onClose: () => void;
}) {
  // Encodes the sharper tier while the enlarged view is open; the preview shows
  // the inline proxies until each one lands.
  useProxies(PROXY_SIDE.enlarged);

  return (
    <ModalShell
      onClose={onClose}
      className="flex max-h-[94vh] w-[92vw] max-w-6xl flex-col gap-3 rounded-2xl bg-surface p-4 shadow-xl"
    >
      <ModalHeader title="Trailer" onClose={onClose} className="mb-0" />
      <TrailerTimeline playerRef={playerRef} />
      <TrailerPreview playerRef={playerRef} maxHeight="66vh" proxyShortSide={PROXY_SIDE.enlarged} />
    </ModalShell>
  );
}
