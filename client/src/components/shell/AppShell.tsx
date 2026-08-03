import type { ReactNode } from "react";
import { Rail } from "./Rail";
import { StatusFooter } from "./StatusFooter";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-app">
          {children}
        </main>
        <StatusFooter />
      </div>
    </div>
  );
}
