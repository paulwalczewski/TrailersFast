import { Button } from "@heroui/react";
import { useTrailerStore } from "@trailerfast/state";
import { useState } from "react";
import { IconButton } from "../ui/IconButton";
import { ModalShell } from "../ui/ModalShell";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Header action that empties the project so the user can start a new trailer. */
export function NewTrailerButton() {
  const assetCount = useTrailerStore((s) => s.assets.length);
  const clipCount = useTrailerStore((s) => s.markers.length);
  const clearProject = useTrailerStore((s) => s.clearProject);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <IconButton
        onPress={() => setConfirming(true)}
        disabled={assetCount === 0 && clipCount === 0}
        label="New trailer — clear videos & clips"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      </IconButton>
      {confirming ? (
        <ModalShell
          onClose={() => setConfirming(false)}
          className="w-[420px] max-w-full rounded-2xl bg-surface p-5 shadow-xl"
        >
          <h2 className="text-lg font-semibold">Start a new trailer?</h2>
          <p className="mt-2 text-sm text-muted">
            This removes {plural(assetCount, "video")} and {plural(clipCount, "marked clip")}, along
            with any frames picked for the thumbnail. Your text, watermark and export settings stay
            as they are, and ⌘Z undoes it.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="tertiary" onPress={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                clearProject();
                setConfirming(false);
              }}
            >
              Clear everything
            </Button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}
