import { Button } from "@heroui/react";
import { trailerDuration } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useState } from "react";
import { ExportDialog } from "./ExportDialog";

export function ExportBar() {
  const markers = useTrailerStore((s) => s.markers);
  const [showExport, setShowExport] = useState(false);

  const count = markers.length;
  const trailerLen = trailerDuration(markers);

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-xs text-muted sm:inline">
        {count
          ? `${count} clip${count > 1 ? "s" : ""} · ${trailerLen.toFixed(1)}s`
          : "No clips marked yet"}
      </span>
      <Button isDisabled={count === 0} onPress={() => setShowExport(true)}>
        Export Trailer
      </Button>
      {showExport ? <ExportDialog onClose={() => setShowExport(false)} /> : null}
    </div>
  );
}
