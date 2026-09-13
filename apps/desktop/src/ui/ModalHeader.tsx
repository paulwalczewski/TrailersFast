import type { ReactNode } from "react";

/** Title row + close button shared by every modal. `children` sit next to the title. */
export function ModalHeader({
  title,
  onClose,
  disabled,
  className = "mb-1",
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  /** Keep the dialog open (e.g. mid-export). */
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        aria-label="Close"
        className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground disabled:opacity-40"
      >
        ✕
      </button>
    </div>
  );
}
