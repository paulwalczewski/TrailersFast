/**
 * The seam between the React UI and the platform. UI code depends ONLY on this
 * interface — never on `@tauri-apps/api` or a web backend directly. Desktop
 * injects `TauriVideoEngine`; a future web app injects a `WebVideoEngine`.
 */
import type { ExportPlan } from "@trailerfast/core";

/** A reference to a file the engine can read. */
export type FileRef = { path: string; fileName: string };

/** Result of probing a media file. */
export type MediaInfo = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

/** Export progress event, 0..1 plus a human stage label. */
export type Progress = { fraction: number; stage: string; etaSec?: number };

export interface VideoEngine {
  /** Open a native/web file picker; returns chosen video files. */
  pickFiles(): Promise<FileRef[]>;
  /** ffprobe-equivalent metadata. */
  probe(file: FileRef): Promise<MediaInfo>;
  /** Generate thumbnails at the given timestamps; returns displayable URLs. */
  thumbnails(file: FileRef, atSecs: number[]): Promise<string[]>;
  /** Render a small proxy clip (trimmed, starts at 0) for smooth preview; returns its path. */
  generateProxy(file: FileRef, startSec: number, lengthSec: number): Promise<string>;
  /** Convert a local file path into a URL the webview/player can load. */
  toPlayableUrl(path: string): string;
  /** Open a save dialog; returns the chosen output path or null if cancelled. */
  pickSavePath(defaultName: string): Promise<string | null>;
  /** Run the full export pipeline, reporting progress; resolves to a warning string ("" if none). */
  export(plan: ExportPlan, outPath: string, onProgress: (p: Progress) => void): Promise<string>;
}

export { createTauriVideoEngine } from "./tauri";
