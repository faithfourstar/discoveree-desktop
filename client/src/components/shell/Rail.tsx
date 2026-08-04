import { Link, useLocation } from "wouter";
import { BRAND_TEAL, BrandMark } from "@/components/shell/BrandMark";
import { productSubpath, useProductHref } from "@/lib/productUrl";
import { moduleRegistry, type ModuleDef } from "@/modules/registry";
import { useAppState } from "@/state/AppStateContext";
import type { ModuleState } from "@/mock/types";

function RailItem({
  module,
  href,
  state,
  active,
}: {
  module: ModuleDef;
  href: string;
  state: ModuleState;
  active: boolean;
}) {
  const Icon = module.icon;
  const dimmed = !state.populated && !active;
  return (
    <Link
      href={href}
      className={[
        "relative flex w-full flex-col items-center gap-[7px] rounded-[9px] pb-2 pt-[9px] transition-colors",
        active
          ? "bg-[var(--rail-active-bg)]"
          : "hover:bg-[var(--rail-hover-bg)]",
        dimmed ? "opacity-40" : "",
        module.pinned === "bottom" ? "mt-auto" : "",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      <Icon
        size={15}
        strokeWidth={active ? 2 : 1.75}
        className={active ? "text-rail-active-icon" : "text-rail-icon"}
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
        <span className="absolute right-[11px] top-[5px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-teal px-[3px] text-[9px] font-semibold tabular-nums text-white">
          {state.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Rail() {
  const { modules } = useAppState();
  const [location] = useLocation();
  const productHref = useProductHref();

  // Module paths are matched beneath the product prefix (ADR 003 §1.2).
  const subpath = productSubpath(location);
  const isActive = (path: string) =>
    path === "/" ? subpath === "/" : subpath.startsWith(path);

  return (
    <nav
      aria-label="Modules"
      className="flex w-[84px] flex-none flex-col items-center gap-[3px] border-r border-chrome-border bg-chrome px-2 py-3.5"
    >
      {/* The D mark renders in its own brand teal on both chromes — it
          reads on white and on the dark rail (BrandMark.tsx brand note). */}
      <div
        className="mb-3.5 flex-none"
        style={{ color: BRAND_TEAL }}
      >
        <BrandMark size={26} />
      </div>
      {moduleRegistry
        .filter((module) => modules[module.id].enabled)
        .map((module) => (
          <RailItem
            key={module.id}
            module={module}
            href={productHref(module.path)}
            state={modules[module.id]}
            active={isActive(module.path)}
          />
        ))}
    </nav>
  );
}
