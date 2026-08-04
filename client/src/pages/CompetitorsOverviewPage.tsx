import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AddCompetitorFlow } from "@/components/competitors/AddCompetitorFlow";
import { ArrivalsReviewBlock } from "@/components/connections/ArrivalCard";
import { CompetitorRowCard } from "@/components/competitors/CompetitorRowCard";
import { CompetitorsTable } from "@/components/competitors/CompetitorsTable";
import { RichText } from "@/components/RichText";
import { useProductHref } from "@/lib/productUrl";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import type { CompetitorsOverview } from "@/mock/types";

/**
 * The Competitors Overview — a Level-1 page: one scannable page for the
 * whole competitive set, blocks materialise only when populated (spec part 1).
 */

function ViewToggle({
  view,
  onChange,
}: {
  view: "cards" | "table";
  onChange: (view: "cards" | "table") => void;
}) {
  const segment = (value: "cards" | "table", label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={view === value}
      className={[
        "px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
        view === value ? "bg-chip text-ink" : "text-faint hover:text-muted",
      ].join(" ")}
    >
      {label}
    </button>
  );
  return (
    <span
      role="group"
      aria-label="View"
      className="flex overflow-hidden rounded-[6px] border border-edge-hairline"
    >
      {segment("cards", "Cards")}
      {segment("table", "Table")}
    </span>
  );
}

function SearchKeyNotice() {
  const productHref = useProductHref();
  return (
    <div className="mb-6 flex items-center gap-4 rounded-[9px] border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <p className="flex-1 text-[13px] leading-[1.55] text-body">
        Competitor research is running without web search — reviews and market
        news are paused. A Perplexity, OpenAI or Gemini key switches them on.
      </p>
      <Link
        href={productHref("/settings#llm-keys")}
        className="whitespace-nowrap rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
      >
        Add a key
      </Link>
    </div>
  );
}

/** The live clause prepended while agents run (spec 1.2.4 / 4.2). */
function CheckingClause({ overview }: { overview: CompetitorsOverview }) {
  const checking = overview.checking ?? [];
  if (checking.length === 0) {
    return null;
  }
  const names = checking.map((entry) => entry.name).join(" and ");
  return (
    <span className="text-teal-deep">
      Checking {names} now —{" "}
    </span>
  );
}

