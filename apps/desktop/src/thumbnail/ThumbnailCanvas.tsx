import type { ThumbnailConfig } from "@trailerfast/core";
import { useEffect, useRef, useState } from "react";
import { drawThumbnail, type LoadedFrame } from "./drawThumbnail";

type Props = {
  config: ThumbnailConfig;
  /** Drawable frames, parallel to `config.frames` (nulls render as backdrop). */
  images: (LoadedFrame | null)[];
  className?: string;
};

/**
 * The thumbnail, painted into a canvas that tracks its own CSS box (at device
 * pixel ratio, so text stays crisp). Same draw call the export uses — this IS
 * the output, just smaller.
 */
export function ThumbnailCanvas({ config, images, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Backing-store size in device pixels; a resize triggers a redraw through state.
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Bumped when web fonts finish loading, so a bundled @font-face title repaints
  // instead of staying on the fallback it drew with on first paint.
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box) return;
      setSize({
        width: Math.max(1, Math.round(box.width * dpr)),
        height: Math.max(1, Math.round(box.height * dpr)),
      });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fontsReady is a deliberate redraw trigger
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || size.width === 0) return;
    canvas.width = size.width;
    canvas.height = size.height;
    drawThumbnail(ctx, size.width, size.height, config, images);
  }, [config, images, size, fontsReady]);

  return <canvas ref={canvasRef} className={className} />;
}
