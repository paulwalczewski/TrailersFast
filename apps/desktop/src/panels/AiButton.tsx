import { useAgentBeacon, useMcpActivity } from "../mcp/activity";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";

/** Navbar entry point for the AI/MCP modal, with a live "agent working" beacon. */
export function AiButton({ onPress }: { onPress: () => void }) {
  const working = useAgentBeacon();
  const clients = useMcpActivity((s) => s.clients);

  return (
    <button
      type="button"
      onClick={onPress}
      title={
        working
          ? "AI agent is working…"
          : clients > 0
            ? "AI agent connected (MCP)"
            : "Connect an AI agent (MCP)"
      }
      className="relative flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-700 to-fuchsia-700 px-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-violet-600 hover:to-fuchsia-600 hover:shadow-violet-500/25"
    >
      {working ? (
        <Spinner className="size-[15px] border-white/40 border-t-white" />
      ) : (
        <Icon>
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </Icon>
      )}
      AI · MCP
    </button>
  );
}
