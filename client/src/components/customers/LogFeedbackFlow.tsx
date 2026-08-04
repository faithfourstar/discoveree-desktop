import { Link } from "wouter";
import { useProductHref } from "@/lib/productUrl";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import type { FeedbackFilingResult } from "@/mock/types";
import { themePath } from "./ThemeRowCard";

/**
 * The log-feedback flow (customers spec part 2) — inline in the column, no
 * modal. The verbatim alone is enough to file; matching reports honestly and
 * never blocks on an LLM key.
 */

const WHERE_OPTIONS = [
  "Customer call",
  "Support ticket",
  "Email",
  "Sales conversation",
  "Somewhere else",
] as const;

/** The 2.3 result line — teal-led prose, fades after the next navigation. */
export function FilingResultLine({ result }: { result: FeedbackFilingResult }) {
  const productHref = useProductHref();
  if (result.kind === "matched") {
    return (
      <p className="py-3 text-[15px] leading-[1.6] text-ink">
        <span className="text-teal-deep">Filed under </span>
        <Link
          href={productHref(themePath(result.themeId))}
          className="font-medium text-teal-deep hover:underline"
        >
          {result.themeName}
        </Link>
        <span className="text-teal-deep">
          {" "}
          — its{" "}
          <span className="font-mono text-[0.88em] tabular-nums">
            {result.ordinal}
          </span>{" "}
          mention.
        </span>
      </p>
    );
  }
  if (result.kind === "held") {
    return (
      <p className="py-3 text-[15px] leading-[1.6] text-body">
        Kept safe — matching runs when agents are back on.
      </p>
    );
  }
  if (result.kind === "filed") {
    return (
      <p className="py-3 text-[15px] leading-[1.6] text-body">
        <span className="text-teal-deep">Filed word for word</span> — matching
        it against your themes now.
      </p>
    );
  }
  if (result.totalThemes === 0) {
    return (
      <p className="py-3 text-[15px] leading-[1.6] text-body">
        Kept word for word — a theme forms when the pattern does.
      </p>
    );
  }
  return (
    <p className="py-3 text-[15px] leading-[1.6] text-body">
      That’s new — nothing like it in your{" "}
      <span className="font-mono text-[0.88em] tabular-nums">
        {result.totalThemes}
      </span>{" "}
      themes. Holding it with{" "}
      <span className="font-mono text-[0.88em] tabular-nums">
        {result.unfiledCount - 1}
      </span>{" "}
      other unfiled item{result.unfiledCount === 2 ? "" : "s"}; a theme forms
      when the pattern does.
    </p>
  );
}

export function LogFeedbackFlow({
  variant,
}: {
  variant: "inline" | "day-one";
}) {
  const { feedbackFlow } = useAppState();
  const actions = useAppActions();

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && variant === "inline") {
          actions.closeFeedbackFlow();
        }
      }}
    >
      {variant === "inline" ? (
        <p className="mb-3.5 text-[15px] font-medium leading-[1.5] text-ink">
          What did you hear?
        </p>
      ) : null}
      <textarea
        value={feedbackFlow.draft}
        onChange={(event) => actions.setFeedbackField("draft", event.target.value)}
        placeholder="Paste or type what the customer said — their words, not a summary."
        aria-label="What they said"
        rows={3}
        className="w-full max-w-[560px] rounded-[10px] border border-edge-input bg-surface px-[14px] py-3 text-sm leading-relaxed text-ink outline-none placeholder:text-ghost focus:border-teal"
      />
      <div className="mt-2.5 flex max-w-[560px] flex-wrap items-baseline gap-x-5 gap-y-2">
        <label className="flex items-baseline gap-2">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
            Who
          </span>
          <input
            type="text"
            value={feedbackFlow.who ?? ""}
            onChange={(event) => actions.setFeedbackField("who", event.target.value)}
            placeholder="Segment or persona"
            aria-label="Who said it"
            className="w-[150px] border-b border-edge-input bg-transparent pb-0.5 text-[12.5px] text-ink outline-none placeholder:text-ghost focus:border-teal"
          />
        </label>
        <label className="flex items-baseline gap-2">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
            Where
          </span>
          <select
            value={feedbackFlow.where ?? ""}
            onChange={(event) => actions.setFeedbackField("where", event.target.value)}
            aria-label="Where you heard it"
            className="border-b border-edge-input bg-transparent pb-0.5 text-[12.5px] text-ink outline-none focus:border-teal"
          >
            <option value="">—</option>
            {WHERE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-baseline gap-2">
          <span
            className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label"
            title="When was this said? Defaults to today."
          >
            When
          </span>
          <input
            type="text"
            value={feedbackFlow.when ?? ""}
            onChange={(event) => actions.setFeedbackField("when", event.target.value)}
            placeholder="today"
            aria-label="When was this said"
            className="w-[90px] border-b border-edge-input bg-transparent pb-0.5 text-[12.5px] tabular-nums text-ink outline-none placeholder:text-ghost focus:border-teal"
          />
        </label>
      </div>
      <div className="mt-3.5 flex items-center gap-3.5">
        <button
          type="button"
          onClick={actions.fileFeedback}
          disabled={!feedbackFlow.draft.trim()}
          className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          File it
        </button>
        <span className="text-[12.5px] leading-[1.65] text-faint">
          Kept word for word, with its source — I’ll match it against your
          themes as it lands.
        </span>
      </div>
      {feedbackFlow.error ? (
        <p className="mt-2 text-[12.5px] leading-[1.6] text-red-700 dark:text-red-400">
          {feedbackFlow.error}
        </p>
      ) : null}
    </div>
  );
}
