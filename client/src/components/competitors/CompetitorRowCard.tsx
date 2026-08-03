import { useState } from "react";
import { Link, useLocation } from "wouter";
import { EvidenceRow } from "@/components/EvidenceChip";
import { competitorPath } from "@/mock/competitors";
import type { CompetitorRow } from "@/mock/types";
import { ClassificationBadge, NewTag } from "./chips";
import { VerifiedStamp } from "./VerifiedStamp";

/** The mono meta line: absent figures leave no gap, no dash, no zero. */
export function MetaLine({ row }: { row: CompetitorRow }) {
  const segments: string[] = [row.domain, row.threat].filter(Boolean);
  if (row.sentiment !== undefined) {
    segments.push(`sentiment ${row.sentiment}`);
  }
  if (row.reviewCount !== undefined) {
    segments.push(`${row.reviewCount} reviews`);
  }
  return (
    <div className="font-mono text-xs tabular-nums text-faint">
      {segments.join(" · ")}
    </div>
  );
}

/**
 * One competitor row on the Overview (card view) — the whole row is a door
 * to the Object; the name is the visible link. Compressed rows (beyond the
 * eighth, under "Also watching") carry the name and meta lines only.
 */
export function CompetitorRowCard({
  row,
  checkingElapsedS,
  agentsPaused,
  justVerified,
  compressed,
  onCheck,
}: {
  row: CompetitorRow;
  checkingElapsedS?: number | undefined;
  agentsPaused?: boolean | undefined;
  /** The run just settled — apply the single 600 ms tint fade. */
  justVerified?: boolean | undefined;
  compressed?: boolean | undefined;
  onCheck: () => void;
}) {
  const [, navigate] = useLocation();
  const [pausedNote, setPausedNote] = useState(false);
  const path = competitorPath(row.id);

  const handleCheckNow = () => {
    if (agentsPaused) {
      setPausedNote(true);
      return;
    }
    onCheck();
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
        <ClassificationBadge value={row.classification} />
        <span className="ml-auto" onClick={(event) => event.stopPropagation()}>
          <VerifiedStamp
            verifiedAgo={row.verifiedAgo}
            stale={row.stale}
            unverified={row.unverified}
            unverifiedLabel={row.unverifiedLabel}
            lastRunFailed={row.lastRunFailed}
            checkingElapsedS={checkingElapsedS}
            agentsPaused={agentsPaused}
            onCheck={onCheck}
            onRetry={onCheck}
          />
        </span>
      </div>
      <div className="mt-1">
        <MetaLine row={row} />
      </div>

      {compressed && !row.change?.unseen ? null : row.change ? (
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
      ) : row.stale && !row.unverified ? (
        <div className="mt-2.5">
          <p className="text-[15px] leading-[1.6] text-amber-600 dark:text-amber-400">
            Not verified in{" "}
            <span className="font-mono text-[0.88em] tabular-nums">
              {row.staleDays ?? 15}
            </span>{" "}
            days — worth a fresh look.{" "}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleCheckNow();
              }}
              className="font-medium text-teal-deep hover:underline"
            >
              Check now
            </button>
          </p>
          {pausedNote ? (
            <p className="mt-1 text-[12px] text-faint">
              Agents are paused — add an LLM key first.
            </p>
          ) : null}
        </div>
      ) : !compressed && row.confirmedQuietSince ? (
        <p className="mt-2.5 text-[15px] leading-[1.6] text-body">
          Nothing new since{" "}
          <span className="font-mono text-[0.88em] tabular-nums">
            {row.confirmedQuietSince}
          </span>{" "}
          — pricing, changelog and reviews all confirmed.
        </p>
      ) : null}
    </div>
  );
}
