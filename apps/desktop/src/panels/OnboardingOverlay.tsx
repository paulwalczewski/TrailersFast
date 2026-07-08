import { useTrailerStore } from "@trailerfast/state";
import { useBrowseAssets } from "../useIngest";

/**
 * First-run guide shown over the main column while there are no assets: a
 * left-pointing arrow toward the Assets panel + a link that opens the picker.
 */
export function OnboardingOverlay() {
  const hasAssets = useTrailerStore((s) => s.assets.length > 0);
  const browse = useBrowseAssets();
  if (hasAssets) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center bg-background/70 p-8 backdrop-blur-[2px]">
      <style>{"@keyframes tf-nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(-7px)}}"}</style>
      <div className="flex items-center gap-4">
        <svg
          width="52"
          height="52"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-accent"
          style={{ animation: "tf-nudge 1.2s ease-in-out infinite" }}
          aria-hidden="true"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
        <div className="max-w-sm rounded-2xl border border-separator bg-surface p-5 shadow-xl">
          <h2 className="text-base font-semibold">Add your first video</h2>
          <p className="mt-1 text-sm text-muted">
            Drag &amp; drop a video onto the{" "}
            <span className="font-medium text-foreground">Assets</span> panel on the left to start
            marking clips —{" "}
            <button
              type="button"
              onClick={browse}
              className="font-medium text-accent underline underline-offset-2 hover:opacity-80"
            >
              or browse for one
            </button>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
