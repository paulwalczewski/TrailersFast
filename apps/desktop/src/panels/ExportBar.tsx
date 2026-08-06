import { Button } from "@heroui/react";
import { trailerDuration } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useState } from "react";
import { Icon } from "../ui/Icon";
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
        <Icon className="mr-1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </Icon>
        Export Trailer
      </Button>
      {showExport ? <ExportDialog onClose={() => setShowExport(false)} /> : null}
    </div>
  );
}
