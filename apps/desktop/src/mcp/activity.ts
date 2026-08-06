import { useEffect, useState } from "react";
import { create } from "zustand";

export type McpActivityEntry = {
  at: number;
  method: string;
  ok: boolean;
  /** Error message on failure, short context otherwise. */
  detail?: string;
};

type McpActivityStore = {
  entries: McpActivityEntry[];
  push: (e: McpActivityEntry) => void;
  clear: () => void;
  /** Tool calls currently in flight — drives the navbar "AI working" indicator. */
  activeCount: number;
  /** When the last call started (0 = never) — beacons key off this, since most
   * calls finish within one event tick and `activeCount > 0` never paints. */
  lastStartedAt: number;
  /** When the last call finished (0 = never) — lets the indicator linger briefly. */
  lastFinishedAt: number;
  begin: () => void;
  end: () => void;
  /** Connected MCP client sessions (pushed by the Rust server via events). */
  clients: number;
  setClients: (n: number) => void;
};

/** Rolling log of AI tool calls, newest first — shown in the AI modal. */
export const useMcpActivity = create<McpActivityStore>((set) => ({
  entries: [],
  push: (e) => set((s) => ({ entries: [e, ...s.entries].slice(0, 50) })),
  clear: () => set({ entries: [] }),
  activeCount: 0,
  lastStartedAt: 0,
  lastFinishedAt: 0,
  begin: () => set((s) => ({ activeCount: s.activeCount + 1, lastStartedAt: Date.now() })),
  end: () =>
    set((s) => ({ activeCount: Math.max(0, s.activeCount - 1), lastFinishedAt: Date.now() })),
  clients: 0,
  setClients: (n) => set({ clients: n }),
}));

/**
 * True while an agent is working, held for at least `minVisibleMs` after each
 * call starts. The hold serves two purposes: sub-millisecond tool calls would
 * never render as "working" at all (begin+end land in the same React tick),
 * and agents pause between calls to think — the hold bridges those gaps so
 * one multi-step task reads as one continuous "working" period.
 */
export function useAgentBeacon(minVisibleMs = 12_000): boolean {
  const working = useMcpActivity((s) => s.activeCount > 0);
  const lastStartedAt = useMcpActivity((s) => s.lastStartedAt);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!lastStartedAt) return;
    setHeld(true);
    const t = setTimeout(() => setHeld(false), minVisibleMs);
    return () => clearTimeout(t);
  }, [lastStartedAt, minVisibleMs]);

  return working || held;
}
