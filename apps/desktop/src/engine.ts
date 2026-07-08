import { createTauriVideoEngine, type VideoEngine } from "@trailerfast/video-engine";

/** True when running inside the Tauri webview (vs. plain `vite` in a browser). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * The single injected engine instance. UI imports THIS, never `@tauri-apps/api`.
 * Swapping to a web backend later means pointing this at a WebVideoEngine.
 */
export const engine: VideoEngine = createTauriVideoEngine();
