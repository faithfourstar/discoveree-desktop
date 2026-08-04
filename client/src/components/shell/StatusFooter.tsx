import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { DataText } from "@/components/DataText";
import { goToSettingsBlock, type SettingsAnchor } from "@/lib/anchors";
import { useProductHref } from "@/lib/productUrl";
import { useAppState } from "@/state/AppStateContext";
import { useT } from "@/state/locale";

/**
 * The 30px mono status footer. Its segments are doors, not decoration
 * (settings-spec §0.1): Local → Settings #about, Agents → #agent-schedules,
 * Licence → #licence — each lands on its block with the one-time highlight.
 */

function FooterDoor({
  anchor,
  amber,
  children,
}: {
  anchor: SettingsAnchor;
  amber?: boolean | undefined;
  children: ReactNode;
}) {
  const [, navigate] = useLocation();
  const productHref = useProductHref();
  return (
    <button
      type="button"
      onClick={() =>
        goToSettingsBlock(navigate, productHref("/settings"), anchor)
      }
      className={[
        "flex items-center gap-1.5 hover:underline",
        amber ? "text-amber-600 dark:text-amber-400" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function StatusFooter() {
  const { footer } = useAppState();
  const [, navigate] = useLocation();
  const productHref = useProductHref();
  // Footer segments are app-assembled copy (dates and figures pass the
  // dictionary untouched) — they flow through the display transform.
  // EXCEPT the agents segment: it can embed competitor names ("checking
  // Mixpanel…"), which are data; its copy carries no dictionary words.
  const t = useT();

  return (
    // Typography ruling §3/§7: footer copy fragments are words — Inter
    // 11.5px/400 text-faint; the values inside render mono via `.data`.
    <footer className="flex h-[30px] flex-none items-center gap-4 border-t border-edge bg-surface px-[18px] text-[11.5px] text-faint">
      <FooterDoor anchor="about">
        <span
          className="h-1.5 w-1.5 rounded-full bg-live"
          aria-hidden
        />
        <DataText text={t(footer.local)} />
      </FooterDoor>
      {footer.agents ? (
        <FooterDoor anchor="agent-schedules">
          {footer.agentsLive ? (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-live"
              aria-hidden
            />
          ) : null}
          <DataText text={footer.agents} />
        </FooterDoor>
      ) : null}
      {footer.mcp ? (
        // A door to Connections #serving (connections-spec 6.3); the
        // not-serving state carries the destructive-quiet tone.
        <button
          type="button"
          onClick={() => {
            navigate(`${productHref("/connections")}#serving`);
          }}
          className={[
            "hover:underline",
            footer.mcpFailed ? "text-red-700 dark:text-red-400" : "",
          ].join(" ")}
        >
          <DataText text={t(footer.mcp)} />
        </button>
      ) : null}
      <span>{t(footer.offline)}</span>
      {footer.licence ? (
        <span className="ml-auto">
          <FooterDoor anchor="licence" amber={footer.licenceAmber}>
            <DataText text={t(footer.licence)} />
          </FooterDoor>
        </span>
      ) : null}
    </footer>
  );
}
