/** Small accent spinner shown wherever media is loading. */
export function Spinner() {
  return <div className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
}

/** Pulsing block with a centered spinner — placeholder for pending thumbnails. */
export function MediaLoadingPlaceholder() {
  return (
    <div className="pointer-events-none grid size-full animate-pulse place-items-center bg-surface-tertiary">
      <Spinner />
    </div>
  );
}
