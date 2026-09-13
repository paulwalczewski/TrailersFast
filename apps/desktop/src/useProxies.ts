import { byId, PROXY_SIDE, proxyKey } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useMemo, useRef } from "react";
import { engine, isTauri } from "./engine";
import { createJobLimiter } from "./jobLimiter";

/**
 * Wait for the clip list to stop changing before transcoding anything. A trim
 * drag calls resizeMarker on every pointer-move, and each intermediate length
 * is a distinct proxyKey — without this, one ~1s drag queues ~140 full
 * transcodes of footage the user never stopped on.
 */
const SETTLE_MS = 300;
/** Proxies are small (360p) but still one process each. */
const MAX_CONCURRENT_PROXY_JOBS = 3;

const runProxyJob = createJobLimiter(MAX_CONCURRENT_PROXY_JOBS);

/**
 * Ensures every marked clip has a small preview proxy generated (in the
 * background). The trailer preview uses proxies for smooth playback and falls
 * back to the trimmed source until a proxy is ready — so debouncing here costs
 * nothing visible, it just skips the intermediate states of a gesture.
 */
export function useProxies(shortSide: number = PROXY_SIDE.inline) {
  const markers = useTrailerStore((s) => s.markers);
  const assets = useTrailerStore((s) => s.assets);
  const proxies = useTrailerStore((s) => s.proxies);
  const setProxy = useTrailerStore((s) => s.setProxy);
  const inFlight = useRef<Set<string>>(new Set());

  const assetsById = useMemo(() => byId(assets), [assets]);

  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(() => {
      for (const m of markers) {
        const key = proxyKey(m, shortSide);
        if (proxies[key] || inFlight.current.has(key)) continue;
        const asset = assetsById[m.assetId];
        if (!asset || asset.loading) continue;

        inFlight.current.add(key);
        runProxyJob(() =>
          engine.generateProxy(
            { path: asset.path, fileName: asset.fileName },
            m.startSec,
            m.lengthSec,
            shortSide,
          ),
        )
          .then((path) => setProxy(key, path))
          .catch((err) => console.error("proxy failed", err))
          .finally(() => inFlight.current.delete(key));
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [markers, assetsById, proxies, setProxy, shortSide]);
}
