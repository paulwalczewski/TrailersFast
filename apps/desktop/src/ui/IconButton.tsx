import type { ReactNode } from "react";

/** Compact header icon button (undo/redo/new); children are the SVG paths. */
export function IconButton({
  onPress,
  disabled,
  label,
  children,
}: {
  onPress: () => void;
  disabled: boolean;
  label: string;
  children: ReactNode;
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
