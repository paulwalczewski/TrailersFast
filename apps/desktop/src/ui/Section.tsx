import { type ReactNode, useState } from "react";
import { Icon } from "./Icon";

/** Collapsible sidebar section with an "On" badge when its feature is enabled. */
export function Section({
  title,
  enabled,
  defaultOpen = false,
  children,
}: {
  title: string;
  enabled: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-separator bg-surface-secondary">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-tertiary"
      >
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex items-center gap-2">
          {enabled ? (
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
              On
            </span>
          ) : null}
          <Icon size={14} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" />
          </Icon>
        </span>
      </button>
      {open ? <div className="border-t border-separator p-3">{children}</div> : null}
    </div>
  );
}
