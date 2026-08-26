import { THUMBNAIL_TEMPLATES } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useState } from "react";
import { Icon } from "../ui/Icon";
import { ThumbnailModal } from "./ThumbnailModal";
import { ThumbnailPreview } from "./ThumbnailPreview";

/** The finished thumbnail, in the same card the trailer preview sits in. */
export function ThumbnailSection() {
  const template = useTrailerStore((s) => s.thumbnail.template);
  const frameCount = useTrailerStore((s) => s.thumbnail.frames.length);
  const [expanded, setExpanded] = useState(false);

  const templateLabel =
    THUMBNAIL_TEMPLATES.find((t) => t.id === template)?.label ?? THUMBNAIL_TEMPLATES[0].label;

  return (
    <section className="rounded-2xl border border-separator bg-surface-secondary p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Thumbnail</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            {templateLabel} · {frameCount} frame{frameCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Enlarge thumbnail"
            className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
          >
            <Icon>
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </Icon>
          </button>
        </div>
      </div>

      <ThumbnailPreview />

      {expanded ? <ThumbnailModal onClose={() => setExpanded(false)} /> : null}
    </section>
  );
}
