import { type ReactNode, useRef } from "react";

/** Backdrop + centered panel with click-outside-to-close. */
export function ModalShell({
  onClose,
  className,
  children,
}: {
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  // A drag that starts inside the panel and is released over the backdrop
  // synthesizes a click on the backdrop (the targets' common ancestor). Only
  // close when the press also STARTED on the backdrop — a real outside click.
  const pressStartedOnBackdrop = useRef(false);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onPointerDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnBackdrop.current) onClose();
      }}
    >
      <div className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
