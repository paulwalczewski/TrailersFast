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
  /** When the last call finished (0 = never) — lets the indicator linger briefly. */
  lastFinishedAt: number;
  begin: () => void;
  end: () => void;
};

/** Rolling log of AI tool calls, newest first — shown in the AI modal. */
export const useMcpActivity = create<McpActivityStore>((set) => ({
  entries: [],
  push: (e) => set((s) => ({ entries: [e, ...s.entries].slice(0, 50) })),
  clear: () => set({ entries: [] }),
  activeCount: 0,
  lastFinishedAt: 0,
  begin: () => set((s) => ({ activeCount: s.activeCount + 1 })),
  end: () =>
    set((s) => ({ activeCount: Math.max(0, s.activeCount - 1), lastFinishedAt: Date.now() })),
}));
