import { useTrailerStore } from "@trailerfast/state";
import { GuideOverlay } from "../ui/GuideOverlay";
import { useBrowseAssets } from "../useIngest";

/**
 * First-run guide over the main column while there are no assets: an arrow
 * toward the Assets panel + a link that opens the picker.
 */
export function OnboardingOverlay() {
  const hasAssets = useTrailerStore((s) => s.assets.length > 0);
  const browse = useBrowseAssets();
  if (hasAssets) return null;

  return (
    <GuideOverlay arrow="left" title="Add your first video">
      Drag &amp; drop a video onto the{" "}
      <span className="font-medium text-foreground">Assets</span> panel on the left to start marking
      clips —{" "}
      <button
        type="button"
        onClick={browse}
        className="font-medium text-accent underline underline-offset-2 hover:opacity-80"
      >
        or browse for one
      </button>
      .
    </GuideOverlay>
  );
}

/**
 * The next step once a video is in: the trailer is built by marking clips on the
 * source filmstrip above, so cover the empty trailer card and point at it.
 */
export function MarkFirstClipOverlay() {
  const hasAssets = useTrailerStore((s) => s.assets.length > 0);
  const hasMarkers = useTrailerStore((s) => s.markers.length > 0);
  if (!hasAssets || hasMarkers) return null;

  return (
    <GuideOverlay arrow="up" title="Mark your first clip">
      Click the source filmstrip above to mark a clip for your trailer. Mark as many as you like —
      they can be reordered and trimmed afterwards.
    </GuideOverlay>
  );
}
