import { useState } from "react";
import { Link, useLocation } from "wouter";
import { VerifiedStamp } from "@/components/competitors/VerifiedStamp";
import { useProductHref } from "@/lib/productUrl";
import type { SegmentRow } from "@/mock/types";

export function segmentPath(id: string): string {
  return `/customers/segments/${id.split(":").pop() ?? id}`;
}

/** The VERTICAL / PARTNERSHIP badge — a plain segment earns no chrome. */
export function SegmentTypeBadge({
  type,
}: {
  type: SegmentRow["type"];
}) {
  if (!type) {
    return null;
  }
  return (
    <span className="rounded bg-teal-tint px-1.5 py-1 font-mono text-[10px] font-semibold uppercase text-teal-dark">
      {type}
    </span>
  );
}

/** One segment row (customers spec 1.4). */
export function SegmentRowCard({
  row,
  compressed,
  checkingElapsedS,
  agentsPaused,
  justVerified,
  onCheck,
}: {
  row: SegmentRow;
  compressed?: boolean | undefined;
  checkingElapsedS?: number | undefined;
  agentsPaused?: boolean | undefined;
  justVerified?: boolean | undefined;
  onCheck: () => void;
}) {
  const [, navigate] = useLocation();
  const productHref = useProductHref();
  const [pausedNote, setPausedNote] = useState(false);
  const path = productHref(segmentPath(row.id));

  const metaSegments: string[] = [];
  if (row.fit) {
    metaSegments.push(row.fit);
  }
  if (row.personaCount !== undefined) {
    metaSegments.push(
      `${row.personaCount} persona${row.personaCount === 1 ? "" : "s"}`,
    );
  }
  if (row.feedbackCount !== undefined) {
    metaSegments.push(
      `${row.feedbackCount} feedback item${row.feedbackCount === 1 ? "" : "s"}`,
    );
  }
  if (row.sentiment !== undefined) {
    metaSegments.push(`sentiment ${row.sentiment}`);
  }

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
        <SegmentTypeBadge type={row.type} />
        <span className="ml-auto" onClick={(event) => event.stopPropagation()}>
          <VerifiedStamp
            verifiedAgo={row.verifiedAgo}
            stale={row.stale}
            checkingElapsedS={checkingElapsedS}
            agentsPaused={agentsPaused}
            onCheck={onCheck}
          />
        </span>
      </div>
      <div className="mt-1 font-mono text-xs tabular-nums text-faint">
        {metaSegments.join(" · ")}
        {row.alsoServedBy && row.alsoServedBy.length > 0 ? (
          <>
            {metaSegments.length > 0 ? " · " : ""}
            also served by{" "}
            {row.alsoServedBy.map((product, index) => (
              <span key={product.id}>
                {index > 0 ? ", " : ""}
                <span className="text-teal-deep">{product.name}</span>
              </span>
            ))}
          </>
        ) : null}
      </div>

      {compressed ? null : row.stale ? (
        <div className="mt-2.5">
          <p className="text-[15px] leading-[1.6] text-amber-600 dark:text-amber-400">
            Not verified in{" "}
            <span className="font-mono text-[0.88em] tabular-nums">
              {row.staleDays ?? 31}
            </span>{" "}
            days — feedback since then may have moved who they are.{" "}
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
      ) : row.jtbdLine ? (
        <p className="mt-2.5 text-[15px] leading-[1.6] text-ink">
          {row.jtbdLine}
        </p>
      ) : (
        <p className="mt-2.5 text-[15px] leading-[1.6] text-body">
          No jobs-to-be-done yet — the profile is waiting for evidence.
        </p>
      )}
    </div>
  );
}
