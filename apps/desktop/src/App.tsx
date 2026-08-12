import { useState } from "react";
import { useMcpBridge } from "./mcp/useMcpBridge";
import { AiButton } from "./panels/AiButton";
import { AiIntegrationModal } from "./panels/AiIntegrationModal";
import { ExportBar } from "./panels/ExportBar";
import { Logo } from "./panels/Logo";
import { ModeTabs } from "./panels/ModeTabs";
import { NewTrailerButton } from "./panels/NewTrailerButton";
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
      {/* Three columns so the mode tabs stay centered in the window regardless
          of how wide the logo / export sides get. */}
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-separator px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Logo />
            <span className="font-semibold tracking-tight">Trailers Fast</span>
          </div>
          <div className="h-5 w-px bg-separator" />
          <div className="flex items-center gap-0.5">
            <UndoRedoButtons />
            <NewTrailerButton />
          </div>
        </div>
        <ModeTabs />
        <div className="flex items-center justify-end gap-3">
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
