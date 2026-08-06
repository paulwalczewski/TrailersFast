/**
 * Font helpers for the canvas renderers (thumbnail + intro/outro images) and
 * their previews. The bundled decorative faces are declared as @font-face in
 * index.css and embedded in the Rust binary for the FFmpeg export (see
 * src-tauri/src/export.rs). Canvas draws silently fall back to a system font if
 * a face hasn't loaded yet, so the export paths await `ensureFontsLoaded` first
 * and the live previews redraw once fonts arrive.
 */

/** Resolve once the given families are loaded, so a canvas draw uses them. */
export async function ensureFontsLoaded(families: Array<string | undefined>): Promise<void> {
  if (!document.fonts) return;
  await Promise.all(
    families
      .filter((f): f is string => !!f)
      .map((f) => document.fonts.load(`16px "${f.replace(/"/g, "")}"`).catch(() => {})),
  );
}

/** Canvas `font` shorthand family segment: quoted, with a sans-serif fallback. */
export function quoteFamily(family: string): string {
  return `"${family.replace(/"/g, "")}", sans-serif`;
}
