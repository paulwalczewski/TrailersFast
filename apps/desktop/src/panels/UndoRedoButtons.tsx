import { useTrailerStore } from "@trailerfast/state";
import { useEffect } from "react";

export function UndoRedoButtons() {
  const undo = useTrailerStore((s) => s.undo);
  const redo = useTrailerStore((s) => s.redo);
  const canUndo = useTrailerStore((s) => s.past.length > 0);
  const canRedo = useTrailerStore((s) => s.future.length > 0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      // Let native undo/redo win while editing text.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      if (isRedo) redo();
      else undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div className="flex items-center gap-0.5">
      <IconButton onPress={undo} disabled={!canUndo} label="Undo (⌘Z)">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h11a4 4 0 1 1 0 8h-1" />
      </IconButton>
      <IconButton onPress={redo} disabled={!canRedo} label="Redo (⌘⇧Z)">
        <path d="M15 14l5-5-5-5" />
        <path d="M20 9H9a4 4 0 1 0 0 8h1" />
      </IconButton>
    </div>
  );
}

function IconButton({
  onPress,
  disabled,
  label,
  children,
}: {
  onPress: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-lg text-muted transition-colors enabled:hover:bg-surface-tertiary enabled:hover:text-foreground disabled:opacity-30"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}
