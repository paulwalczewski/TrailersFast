import { type EditorMode, useTrailerStore } from "@trailerfast/state";
import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";

const MODES: { id: EditorMode; label: string; icon: ReactNode }[] = [
  {
    id: "trailer",
    label: "Video Trailer",
    icon: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m10 9 5 3-5 3z" />
      </>
    ),
  },
  {
    id: "thumbnail",
    label: "Thumbnail",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="m21 16-5-5L5 20" />
      </>
    ),
  },
];

/**
 * The two editors this app holds, switched from the middle of the header. They
 * share the imported assets and nothing else — each has its own sidebar, work
 * area and export.
 */
export function ModeTabs() {
  const mode = useTrailerStore((s) => s.mode);
  const setMode = useTrailerStore((s) => s.setMode);

  return (
    <div
      role="tablist"
      aria-label="Editor mode"
      className="flex items-center gap-1 rounded-xl bg-surface-secondary p-1"
    >
      {MODES.map((m) => {
        const selected = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setMode(m.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              selected
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:bg-surface-tertiary hover:text-foreground"
            }`}
          >
            <Icon size={15}>{m.icon}</Icon>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
