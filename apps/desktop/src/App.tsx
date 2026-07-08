import { ExportBar } from "./panels/ExportBar";
import { Logo } from "./panels/Logo";
import { OnboardingOverlay } from "./panels/OnboardingOverlay";
import { Sidebar } from "./panels/Sidebar";
import { WorkArea } from "./panels/WorkArea";

export function App() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-4">
        <div className="flex items-center gap-1">
          <Logo />
          <span className="font-semibold tracking-tight">Trailers Fast</span>
        </div>
        <ExportBar />
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
    </div>
  );
}
