import { useState } from "react";
import { useMcpBridge } from "./mcp/useMcpBridge";
import { AiButton } from "./panels/AiButton";
import { AiIntegrationModal } from "./panels/AiIntegrationModal";
import { ExportBar } from "./panels/ExportBar";
import { Logo } from "./panels/Logo";
import { OnboardingOverlay } from "./panels/OnboardingOverlay";
import { Sidebar } from "./panels/Sidebar";
import { UndoRedoButtons } from "./panels/UndoRedoButtons";
import { WorkArea } from "./panels/WorkArea";

export function App() {
  const [showAi, setShowAi] = useState(false);
  // Handle MCP tool calls from local AI agents for the app's whole lifetime.
  useMcpBridge();

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Logo />
            <span className="font-semibold tracking-tight">Trailers Fast</span>
          </div>
          <div className="h-5 w-px bg-separator" />
          <UndoRedoButtons />
        </div>
        <div className="flex items-center gap-3">
          <AiButton onPress={() => setShowAi(true)} />
          <div className="mx-2 h-5 w-px bg-separator" />
          <ExportBar />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[360px] shrink-0 border-r border-separator bg-surface">
          <Sidebar />
        </aside>
        <main className="relative min-w-0 flex-1 bg-background">
          <WorkArea />
          <OnboardingOverlay />
        </main>
      </div>
      {showAi ? <AiIntegrationModal onClose={() => setShowAi(false)} /> : null}
    </div>
  );
}
