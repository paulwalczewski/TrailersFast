import { Player, type PlayerRef } from "@remotion/player";
import {
  buildTrailerClips,
  byId,
  canvasFor,
  type IntroConfig,
  introActive,
  PROXY_SIDE,
  proxyKey,
  totalFrames,
  watermarkActive,
} from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { type RefObject, useMemo } from "react";
import type { IntroProps } from "../composition/IntroTitle";
import {
  PREVIEW_FPS,
  type PreviewClip,
  TrailerComposition,
} from "../composition/TrailerComposition";
import type { WatermarkProps } from "../composition/WatermarkOverlay";
import { engine } from "../engine";

type Props = {
  playerRef: RefObject<PlayerRef | null>;
  /** CSS max-height for the preview (e.g. "30vh" inline, "66vh" in the modal). */
  maxHeight?: string;
  /** Proxy tier to prefer; falls back to the inline tier until that one exists. */
  proxyShortSide?: number;
};

/** Map an intro/outro config to composition props, capped to the trailer length. */
function titleCardProps(cfg: IntroConfig, maxFrames: number): IntroProps | null {
  if (!introActive(cfg)) return null;
  return {
    text: cfg.text,
    description: cfg.description,
    fontFamily: cfg.fontFamily,
    headingWeight: cfg.headingWeight,
    fontSizePx: cfg.fontSizePx,
    color: cfg.color,
    align: cfg.align,
    vAlign: cfg.vAlign,
    animation: cfg.animation,
    durationInFrames: Math.min(Math.round(cfg.durationSec * PREVIEW_FPS), maxFrames),
    shadowEnabled: cfg.shadowEnabled,
    shadowIntensity: cfg.shadowIntensity,
    shadowX: cfg.shadowX,
    shadowY: cfg.shadowY,
  };
}

export function TrailerPreview({
  playerRef,
  maxHeight = "36vh",
  proxyShortSide = PROXY_SIDE.inline,
}: Props) {
  const markers = useTrailerStore((s) => s.markers);
  const assets = useTrailerStore((s) => s.assets);
  const intro = useTrailerStore((s) => s.intro);
  const outro = useTrailerStore((s) => s.outro);
  const watermark = useTrailerStore((s) => s.watermark);
  const proxies = useTrailerStore((s) => s.proxies);
  const settings = useTrailerStore((s) => s.settings);

  const { width, height } = canvasFor(settings.aspectRatio, 1080);

  const assetsById = useMemo(() => byId(assets), [assets]);

  const clips = useMemo<PreviewClip[]>(
    () =>
      buildTrailerClips(markers, assetsById, PREVIEW_FPS).map((c) => {
        const asset = assetsById[c.assetId];
        // Thumbnails are already displayable URLs (used raw in the asset cards).
        const filmstripUrls = asset?.filmstripUrls ?? [];
        const common = {
          id: c.markerId,
          durationInFrames: c.durationInFrames,
          filmstripUrls,
          startSec: c.startSec,
          assetDurationSec: c.assetDurationSec,
          srcWidth: asset?.width ?? 0,
          srcHeight: asset?.height ?? 0,
          transform: c.transform,
        };
        // Sharpest tier that has finished encoding; the inline one is always the
        // first to exist, and the source is the fallback until any proxy is ready.
        const proxy = proxies[proxyKey(c, proxyShortSide)] ?? proxies[proxyKey(c)];
        // Proxy plays linearly from 0 (smooth); source+trim is the fallback until ready.
        return proxy
          ? { ...common, src: engine.toPlayableUrl(proxy), trimBeforeInFrames: 0 }
          : {
              ...common,
              src: engine.toPlayableUrl(c.assetPath),
              trimBeforeInFrames: c.trimBeforeInFrames,
            };
      }),
    [markers, assetsById, proxies, proxyShortSide],
  );

  const durationInFrames = Math.max(1, totalFrames(clips));

  const introProps = useMemo(
    () => titleCardProps(intro, durationInFrames),
    [intro, durationInFrames],
  );
  const outroProps = useMemo(
    () => titleCardProps(outro, durationInFrames),
    [outro, durationInFrames],
  );

  const watermarkProps = useMemo<WatermarkProps | null>(() => {
    if (!watermarkActive(watermark)) return null;
    return {
      text: watermark.text,
      position: watermark.position,
      fontFamily: watermark.fontFamily,
      fontSizePx: watermark.fontSizePx,
      color: watermark.color,
      opacity: watermark.opacity,
      shadowEnabled: watermark.shadowEnabled,
      shadowIntensity: watermark.shadowIntensity,
      shadowX: watermark.shadowX,
      shadowY: watermark.shadowY,
    };
  }, [watermark]);

  // A fresh object here would re-render the whole composition on every render
  // of this component, for no change in what it draws.
  const inputProps = useMemo(
    () => ({
      clips,
      intro: introProps,
      outro: outroProps,
      watermark: watermarkProps,
      flipHorizontal: settings.flipHorizontal,
      fitMode: settings.fitMode,
    }),
    [clips, introProps, outroProps, watermarkProps, settings.flipHorizontal, settings.fitMode],
  );

  // Size the box to the exact composition ratio, capped by maxHeight and full width,
  // so the video fills it (no black bars, controls sit on the video).
  const boxStyle = {
    width: `min(100%, calc(${maxHeight} * ${width} / ${height}))`,
    aspectRatio: `${width} / ${height}`,
  } as const;

  if (clips.length === 0) {
    return (
      <div
        className="mx-auto grid place-items-center rounded-xl border border-separator bg-black/90 text-center text-sm text-white/60"
        style={boxStyle}
      >
        Mark clips on the source timeline to build your trailer
      </div>
    );
  }

  return (
    // ring, not border: a border shrinks the content box and skews its aspect
    // ratio, making the Player letterbox a ~1px black sliver.
    <div
      className="relative mx-auto overflow-hidden rounded-xl bg-black ring-1 ring-separator"
      style={boxStyle}
    >
      {/* Absolute layer: a static child's `height:100%` resolves against the
          aspect-ratio height BEFORE the min() width cap (WebKit), ending up
          taller than the box and shifting the Player down ~1px (black bar).
          Absolute positioning resolves against the real laid-out box. */}
      <div className="absolute inset-0">
        <Player
          ref={playerRef}
          component={TrailerComposition}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          compositionWidth={width}
          compositionHeight={height}
          fps={PREVIEW_FPS}
          style={{ width: "100%", height: "100%" }}
          controls
          clickToPlay
          spaceKeyToPlayOrPause={false}
          loop
        />
      </div>
    </div>
  );
}
