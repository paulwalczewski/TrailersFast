/**
 * Desktop implementation of VideoEngine. Bridges to Rust `#[tauri::command]`s
 * that drive the bundled FFmpeg sidecar. Kept dependency-light so the web
 * adapter can mirror the same shape without importing Tauri.
 */
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { type ExportPlan, VIDEO_EXTENSIONS } from "@trailerfast/core";
import type { FileRef, MediaInfo, Progress, VideoEngine } from "./index";

export function createTauriVideoEngine(): VideoEngine {
  return {
    async pickFiles(): Promise<FileRef[]> {
      // Dynamic import keeps the dialog plugin out of the browser-dev bundle path.
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selection = await open({
        multiple: true,
        filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
      });
      if (!selection) return [];
      const paths = Array.isArray(selection) ? selection : [selection];
      return paths.map((path) => ({ path, fileName: path.split(/[/\\]/).pop() ?? path }));
    },

    probe(file: FileRef): Promise<MediaInfo> {
      return invoke<MediaInfo>("probe_media", { path: file.path });
    },

    thumbnails(file: FileRef, atSecs: number[]): Promise<string[]> {
      return invoke<string[]>("generate_thumbnails", { path: file.path, atSecs });
    },

    generateProxy(file: FileRef, startSec: number, lengthSec: number): Promise<string> {
      return invoke<string>("generate_proxy", { path: file.path, startSec, lengthSec });
    },

    toPlayableUrl(path: string): string {
      return convertFileSrc(path);
    },

    async pickSavePath(defaultName: string): Promise<string | null> {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "MP4 video", extensions: ["mp4"] }],
      });
      return path ?? null;
    },

    export(
      plan: ExportPlan,
      outPath: string,
      onProgress: (p: Progress) => void,
    ): Promise<string> {
      const channel = new Channel<Progress>();
      channel.onmessage = onProgress;
      return invoke<string>("export_trailer", { plan, outPath, onProgress: channel });
    },
  };
}
