import { Check, ChevronsUpDown, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  productSubpath,
  switchProductLocation,
  useActiveProductId,
  useProductHref,
} from "@/lib/productUrl";
import { moduleRegistry } from "@/modules/registry";
import { competitorSlug } from "@/mock/competitors";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/state/theme";

function useBreadcrumb(): ReactNode {
  const [location] = useLocation();
  const { competitors } = useAppState();
  const productHref = useProductHref();

  if (location.startsWith("/products/new")) {
    return "Add a product";
  }

  const subpath = productSubpath(location);
  const objectMatch = /^\/competitors\/([^/]+)/.exec(subpath);
  if (objectMatch) {
    const competitor = Object.values(competitors).find(
      (candidate) => competitorSlug(candidate.id) === objectMatch[1],
    );
    if (competitor) {
      return (
        <>
          <Link href={productHref("/competitors")} className="hover:text-body">
            Competitors
          </Link>{" "}
          · {competitor.name}
        </>
      );
    }
    return "Competitors";
  }
  const match = moduleRegistry.find((module) =>
    module.path === "/" ? subpath === "/" : subpath.startsWith(module.path),
  );
  return match?.label ?? "Home";
}

/**
 * Compact product switcher (ADR 003 §1.2): a nav control that rewrites the
 * URL's product prefix. Invisible while the org has exactly one product —
 * the common case keeps its chrome untouched. Carries the "add another
 * product" entry point.
 */
function ProductSwitcher() {
  const { products } = useAppState();
  const [location, navigate] = useLocation();
  const activeProductId = useActiveProductId();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: Event) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const active = products.find((product) => product.id === activeProductId);
  if (products.length < 2 || !active) {
    return null;
  }

  return (
    <div ref={menuRef} className="relative mr-3 flex-none">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch product"
        className="flex items-center gap-1.5 rounded-[7px] border border-edge-hairline px-2 py-1 text-xs font-medium text-body transition-colors hover:border-edge-input"
      >
        {active.name}
        <ChevronsUpDown size={12} strokeWidth={1.75} className="text-faint" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-8 z-10 w-[220px] rounded-[9px] border border-edge bg-surface py-1.5 shadow-lg"
        >
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              role="menuitemradio"
              aria-checked={product.id === active.id}
              onClick={() => {
                setOpen(false);
                if (product.id !== active.id) {
                  navigate(switchProductLocation(location, product.id));
                }
              }}
              className="flex w-full items-center gap-2 px-3.5 py-1.5 text-left text-[13px] text-body hover:bg-inset"
            >
              <span className="flex-1 truncate">{product.name}</span>
              {product.id === active.id ? (
                <Check size={13} strokeWidth={2} className="text-teal-deep" aria-hidden />
              ) : null}
            </button>
          ))}
          <div className="mt-1.5 border-t border-edge-hairline pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate("/products/new");
              }}
              className="block w-full px-3.5 py-1.5 text-left text-[13px] font-medium text-teal-deep hover:bg-inset"
            >
              Add another product…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
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
      <ProductSwitcher />
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
