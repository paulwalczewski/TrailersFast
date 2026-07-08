import { byId, proxyKey } from "@trailerfast/core";
import { useTrailerStore } from "@trailerfast/state";
import { useEffect, useMemo, useRef } from "react";
import { engine, isTauri } from "./engine";

/**
 * Ensures every marked clip has a small preview proxy generated (in the
 * background). The trailer preview uses proxies for smooth playback and falls
 * back to the trimmed source until a proxy is ready.
 */
export function useProxies() {
  const markers = useTrailerStore((s) => s.markers);
  const assets = useTrailerStore((s) => s.assets);
  const proxies = useTrailerStore((s) => s.proxies);
  const setProxy = useTrailerStore((s) => s.setProxy);
  const inFlight = useRef<Set<string>>(new Set());

  const assetsById = useMemo(() => byId(assets), [assets]);

  useEffect(() => {
    if (!isTauri()) return;
    for (const m of markers) {
      const key = proxyKey(m);
      if (proxies[key] || inFlight.current.has(key)) continue;
      const asset = assetsById[m.assetId];
      if (!asset || asset.loading) continue;

      inFlight.current.add(key);
      engine
        .generateProxy({ path: asset.path, fileName: asset.fileName }, m.startSec, m.lengthSec)
        .then((path) => setProxy(key, path))
        .catch((err) => console.error("proxy failed", err))
        .finally(() => inFlight.current.delete(key));
    }
  }, [markers, assetsById, proxies, setProxy]);
}
