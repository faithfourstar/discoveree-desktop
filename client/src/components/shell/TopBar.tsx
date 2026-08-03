import { Moon, Sun } from "lucide-react";
import { useLocation } from "wouter";
import { moduleRegistry } from "@/modules/registry";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/state/theme";

function useBreadcrumb(): string {
  const [location] = useLocation();
  const { competitor } = useAppState();

  if (location.startsWith("/competitors") && competitor) {
    return `Competitors · ${competitor.name}`;
  }
  const match = moduleRegistry.find((module) =>
    module.path === "/" ? location === "/" : location.startsWith(module.path),
  );
  return match?.label ?? "Home";
}

function formatToday(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
}

export function TopBar() {
  const breadcrumb = useBreadcrumb();
  const { scenario } = useAppState();
  const { theme, toggleTheme } = useTheme();
  const dayOne = scenario === "day-one";

  return (
    <header className="flex h-12 flex-none items-center border-b border-edge bg-surface px-5">
      <span className="text-xs font-medium text-muted">{breadcrumb}</span>

      {!dayOne ? (
        <button
          type="button"
          className="mx-auto flex h-8 w-[420px] items-center justify-between rounded-lg border border-edge-input bg-inset px-[11px] text-left"
          aria-label="Open the command palette"
        >
          <span className="text-[12.5px] text-faint">
            Go anywhere, ask anything
          </span>
          <span className="font-mono text-[11px] font-medium text-ghost">
            ⌘K
          </span>
        </button>
      ) : (
        <span className="mx-auto" />
      )}

      <span className="flex items-center gap-3">
        {!dayOne ? (
          <span className="font-mono text-[11px] text-faint">
            {formatToday()}
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggleTheme}
          className="text-faint transition-colors hover:text-muted"
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
        >
          {theme === "dark" ? (
            <Sun size={14} strokeWidth={1.75} aria-hidden />
          ) : (
            <Moon size={14} strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </span>
    </header>
  );
}
