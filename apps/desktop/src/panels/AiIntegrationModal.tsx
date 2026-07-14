import { useEffect, useState } from "react";
import { isTauri } from "../engine";
import { useMcpActivity } from "../mcp/activity";
import { ModalShell } from "../ui/ModalShell";

type McpStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  token: string;
};

type SnippetBlock = { title: string; hint: string; text: string };
type ProviderTab = { id: string; label: string; blocks: SnippetBlock[] };

/** Per-client connection snippets, built from the live server URL + token. */
function providerTabs(url: string, token: string): ProviderTab[] {
  const auth = `Authorization: Bearer ${token}`;
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  return [
    {
      id: "claude",
      label: "Claude",
      blocks: [
        {
          title: "Claude Code",
          hint: "run once in a terminal",
          text: `claude mcp add --transport http trailerfast ${url} --header "${auth}"`,
        },
        {
          title: "Claude Desktop",
          hint: "add to claude_desktop_config.json (needs the mcp-remote proxy)",
          text: json({
            mcpServers: {
              trailerfast: {
                command: "npx",
                args: ["-y", "mcp-remote", url, "--header", auth],
              },
            },
          }),
        },
      ],
    },
    {
      id: "codex",
      label: "OpenAI Codex",
      blocks: [
        {
          title: "Codex CLI / IDE",
          hint: "add to ~/.codex/config.toml",
          text: [
            "[mcp_servers.trailerfast]",
            `url = "${url}"`,
            "",
            "[mcp_servers.trailerfast.http_headers]",
            `Authorization = "Bearer ${token}"`,
          ].join("\n"),
        },
      ],
    },
    {
      id: "cursor",
      label: "Cursor",
      blocks: [
        {
          title: "Cursor",
          hint: "add to ~/.cursor/mcp.json (or Settings → MCP)",
          text: json({
            mcpServers: {
              trailerfast: { url, headers: { Authorization: `Bearer ${token}` } },
            },
          }),
        },
      ],
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      blocks: [
        {
          title: "Gemini CLI",
          hint: "add to ~/.gemini/settings.json",
          text: json({
            mcpServers: {
              trailerfast: { httpUrl: url, headers: { Authorization: `Bearer ${token}` } },
            },
          }),
        },
      ],
    },
    {
      id: "others",
      label: "Others",
      blocks: [
        {
          title: "Any MCP client",
          hint: "transport: Streamable HTTP",
          text: [`URL:    ${url}`, `Header: ${auth}`].join("\n"),
        },
        {
          title: "VS Code (Copilot)",
          hint: "add to .vscode/mcp.json",
          text: json({
            servers: {
              trailerfast: {
                type: "http",
                url,
                headers: { Authorization: `Bearer ${token}` },
              },
            },
          }),
        },
        {
          title: "Stdio-only clients",
          hint: "bridge through the mcp-remote proxy",
          text: `npx -y mcp-remote ${url} --header "${auth}"`,
        },
      ],
    },
  ];
}

/** Connection instructions + live activity for the embedded MCP server. */
export function AiIntegrationModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [tab, setTab] = useState("claude");
  const entries = useMcpActivity((s) => s.entries);
  const clearActivity = useMcpActivity((s) => s.clear);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const refresh = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const st = await invoke<McpStatus>("mcp_status");
      if (!cancelled) setStatus(st);
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, []);

  async function setEnabled(enabled: boolean) {
    const { invoke } = await import("@tauri-apps/api/core");
    setStatus(await invoke<McpStatus>("mcp_set_enabled", { enabled }));
    // Binding the port happens right after enabling — refresh once it settled.
    if (enabled) {
      setTimeout(async () => {
        setStatus(await invoke<McpStatus>("mcp_status"));
      }, 400);
    }
  }

  const tabs = status?.running ? providerTabs(status.url, status.token) : [];
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <ModalShell
      onClose={onClose}
      className="flex max-h-[85vh] w-[640px] max-w-full flex-col rounded-2xl bg-surface p-5 shadow-xl"
    >
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">AI integration</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <p className="mb-4 text-xs text-muted">
        Connect a local AI agent over MCP to import videos, pick scenes, tune settings and export
        — while you watch the trailer assemble live. Keep the app open while the agent works.
      </p>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {!isTauri() ? (
          <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs text-warning-foreground">
            AI integration is available in the desktop app — launch it with <code>pnpm dev</code>.
          </p>
        ) : status === null ? (
          <p className="text-sm text-muted">Checking server status…</p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`size-2 rounded-full ${
                  status.running ? "bg-success" : status.enabled ? "bg-warning" : "bg-danger"
                }`}
              />
              {status.running ? (
                <span>
                  MCP server running on <code className="text-xs">{status.url}</code>
                </span>
              ) : status.enabled ? (
                <span>MCP server is starting…</span>
              ) : (
                <span>MCP server is off — AI agents can't connect.</span>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={status.enabled}
                aria-label="Enable MCP server"
                onClick={() => setEnabled(!status.enabled)}
                className={`ml-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  status.enabled ? "bg-accent" : "bg-surface-tertiary"
                }`}
              >
                <span
                  className={`size-4 rounded-full bg-white shadow transition-transform ${
                    status.enabled ? "translate-x-4" : ""
                  }`}
                />
              </button>
            </div>

            {active ? (
              <div>
                <div className="mb-3 flex gap-1 rounded-lg bg-surface-secondary p-1">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        t.id === active.id
                          ? "bg-surface text-foreground shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-3">
                  {active.blocks.map((b) => (
                    <Snippet key={b.title} {...b} />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">AI activity</h3>
            {entries.length > 0 ? (
              <button
                type="button"
                onClick={clearActivity}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
              >
                Clear
              </button>
            ) : null}
          </div>
          {entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted">
              No tool calls yet. Once an agent is connected, its actions show up here — every one
              of them is undoable with ⌘Z.
            </p>
          ) : (
            // No own scrollbar — the modal body is the single scroll container.
            <ul className="flex flex-col gap-1">
              {entries.map((e, i) => (
                <li
                  key={`${e.at}-${i}`}
                  className="flex items-baseline gap-2 rounded bg-surface-secondary px-2 py-1 text-xs"
                >
                  <span className={e.ok ? "text-success" : "text-danger"}>{e.ok ? "✓" : "✕"}</span>
                  <code>{e.method}</code>
                  {e.detail ? <span className="truncate text-muted">{e.detail}</span> : null}
                  <span className="ml-auto shrink-0 text-muted">
                    {new Date(e.at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function Snippet({ title, hint, text }: SnippetBlock) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          {title} <span className="font-normal text-muted">— {hint}</span>
        </h3>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-surface-secondary p-2.5 text-[11px] leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
