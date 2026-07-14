import { useEffect, useState } from "react";
import { useMcpActivity } from "../mcp/activity";

/** Navbar entry point for the AI/MCP modal, with a live "agent working" dot. */
export function AiButton({ onPress }: { onPress: () => void }) {
  const working = useMcpActivity((s) => s.activeCount > 0);
  const lastFinishedAt = useMcpActivity((s) => s.lastFinishedAt);

  // Keep a solid dot for a few seconds after the last call, so quick edits
  // (a slider tweak, a clip add) don't flash by unnoticed.
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    if (!lastFinishedAt) return;
    setRecent(true);
    const t = setTimeout(() => setRecent(false), 4000);
    return () => clearTimeout(t);
  }, [lastFinishedAt]);

  return (
    <button
      type="button"
      onClick={onPress}
      title={working ? "AI agent is working…" : "Connect an AI agent (MCP)"}
      className="relative flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-700 to-fuchsia-700 px-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-violet-600 hover:to-fuchsia-600 hover:shadow-violet-500/25"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2" />
        <path d="M20 14h2" />
        <path d="M15 13v2" />
        <path d="M9 13v2" />
      </svg>
      AI · MCP
      {working || recent ? (
        <span className="absolute -right-1 -top-1 flex size-2.5" aria-hidden="true">
          {working ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          ) : null}
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400 ring-2 ring-background" />
        </span>
      ) : null}
    </button>
  );
}
