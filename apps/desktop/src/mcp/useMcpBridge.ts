import { useEffect } from "react";
import { isTauri } from "../engine";
import { useIngest } from "../useIngest";
import { useMcpActivity } from "./activity";
import { handleMcpRequest } from "./handlers";

type McpRequest = { id: number; method: string; params: unknown };

/**
 * Webview half of the MCP bridge: the Rust MCP server forwards each tool call
 * as an `mcp:request` event; this executes it against the store and replies
 * via the `mcp_respond` command. Mount once at the app root.
 */
export function useMcpBridge(): void {
  const ingest = useIngest();

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    let unlistenClients: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");

      const unClients = await listen<number>("mcp:clients", (event) => {
        useMcpActivity.getState().setClients(event.payload);
      });
      if (cancelled) unClients();
      else unlistenClients = unClients;
      // Seed the count — an agent may have connected before this webview loaded.
      const status = await invoke<{ clients: number }>("mcp_status");
      if (!cancelled) useMcpActivity.getState().setClients(status.clients);

      const un = await listen<McpRequest>("mcp:request", (event) => {
        const { id, method, params } = event.payload;
        void (async () => {
          const activity = useMcpActivity.getState();
          activity.begin();
          try {
            const result = await handleMcpRequest(method, params, { ingest });
            activity.push({ at: Date.now(), method, ok: true });
            await invoke("mcp_respond", { id, result, error: null });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            activity.push({ at: Date.now(), method, ok: false, detail: message });
            await invoke("mcp_respond", { id, result: null, error: message });
          } finally {
            activity.end();
          }
        })();
      });
      if (cancelled) un();
      else unlisten = un;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      unlistenClients?.();
    };
  }, [ingest]);
}
