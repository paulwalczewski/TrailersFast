import {
  type ExportCodec,
  type ExportOpts,
  type ExportPreset,
  type Project,
  buildExportPlan,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import type { Progress } from "@trailerfast/video-engine";
import { engine } from "./engine";
import { ensureFontsLoaded } from "./fonts";
import { renderIntroImage } from "./renderIntroImage";

/**
 * Build the export plan from the current project state and run the FFmpeg
 * export. Shared by the Export dialog and the MCP `export_trailer` tool.
 * Returns the export warning string ("" when clean).
 */
export async function performExport(
  outPath: string,
  opts: { preset: ExportPreset; codec: ExportCodec },
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const { assets, markers, intro, outro, watermark, settings, thumbnail } =
    useTrailerStore.getState();
  const project: Project = { assets, markers, intro, outro, watermark, settings, thumbnail };
  const exportOpts: ExportOpts = { ...opts, container: "mp4" };
  const plan = buildExportPlan(project, exportOpts);
  // Render the title cards (emoji + fonts) to images the way the preview does.
  // Await the chosen faces first so a bundled @font-face isn't missed by the
  // synchronous canvas draw inside renderIntroImage.
  await ensureFontsLoaded([intro.fontFamily, outro.fontFamily]);
  if (plan.intro) plan.introImage = renderIntroImage(intro, plan.width, plan.height);
  if (plan.outro) plan.outroImage = renderIntroImage(outro, plan.width, plan.height);
  return engine.export(plan, outPath, (p: Progress) => onProgress?.(p.fraction));
}
