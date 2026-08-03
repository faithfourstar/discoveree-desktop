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
        {/*
          A block-level scroll container: only the content column scrolls;
          rail, top bar and status footer stay fixed. (The 2a design canvas
          clipped this area for its fixed-height frames — a live page must
          scroll.) Pages that centre vertically use min-h-full, not flex-1.
        */}
        <main className="min-h-0 flex-1 overflow-y-auto bg-app">
          {children}
        </main>
        <StatusFooter />
      </div>
    </div>
  );
}
