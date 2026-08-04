import { useState, type MouseEvent } from "react";
import { formatElapsed } from "@/mock/competitors";

/**
 * The stamp is the control (spec 4.1): `verified 4 h ago` gains an underline
 * and a trailing teal "· check now" on hover; clicking runs the refresh agent
 * for that competitor. While an agent runs, the stamp swaps to a live teal
 * mono elapsed counter — no spinner glyphs in the prose column (4.2).
 */
export function VerifiedStamp({
  verifiedAgo,
  stale,
  unverified,
  unverifiedLabel = "added by hand · not yet verified",
  lastRunFailed,
  checkingElapsedS,
  agentsPaused,
  onCheck,
  onRetry,
  verb = "verified",
  checkingLabel = "checking now",
}: {
  verifiedAgo: string;
  stale?: boolean | undefined;
  unverified?: boolean | undefined;
  /** Amber copy for the unverified state (live: profile still being drafted). */
  unverifiedLabel?: string | undefined;
  lastRunFailed?: { at: string; reason: string } | undefined;
  /** Present ⇒ a refresh agent is running for this competitor. */
  checkingElapsedS?: number | undefined;
  agentsPaused?: boolean | undefined;
  onCheck: () => void;
  onRetry?: (() => void) | undefined;
  /** Themes say "refreshed"; segments and competitors say "verified". */
  verb?: "verified" | "refreshed" | undefined;
  /** Themes read "refreshing" while their agent runs. */
  checkingLabel?: "checking now" | "refreshing" | undefined;
}) {
  const [pausedNote, setPausedNote] = useState(false);

  // Typography ruling §3 (stamps): keyword in Inter, value in mono `.data`.
  if (checkingElapsedS !== undefined) {
    return (
      <span className="whitespace-nowrap text-xs text-teal-deep">
        {checkingLabel} ·{" "}
        <span className="data">{formatElapsed(checkingElapsedS)}</span>
      </span>
    );
  }

  if (lastRunFailed) {
    return (
      <span className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
        <span className="whitespace-nowrap text-xs text-red-700 dark:text-red-400">
          {lastRunFailed.reason}
          {lastRunFailed.at ? (
            <>
              {" · "}
              <span className="data">{lastRunFailed.at}</span>
            </>
          ) : null}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRetry?.();
          }}
          className="text-[12px] font-medium text-teal-deep hover:underline"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="text-[12px] font-medium text-teal-deep hover:underline"
        >
          View log
        </button>
      </span>
    );
  }

  if (unverified) {
    // Words, not data (ruling §3): the whole label is Inter.
    return (
      <span className="whitespace-nowrap text-xs text-amber-600 dark:text-amber-400">
        {unverifiedLabel}
      </span>
    );
  }

  // Defensive: never render a dangling "verified" with no timestamp.
  if (!verifiedAgo) {
    return null;
  }

  const handleClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (agentsPaused) {
      setPausedNote(true);
      return;
    }
    onCheck();
  };

  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        className="group/stamp whitespace-nowrap text-right text-xs"
        aria-label="Run the refresh agent now"
      >
        <span
          className={[
            "group-hover/stamp:underline",
            stale ? "text-amber-600 dark:text-amber-400" : "text-faint",
          ].join(" ")}
        >
          {/* The verb is a word; the leading time fragment of the stamp is
              the value; any trailing copy ("· nothing changed") is words. */}
          {verb} <span className="data">{verifiedAgo.split(" · ")[0]}</span>
          {verifiedAgo.includes(" · ")
            ? ` · ${verifiedAgo.split(" · ").slice(1).join(" · ")}`
            : ""}
        </span>
        <span className="hidden text-teal-deep group-hover/stamp:inline">
          {" "}
          · check now
        </span>
      </button>
      {pausedNote ? (
        <span className="mt-0.5 text-[11px] text-faint">
          Agents are paused — add an LLM key first.
        </span>
      ) : null}
    </span>
  );
}
