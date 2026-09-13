import {
  byId,
  canvasFor,
  clipRenderBox,
  defaultTransform,
  filmstripFrameAt,
  proxyKey,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../engine";
import { clipBoxStyle, useMediaReady } from "../ui/clipMedia";
import { ModalHeader } from "../ui/ModalHeader";
import { ModalShell } from "../ui/ModalShell";
import { TransformEditor } from "../ui/TransformEditor";

/**
 * Reposition a clip within the trailer canvas: pan (drag or sliders) + zoom.
 * Offsets are normalized to the clip's overflow, so every reachable position
 * keeps the canvas fully covered — no black space can appear in the export.
 */
export function ClipTransformModal({
  markerId,
  onClose,
}: {
  markerId: string;
  onClose: () => void;
}) {
  const marker = useTrailerStore((s) => s.markers.find((m) => m.id === markerId));
  const assets = useTrailerStore((s) => s.assets);
  const settings = useTrailerStore((s) => s.settings);
  const proxies = useTrailerStore((s) => s.proxies);
  const setMarkerTransform = useTrailerStore((s) => s.setMarkerTransform);

  const asset = marker ? byId(assets)[marker.assetId] : undefined;

  // "Drag to reposition" hint: once the user zooms for the first time (per
  // modal open), they've discovered the controls — fade the hint out shortly.
  const [hintDismissed, setHintDismissed] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(hintTimer.current ?? undefined), []);

  const canvas = canvasFor(settings.aspectRatio, 1080);
  const transform = marker?.transform ?? defaultTransform();

  const box = useMemo(
    () =>
      clipRenderBox(
        asset?.width ?? 0,
        asset?.height ?? 0,
        canvas.width,
        canvas.height,
        settings.fitMode,
        transform,
      ),
    [asset?.width, asset?.height, canvas.width, canvas.height, settings.fitMode, transform],
  );

  // Proxy (already the trimmed clip) when ready; the raw source otherwise.
  const proxyPath = marker ? proxies[proxyKey(marker)] : undefined;
  const mediaUrl = proxyPath
    ? engine.toPlayableUrl(proxyPath)
    : asset
      ? engine.toPlayableUrl(asset.path)
      : "";
  // Show the middle frame of the clip — most representative for framing.
  const mediaTime = marker
    ? proxyPath
      ? marker.lengthSec / 2
      : marker.startSec + marker.lengthSec / 2
    : 0;
  // The webview paints <video> black until a frame is decoded — keep it hidden
  // (showing the instant filmstrip backdrop) until the seek target is ready.
  const [videoReady, markReady] = useMediaReady(mediaUrl);

  if (!marker || !asset) return null;

  // Filmstrip frame nearest the clip middle: an instant, representative backdrop.
  const backdrop =
    filmstripFrameAt(
      asset.filmstripUrls,
      marker.startSec + marker.lengthSec / 2,
      asset.durationSec,
    ) ?? asset.posterUrl;
  const mediaStyle = clipBoxStyle(box, { flip: settings.flipHorizontal, canvas });

  return (
    <ModalShell
      onClose={onClose}
      className="w-[560px] max-w-full rounded-2xl bg-surface p-5 shadow-xl"
    >
      <ModalHeader title="Position & zoom" onClose={onClose} className="mb-3" />
      <TransformEditor
        frame={canvas}
        box={box}
        transform={transform}
        maxHeight="48vh"
        showHint={!hintDismissed}
        onChange={(patch) => {
          setMarkerTransform(markerId, patch);
          if (patch.zoom !== undefined) {
            hintTimer.current ??= setTimeout(() => setHintDismissed(true), 3000);
          }
        }}
        onReset={() => setMarkerTransform(markerId, defaultTransform())}
        onDone={onClose}
      >
        {backdrop ? <img src={backdrop} alt="" style={mediaStyle} /> : null}
        <video
          key={mediaUrl}
          src={mediaUrl}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = mediaTime;
          }}
          onSeeked={markReady}
          style={{ ...mediaStyle, opacity: videoReady ? 1 : 0 }}
        />
      </TransformEditor>
    </ModalShell>
  );
}
