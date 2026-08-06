import { useTrailerStore } from "@trailerfast/state";
import { ThumbnailWorkArea } from "./ThumbnailWorkArea";
import { TrailerWorkArea } from "./TrailerWorkArea";

/** The main column: one editor per header mode, over the shared asset list. */
export function WorkArea() {
  const mode = useTrailerStore((s) => s.mode);
  return mode === "thumbnail" ? <ThumbnailWorkArea /> : <TrailerWorkArea />;
}
