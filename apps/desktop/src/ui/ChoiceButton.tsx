import type { ReactNode } from "react";

/** One option in a row/grid of mutually exclusive choices (presets, codecs, formats). */
export function ChoiceButton({
  selected,
  onSelect,
  disabled,
  title,
  className = "",
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      title={title}
      className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
        selected
          ? "border-accent bg-accent/10"
          : "border-border bg-surface-secondary hover:bg-surface-tertiary"
      } ${className}`}
    >
      {children}
    </button>
  );
}
