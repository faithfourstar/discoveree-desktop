import { Link, useLocation } from "wouter";
import { moduleRegistry, type ModuleDef } from "@/modules/registry";
import { useAppState } from "@/state/AppStateContext";
import type { ModuleState } from "@/mock/types";

function RailItem({
  module,
  state,
  active,
}: {
  module: ModuleDef;
  state: ModuleState;
  active: boolean;
}) {
  const Icon = module.icon;
  const dimmed = !state.populated && !active;
  return (
    <Link
      href={module.path}
      className={[
        "relative flex w-full flex-col items-center gap-[7px] rounded-[9px] pb-2 pt-[9px] transition-colors",
        active
          ? "bg-[var(--rail-active-bg)]"
          : "hover:bg-[rgba(255,255,255,0.06)]",
        dimmed ? "opacity-40" : "",
        module.pinned === "bottom" ? "mt-auto" : "",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      <Icon
        size={15}
        strokeWidth={active ? 2 : 1.75}
        className={active ? "text-teal-bright" : "text-rail-icon"}
        aria-hidden
      />
      <span
        className={[
          "text-center text-[9.5px] leading-[1.1]",
          active
            ? "font-semibold text-rail-active"
            : "font-medium text-rail-label",
        ].join(" ")}
      >
        {module.label}
      </span>
      {state.badge !== undefined && state.badge > 0 ? (
        <span className="absolute right-[11px] top-[5px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-teal px-[3px] font-mono text-[9px] font-semibold text-white">
          {state.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Rail() {
  const { modules } = useAppState();
  const [location] = useLocation();

  const isActive = (path: string) =>
    path === "/" ? location === "/" : location.startsWith(path);

  return (
    <nav
      aria-label="Modules"
      className="flex w-[84px] flex-none flex-col items-center gap-[3px] bg-chrome px-2 py-3.5"
    >
      <div
        className="mb-3.5 h-[26px] w-[26px] flex-none rounded-[7px] bg-teal"
        aria-hidden
      />
      {moduleRegistry
        .filter((module) => modules[module.id].enabled)
        .map((module) => (
          <RailItem
            key={module.id}
            module={module}
            state={modules[module.id]}
            active={isActive(module.path)}
          />
        ))}
    </nav>
  );
}
