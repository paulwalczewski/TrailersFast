/** Small spinner shown wherever media is loading. Pass a full size+color
 * className to restyle (the default is the media-loading accent look). */
export function Spinner({
  className = "size-5 border-accent border-t-transparent",
}: {
  className?: string;
}) {
  return <div className={`animate-spin rounded-full border-2 ${className}`} />;
}

/** Pulsing block with a centered spinner — placeholder for pending thumbnails. */
export function MediaLoadingPlaceholder() {
  return (
    <div className="pointer-events-none grid size-full animate-pulse place-items-center bg-surface-tertiary">
      <Spinner />
    </div>
  );
}
