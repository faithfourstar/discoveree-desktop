import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useProductHref } from "@/lib/productUrl";
import { competitorPath, threatRank } from "@/mock/competitors";
import type { CompetitorChecking, CompetitorRow } from "@/mock/types";
import { ClassificationBadge, NewTag } from "./chips";
import { VerifiedStamp } from "./VerifiedStamp";

type SortKey = "default" | "threat" | "sentiment" | "verified";

function sortRows(
  rows: readonly CompetitorRow[],
  key: SortKey,
  ascending: boolean,
): readonly CompetitorRow[] {
  if (key === "default") {
    return rows;
  }
  const sorted = [...rows].sort((a, b) => {
    if (key === "threat") {
      return threatRank[a.threat] - threatRank[b.threat];
    }
    if (key === "sentiment") {
      // Absent figures sort last in either direction.
      const av = a.sentiment ?? (ascending ? Infinity : -Infinity);
      const bv = b.sentiment ?? (ascending ? Infinity : -Infinity);
      return av - bv;
    }
    return (a.verifiedOrder ?? Infinity) - (b.verifiedOrder ?? Infinity);
  });
  return ascending ? sorted : sorted.reverse();
}

function latestChangeText(row: CompetitorRow): string {
  if (row.change) {
    return row.change.line;
  }
  if (row.stale && !row.unverified) {
    return `Not verified in ${row.staleDays ?? 15} days — worth a fresh look.`;
  }
  if (row.confirmedQuietSince) {
    return `Nothing new since ${row.confirmedQuietSince} — pricing, changelog and reviews all confirmed.`;
  }
  return "";
}

function HeaderCell({
  label,
  sortable,
  active,
  ascending,
  align,
  onSort,
}: {
  label: string;
  sortable?: boolean;
  active?: boolean;
  ascending?: boolean;
  align?: "right";
  onSort?: () => void;
}) {
  const content = (
    <span className={active ? "text-ink" : undefined}>
      {label}
      {active ? (ascending ? " ↑" : " ↓") : ""}
    </span>
  );
  return (
    <th
      scope="col"
      aria-sort={
        active ? (ascending ? "ascending" : "descending") : undefined
      }
      className={[
        "border-b border-edge-hairline pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-label",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {sortable ? (
        <button type="button" onClick={onSort} className="hover:text-ink">
          {content}
        </button>
      ) : (
        content
      )}
    </th>
  );
}

/**
 * The table view — the same data as the cards, relaxed to 960px (spec 1.5).
 * Sortable by Threat, Sentiment and Verified; default sort mirrors the card
 * ordering. Empty cells render as nothing — never dash walls or zeroes.
 */
export function CompetitorsTable({
  rows,
  checking,
  agentsPaused,
  justVerifiedId,
  onCheck,
}: {
  rows: readonly CompetitorRow[];
  checking: readonly CompetitorChecking[];
  agentsPaused?: boolean | undefined;
  justVerifiedId?: string | null | undefined;
  onCheck: (id: string) => void;
}) {
  const [, navigate] = useLocation();
  const productHref = useProductHref();
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [ascending, setAscending] = useState(true);

  const sorted = useMemo(
    () => sortRows(rows, sortKey, ascending),
    [rows, sortKey, ascending],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setAscending((value) => !value);
    } else {
      setSortKey(key);
      setAscending(true);
    }
  };

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col className="w-[190px]" />
        <col className="w-[105px]" />
        <col className="w-[86px]" />
        <col className="w-[76px]" />
        <col />
        <col className="w-[150px]" />
      </colgroup>
      <thead>
        <tr>
          <HeaderCell label="Competitor" />
          <HeaderCell
            label="Threat"
            sortable
            active={sortKey === "threat"}
            ascending={ascending}
            onSort={() => toggleSort("threat")}
          />
          <HeaderCell
            label="Sentiment"
            sortable
            active={sortKey === "sentiment"}
            ascending={ascending}
            align="right"
            onSort={() => toggleSort("sentiment")}
          />
          <HeaderCell label="Reviews" align="right" />
          <HeaderCell label="Latest change" />
          <HeaderCell
            label="Verified"
            sortable
            active={sortKey === "verified"}
            ascending={ascending}
            align="right"
            onSort={() => toggleSort("verified")}
          />
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => {
          const checkingEntry = checking.find((entry) => entry.id === row.id);
          const changeText = latestChangeText(row);
          return (
            <tr
              key={row.id}
              onClick={() => navigate(productHref(competitorPath(row.id)))}
              className={[
                "cursor-pointer border-b border-edge-hairline align-baseline",
                justVerifiedId === row.id ? "tint-fade" : "",
              ].join(" ")}
            >
              <td className="py-3.5 pr-3">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[14px] font-medium text-ink">
                    {row.name}
                  </span>
                  <ClassificationBadge value={row.classification} />
                </span>
              </td>
              <td className="py-3.5 pr-3 text-[12.5px] text-body">
                {row.threat}
              </td>
              <td className="py-3.5 pr-3 text-right text-xs text-body">
                {row.sentiment !== undefined ? (
                  <span className="data">{row.sentiment}</span>
                ) : null}
              </td>
              <td className="py-3.5 pr-3 text-right text-xs text-body">
                {row.reviewCount !== undefined ? (
                  <span className="data">{row.reviewCount}</span>
                ) : null}
              </td>
              <td className="py-3.5 pr-3">
                {row.lastRunFailed ? (
                  // A failed run owns this cell — the Verified column keeps
                  // counting from the last successful check (spec 5.1).
                  <span
                    className="flex items-baseline gap-2.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span
                      title={
                        row.lastRunFailed.at
                          ? `${row.lastRunFailed.reason} · ${row.lastRunFailed.at}`
                          : row.lastRunFailed.reason
                      }
                      className="min-w-0 truncate text-xs text-red-700 dark:text-red-400"
                    >
                      {row.lastRunFailed.reason}
                      {row.lastRunFailed.at ? (
                        <>
                          {" · "}
                          <span className="data">{row.lastRunFailed.at}</span>
                        </>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCheck(row.id)}
                      className="whitespace-nowrap text-[12px] font-medium text-teal-deep hover:underline"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      className="whitespace-nowrap text-[12px] font-medium text-teal-deep hover:underline"
                    >
                      View log
                    </button>
                  </span>
                ) : changeText ? (
                  <span
                    title={changeText}
                    className={[
                      "block truncate text-[13px] leading-[1.5]",
                      row.stale && !row.unverified
                        ? "text-amber-600 dark:text-amber-400"
                        : row.change
                          ? "text-ink"
                          : "text-body",
                    ].join(" ")}
                  >
                    {row.change?.unseen ? <NewTag /> : null}
                    {changeText}
                  </span>
                ) : null}
              </td>
              <td
                className="py-3.5 text-right"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="flex justify-end">
                  <VerifiedStamp
                    verifiedAgo={row.verifiedAgo}
                    stale={row.stale}
                    unverified={row.unverified}
                    unverifiedLabel={row.unverifiedLabel}
                    checkingElapsedS={checkingEntry?.elapsedS}
                    agentsPaused={agentsPaused}
                    onCheck={() => onCheck(row.id)}
                  />
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
