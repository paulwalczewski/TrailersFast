/** Trailers Fast mark: a filled rounded square with a fast-forward cut out of it. */
export function Logo() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      className="text-accent"
      aria-hidden="true"
    >
      <defs>
        <mask id="tf-ff-mask">
          {/* white = keep the fill, black = cut through to the background */}
          <rect x="3" y="3" width="18" height="18" rx="4.5" fill="white" />
          <path d="M7.4 7.6 12 12 7.4 16.4Z" fill="black" />
          <path d="M12 7.6 16.6 12 12 16.4Z" fill="black" />
        </mask>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="4.5" fill="currentColor" mask="url(#tf-ff-mask)" />
    </svg>
  );
}
