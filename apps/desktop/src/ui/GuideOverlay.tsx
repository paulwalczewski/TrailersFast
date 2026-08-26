import type { ReactNode } from "react";

/**
 * First-run pointer: a nudging arrow aimed at the thing to click, next to a card
 * explaining it, over a dimmed copy of whatever isn't useful yet. Takes the
 * container's rounding so it can cover a panel or a card equally well.
 *
 * An upward arrow sits above the top edge, so it points at the panel above
 * rather than floating inside the thing it covers.
 */
export function GuideOverlay({
  arrow,
  title,
  children,
}: {
  /** Where the thing to click is, relative to this overlay. */
  arrow: "left" | "up";
  title: string;
  children: ReactNode;
}) {
  const up = arrow === "up";
  return (
    <div
      className={`absolute inset-0 z-20 flex rounded-[inherit] bg-background/70 p-6 backdrop-blur-[2px] ${
        up ? "items-start justify-center" : "items-center"
      }`}
    >
      <style>
        {"@keyframes tf-nudge-x{0%,100%{transform:translateX(0)}50%{transform:translateX(-7px)}}" +
          "@keyframes tf-nudge-y{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}"}
      </style>
      {/* One gap per variant: two gap-* classes on the same element are decided by
          stylesheet order, not by which is written last. */}
      <div className={`flex ${up ? "flex-col items-center gap-0" : "items-center gap-4"}`}>
        <svg
          width="52"
          height="52"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          // Lifted clear of the top edge so it points at the panel above rather
          // than at the inside of the card it covers. A negative margin on the
          // first flex item moves only the arrow — the card stays put.
          className={`shrink-0 text-accent ${up ? "-mt-12" : ""}`}
          style={{ animation: `${up ? "tf-nudge-y" : "tf-nudge-x"} 1.2s ease-in-out infinite` }}
          aria-hidden="true"
        >
          {up ? (
            <>
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </>
          ) : (
            <>
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </>
          )}
        </svg>
        <div
          className={`max-w-sm rounded-2xl border border-separator bg-surface p-5 shadow-xl ${
            up ? "text-center" : ""
          }`}
        >
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{children}</p>
        </div>
      </div>
    </div>
  );
}
