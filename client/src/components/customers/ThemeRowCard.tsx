import { useState } from "react";
import { Link, useLocation } from "wouter";
import { NewTag } from "@/components/competitors/chips";
import { VerifiedStamp } from "@/components/competitors/VerifiedStamp";
import { EvidenceRow } from "@/components/EvidenceChip";
import { useProductHref } from "@/lib/productUrl";
import type { ThemeRow } from "@/mock/types";

export function themePath(id: string): string {
  return `/customers/themes/${id.split(":").pop() ?? id}`;
}

/** The mono meta line — absent figures leave no gap, no dash, no zero. */
export function ThemeMetaLine({ row }: { row: ThemeRow }) {
  const segments: string[] = [
    `${row.mentionCount} mention${row.mentionCount === 1 ? "" : "s"}`,
  ];
  if (row.sentimentMixed) {
    segments.push("sentiment mixed");
  } else if (row.sentiment !== undefined) {
    segments.push(`sentiment ${row.sentiment}`);
  }
  if (row.trend) {
    segments.push(row.trend);
  }
  if (row.sourceKindCount !== undefined) {
    segments.push(
      `${row.sourceKindCount} source kind${row.sourceKindCount === 1 ? "" : "s"}`,
    );
  }
  segments.push(row.lifecycle);
  return (
    <div className="font-mono text-xs tabular-nums text-faint">
      {segments.join(" · ")}
    </div>
  );
}

/**
 * One theme row (customers spec 1.3). Compressed rows (fading, or beyond
 * eight established under "Also filed") carry name + meta only — unless an
 * unseen change re-expands them.
 */
export function ThemeRowCard({
  row,
  compressed,
  checkingElapsedS,
  agentsPaused,
  justVerified,
  onRefresh,
}: {
  row: ThemeRow;
  compressed?: boolean | undefined;
  checkingElapsedS?: number | undefined;
  agentsPaused?: boolean | undefined;
  justVerified?: boolean | undefined;
  onRefresh: () => void;
}) {
  const [, navigate] = useLocation();
  const productHref = useProductHref();
  const [pausedNote, setPausedNote] = useState(false);
  const path = productHref(themePath(row.id));
  const expanded = !compressed || row.change?.unseen;

  const handleRefreshNow = () => {
    if (agentsPaused) {
      setPausedNote(true);
      return;
    }
    onRefresh();
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate(path)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          navigate(path);
        }
      }}
      className={[
        "cursor-pointer border-t border-edge-hairline py-5 last:border-b",
        justVerified ? "tint-fade" : "",
      ].join(" ")}
    >
      <div className="flex items-baseline gap-2.5">
        <Link
          href={path}
          onClick={(event) => event.stopPropagation()}
          className="text-[15.5px] font-medium text-ink hover:underline"
        >
          {row.name}
        </Link>
        <span className="ml-auto" onClick={(event) => event.stopPropagation()}>
          <VerifiedStamp
            verifiedAgo={row.refreshedAgo}
            stale={row.stale}
            checkingElapsedS={checkingElapsedS}
            agentsPaused={agentsPaused}
            onCheck={onRefresh}
            verb="refreshed"
            checkingLabel="refreshing"
          />
        </span>
      </div>
      <div className="mt-1">
        <ThemeMetaLine row={row} />
      </div>

      {!expanded ? null : row.change ? (
        <div className="mt-2.5">
          <p className="mb-[9px] text-[15px] leading-[1.6] text-ink">
            {row.change.unseen ? <NewTag /> : null}
            {row.change.line}
          </p>
          <EvidenceRow evidence={row.change.evidence}>
            <Link
              href={path}
              onClick={(event) => event.stopPropagation()}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Open →
            </Link>
          </EvidenceRow>
        </div>
      ) : row.stale ? (
        <div className="mt-2.5">
          <p className="text-[15px] leading-[1.6] text-amber-600 dark:text-amber-400">
            Not refreshed in{" "}
            <span className="font-mono text-[0.88em] tabular-nums">
              {row.staleDays ?? 8}
            </span>{" "}
            days — new feedback may be waiting to file.{" "}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleRefreshNow();
              }}
              className="font-medium text-teal-deep hover:underline"
            >
              Refresh now
            </button>
          </p>
          {pausedNote ? (
            <p className="mt-1 text-[12px] text-faint">
              Agents are paused — add an LLM key first.
            </p>
          ) : null}
        </div>
      ) : row.quietSince ? (
        <p className="mt-2.5 text-[15px] leading-[1.6] text-body">
          No new mentions since{" "}
          <span className="font-mono text-[0.88em] tabular-nums">
            {row.quietSince}
          </span>{" "}
          — holding at{" "}
          <span className="font-mono text-[0.88em] tabular-nums">
            {row.mentionCount}
          </span>
          .
        </p>
      ) : null}
    </div>
  );
}