function PopulatedOverview({ overview }: { overview: CompetitorsOverview }) {
  const state = useAppState();
  const actions = useAppActions();
  const flow = state.competitorAddFlow;
  const flowRef = useRef<HTMLDivElement | null>(null);

  // ⌘\ cycles views (spec 1.5).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        actions.toggleCompetitorsView();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);

  // Opening the flow scrolls it into view — "Track another" sits in the
  // header, but the flow expands at the foot of the list.
  useEffect(() => {
    if (flow.open) {
      flowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [flow.open]);

  // Clicking elsewhere collapses the add flow without losing typed input.
  useEffect(() => {
    if (!flow.open) {
      return;
    }
    const onMouseDown = (event: Event) => {
      const target = event.target;
      if (
        flowRef.current &&
        target instanceof Node &&
        !flowRef.current.contains(target)
      ) {
        actions.closeAddFlow();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [flow.open, actions]);

  const checking = overview.checking ?? [];
  const elapsedFor = (id: string) =>
    checking.find((entry) => entry.id === id)?.elapsedS;
  const table = overview.view === "table";
  const fullRows = overview.rows.slice(0, 8);
  const alsoWatching = overview.rows.slice(8);

  return (
    <div className="flex justify-center px-8 py-[38px]">
      <div
        className={[
          "w-full",
          table ? "max-w-[960px]" : "max-w-[720px]",
        ].join(" ")}
      >
        {overview.searchKeyMissing ? <SearchKeyNotice /> : null}

        <div className="mb-4 flex items-baseline gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
            Competitors · since you last looked
          </span>
          <span className="ml-auto flex items-center gap-3.5">
            <ViewToggle
              view={overview.view}
              onChange={actions.setCompetitorsView}
            />
            <button
              type="button"
              onClick={actions.openAddFlow}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Track another
            </button>
          </span>
        </div>

        <p className="mb-[30px] text-[21px] leading-[1.5] tracking-[-0.01em] text-ink [text-wrap:pretty]">
          <CheckingClause overview={overview} />
          <RichText value={overview.lede} />
        </p>

        <ArrivalsReviewBlock
          arrivals={state.arrivals.filter(
            (card) => card.kind === "competitor-intel",
          )}
        />

        {table ? (
          <CompetitorsTable
            rows={overview.rows}
            checking={checking}
            agentsPaused={state.agentsPaused}
            justVerifiedId={state.justVerifiedId}
            onCheck={actions.checkCompetitor}
          />
        ) : (
          <div className="flex flex-col">
            {fullRows.map((row) => (
              <CompetitorRowCard
                key={row.id}
                row={row}
                checkingElapsedS={elapsedFor(row.id)}
                agentsPaused={state.agentsPaused}
                justVerified={state.justVerifiedId === row.id}
                onCheck={() => actions.checkCompetitor(row.id)}
              />
            ))}
            {alsoWatching.length > 0 ? (
              <>
                <div className="mt-7 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
                  Also watching
                </div>
                {alsoWatching.map((row) => (
                  <CompetitorRowCard
                    key={row.id}
                    row={row}
                    compressed
                    checkingElapsedS={elapsedFor(row.id)}
                    agentsPaused={state.agentsPaused}
                    justVerified={state.justVerifiedId === row.id}
                    onCheck={() => actions.checkCompetitor(row.id)}
                  />
                ))}
              </>
            ) : null}
          </div>
        )}

        <div ref={flowRef} className="mt-1">
          {flow.open ? (
            <div className="border-t border-edge-hairline pt-6">
              <AddCompetitorFlow variant="inline" />
            </div>
          ) : (
            <button
              type="button"
              onClick={actions.openAddFlow}
              className="w-full py-4 text-left text-[13px] font-medium text-teal-deep hover:underline"
            >
              Track another competitor
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Day one — module enabled, no competitors yet (spec 2.5). */
function DayOneCompetitors() {
  const state = useAppState();
  const actions = useAppActions();
  const proposals = state.onboardingProposals;
  const [ticked, setTicked] = useState<readonly string[]>(
    proposals ? proposals.map((proposal) => proposal.id) : [],
  );

  if (proposals && proposals.length > 0) {
    const toggle = (id: string) =>
      setTicked((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
      );
    return (
      <div className="flex min-h-full items-center justify-center px-8">
        <div className="w-full max-w-[600px]">
          <p className="mb-[26px] text-[23px] leading-[1.45] tracking-[-0.015em] text-ink [text-wrap:pretty]">
            Onboarding turned up{" "}
            <span className="data">
              {proposals.length}
            </span>{" "}
            likely {proposals.length === 1 ? "competitor" : "competitors"}.
            Keep the ones that matter.
          </p>
          <div className="mb-5 rounded-[10px] border border-edge bg-surface px-5 py-2">
            {proposals.map((proposal) => (
              <label
                key={proposal.id}
                className="flex cursor-pointer items-baseline gap-3 border-t border-edge-hairline py-3.5 first:border-t-0"
              >
                <input
                  type="checkbox"
                  checked={ticked.includes(proposal.id)}
                  onChange={() => toggle(proposal.id)}
                  className="translate-y-[1px] accent-teal"
                />
                <span className="text-[14.5px] font-medium text-ink">
                  {proposal.name}
                </span>
                <span className="text-[13px] text-faint">
                  {proposal.reason}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={ticked.length === 0}
            onClick={() => actions.trackOnboardingProposals(ticked)}
            className="mb-8 rounded-[9px] bg-teal px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Track{" "}
            <span className="data">{ticked.length}</span>{" "}
            {ticked.length === 1 ? "competitor" : "competitors"}
          </button>
          <AddCompetitorFlow variant="day-one" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center px-8">
      <div className="w-full max-w-[600px]">
        <p className="mb-[26px] text-[23px] leading-[1.45] tracking-[-0.015em] text-ink [text-wrap:pretty]">
          Who should Discoveree keep an eye on? Give me a competitor’s site
          and I’ll build the profile — then keep it current without being
          asked.
        </p>
        <AddCompetitorFlow variant="day-one" />
      </div>
    </div>
  );
}

export function CompetitorsOverviewPage() {
  const { competitorsOverview, onboardingProposals } = useAppState();
  if (!competitorsOverview) {
    // Keyed so the pre-ticked checklist initialises when proposals appear.
    return (
      <DayOneCompetitors key={onboardingProposals ? "proposals" : "empty"} />
    );
  }
  return <PopulatedOverview overview={competitorsOverview} />;
}
