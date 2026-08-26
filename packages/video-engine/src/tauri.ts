/**
 * Desktop implementation of VideoEngine. Bridges to Rust `#[tauri::command]`s
 * that drive the bundled FFmpeg sidecar. Kept dependency-light so the web
 * adapter can mirror the same shape without importing Tauri.
 */
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { type ExportPlan, type ImageFormat, VIDEO_EXTENSIONS } from "@trailerfast/core";
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

    frames(
      file: FileRef,
      atSecs: number[],
      opts: { width?: number; lossless?: boolean } = {},
    ): Promise<string[]> {
      return invoke<string[]>("extract_frames", {
        path: file.path,
        atSecs,
        // 0 = keep the source width.
        width: Math.max(0, Math.round(opts.width ?? 0)),
        lossless: opts.lossless ?? false,
      });
    },

    generateProxy(
      file: FileRef,
      startSec: number,
      lengthSec: number,
      shortSide: number,
    ): Promise<string> {
      return invoke<string>("generate_proxy", { path: file.path, startSec, lengthSec, shortSide });
    },

    toPlayableUrl(path: string): string {
      return convertFileSrc(path);
    },

    async pickSavePath(
      defaultName: string,
      filter: { name: string; extensions: string[] } = {
        name: "MP4 video",
        extensions: ["mp4"],
      },
    ): Promise<string | null> {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: defaultName, filters: [filter] });
      return path ?? null;
    },

    imageFormats(): Promise<ImageFormat[]> {
      return invoke<ImageFormat[]>("image_formats");
    },

    saveImage(
      pngBase64: string,
      outPath: string,
      format: ImageFormat,
      quality: number,
    ): Promise<string> {
      return invoke<string>("save_image", {
        pngBase64,
        outPath,
        format,
        quality: Math.round(quality),
      });
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
