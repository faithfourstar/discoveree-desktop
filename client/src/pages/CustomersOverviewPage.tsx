import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { EvidenceBasisLine } from "@/components/customers/EvidenceBasisLine";
import {
  FilingResultLine,
  LogFeedbackFlow,
} from "@/components/customers/LogFeedbackFlow";
import { SegmentRowCard } from "@/components/customers/SegmentRowCard";
import { ThemeRowCard } from "@/components/customers/ThemeRowCard";
import { EvidenceRow } from "@/components/EvidenceChip";
import { RichText } from "@/components/RichText";
import { useProductHref } from "@/lib/productUrl";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import { useT } from "@/state/locale";
import type { CustomersOverview, SegmentAdoptionProposal } from "@/mock/types";

/**
 * The Customers Overview (customers spec part 1): themes above segments —
 * the fast band leads, the slow band anchors. No view toggle in v1.
 */

function BandKicker({ children }: { children: string }) {
  return (
    <div className="mb-1 mt-8 text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
      {children}
    </div>
  );
}

function QuietGroupLabel({ children }: { children: string }) {
  return (
    <div className="mt-6 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ghost">
      {children}
    </div>
  );
}

function SearchKeyNotice() {
  const productHref = useProductHref();
  return (
    <div className="mb-6 flex items-center gap-4 rounded-[9px] border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <p className="flex-1 text-[13px] leading-[1.55] text-body">
        Customer research is running without web search — review mining is
        paused. A Perplexity, OpenAI or Gemini key switches it on.
      </p>
      <Link
        href={productHref("/settings")}
        className="whitespace-nowrap rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
      >
        Add a key
      </Link>
    </div>
  );
}

/** The 3.4 adoption card — work already done is the invitation. */
function AdoptionCard({ adoption }: { adoption: SegmentAdoptionProposal }) {
  const { productName } = useAppState();
  const actions = useAppActions();
  return (
    <div className="mt-6 rounded-[10px] border border-edge bg-surface p-5">
      <div className="mb-1 text-[17px] font-semibold tracking-[-0.01em] text-ink">
        Already known — {adoption.name}
      </div>
      <p className="mb-4 text-[12.5px] text-faint">
        Served by {adoption.servedBy.name} since{" "}
        <span className="data">{adoption.servedBy.since}</span>
        . Reviewing for {productName}.
      </p>
      <p className="mb-4 text-[15px] leading-[1.65] text-ink [text-wrap:pretty]">
        {adoption.sharedIdentity}
      </p>
      {adoption.personas.map((persona) => (
        <div key={persona.id} className="mb-4">
          <div className="text-[14.5px] font-medium text-ink">
            {persona.title}
          </div>
          <p className="text-[13px] leading-[1.6] text-faint">
            {persona.identityLine}
          </p>
          <EvidenceBasisLine basis={persona.basis} />
        </div>
      ))}
      <p className="mb-4 text-[13.5px] leading-[1.65] text-body">
        What do they hire {productName} for? I’ll draft it from your site and
        their feedback — you’ll review it before it’s saved.
      </p>
      <div className="mb-5">
        <EvidenceRow evidence={adoption.evidence} />
      </div>
      <div className="flex gap-[9px]">
        <button
          type="button"
          onClick={actions.acceptSegmentAdoption}
          className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Add to {productName}
        </button>
        <button
          type="button"
          onClick={actions.dismissSegmentAdoption}
          className="rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
        >
          Not this product
        </button>
      </div>
    </div>
  );
}

function PopulatedOverview({ overview }: { overview: CustomersOverview }) {
  const state = useAppState();
  const actions = useAppActions();
  const flow = state.feedbackFlow;
  const flowRef = useRef<HTMLDivElement | null>(null);

  // The filing result line fades after the next navigation (spec 2.3).
  const clearResultRef = useRef(actions.clearFeedbackResult);
  clearResultRef.current = actions.clearFeedbackResult;
  useEffect(() => () => clearResultRef.current(), []);

  // Opening the flow scrolls it into view; clicking elsewhere collapses it
  // without losing typed input.
  useEffect(() => {
    if (flow.open) {
      flowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [flow.open]);
  useEffect(() => {
    if (!flow.open) {
      return;
    }
    const onMouseDown = (event: Event) => {
      if (
        flowRef.current &&
        event.target instanceof Node &&
        !flowRef.current.contains(event.target)
      ) {
        actions.closeFeedbackFlow();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [flow.open, actions]);

  const checking = state.customersChecking;
  const elapsedFor = (id: string) =>
    checking.find((entry) => entry.id === id)?.elapsedS;

  const activeThemes = overview.themes.filter(
    (theme) => theme.lifecycle !== "fading",
  );
  const fadingThemes = overview.themes.filter(
    (theme) => theme.lifecycle === "fading",
  );
  const fullThemes = activeThemes.slice(0, 8);
  const alsoFiled = activeThemes.slice(8);
  const fullSegments = overview.segments.slice(0, 6);
  const compressedSegments = overview.segments.slice(6);

  return (
    <div className="flex justify-center px-8 py-[38px]">
      <div className="w-full max-w-[720px]">
        {overview.searchKeyMissing ? <SearchKeyNotice /> : null}

        <div className="mb-4 flex items-baseline gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
            Customers · since you last looked
          </span>
          <button
            type="button"
            onClick={() => actions.openFeedbackFlow()}
            className="ml-auto text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            Log feedback
          </button>
        </div>

        <p className="mb-[6px] text-[21px] leading-[1.5] tracking-[-0.01em] text-ink [text-wrap:pretty]">
          {overview.reading ? (
            <span className="text-teal-deep">
              Reading{" "}
              <span className="data">
                {overview.reading.itemCount}
              </span>{" "}
              new feedback items now —{" "}
            </span>
          ) : null}
          <RichText value={overview.lede} />
        </p>

        {flow.result ? <FilingResultLine result={flow.result} /> : null}

        <BandKicker>What you’re hearing</BandKicker>
        <div className="flex flex-col">
          {fullThemes.map((theme) => (
            <ThemeRowCard
              key={theme.id}
              row={theme}
              checkingElapsedS={elapsedFor(theme.id)}
              agentsPaused={state.agentsPaused}
              justVerified={state.justVerifiedId === theme.id}
              onRefresh={() => actions.refreshTheme(theme.id)}
            />
          ))}
          {alsoFiled.length > 0 ? (
            <>
              <QuietGroupLabel>Also filed</QuietGroupLabel>
              {alsoFiled.map((theme) => (
                <ThemeRowCard
                  key={theme.id}
                  row={theme}
                  compressed
                  checkingElapsedS={elapsedFor(theme.id)}
                  agentsPaused={state.agentsPaused}
                  justVerified={state.justVerifiedId === theme.id}
                  onRefresh={() => actions.refreshTheme(theme.id)}
                />
              ))}
            </>
          ) : null}
          {fadingThemes.length > 0 ? (
            <>
              <QuietGroupLabel>Fading</QuietGroupLabel>
              {fadingThemes.map((theme) => (
                <ThemeRowCard
                  key={theme.id}
                  row={theme}
                  compressed
                  checkingElapsedS={elapsedFor(theme.id)}
                  agentsPaused={state.agentsPaused}
                  justVerified={state.justVerifiedId === theme.id}
                  onRefresh={() => actions.refreshTheme(theme.id)}
                />
              ))}
            </>
          ) : null}
          {overview.unfiledCount ? (
            <button
              type="button"
              className="py-3 text-left text-[12.5px] text-faint hover:text-muted"
            >
              <span className="data">{overview.unfiledCount}</span>{" "}
              {overview.unfiledCount === 1 ? "item" : "items"} waiting for a
              pattern
            </button>
          ) : null}
        </div>

        {overview.segments.length > 0 || state.segmentAdoption ? (
          <>
            <BandKicker>Who you serve</BandKicker>
            <div className="flex flex-col">
              {fullSegments.map((segment) => (
                <SegmentRowCard
                  key={segment.id}
                  row={segment}
                  checkingElapsedS={elapsedFor(segment.id)}
                  agentsPaused={state.agentsPaused}
                  justVerified={state.justVerifiedId === segment.id}
                  onCheck={() => actions.checkSegment(segment.id)}
                />
              ))}
              {compressedSegments.map((segment) => (
                <SegmentRowCard
                  key={segment.id}
                  row={segment}
                  compressed
                  checkingElapsedS={elapsedFor(segment.id)}
                  agentsPaused={state.agentsPaused}
                  justVerified={state.justVerifiedId === segment.id}
                  onCheck={() => actions.checkSegment(segment.id)}
                />
              ))}
            </div>
            {state.segmentAdoption ? (
              <AdoptionCard adoption={state.segmentAdoption} />
            ) : null}
          </>
        ) : null}

        <div ref={flowRef} className="mt-1">
          {flow.open ? (
            <div className="border-t border-edge-hairline pt-6">
              <LogFeedbackFlow variant="inline" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => actions.openFeedbackFlow()}
              className="w-full py-4 text-left text-[13px] font-medium text-teal-deep hover:underline"
            >
              Log a piece of feedback
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Day one — module enabled, nothing yet (spec 2.4). */
function DayOneCustomers() {
  const state = useAppState();
  const t = useT();
  const actions = useAppActions();
  const proposals = state.segmentProposals;
  const [ticked, setTicked] = useState<readonly string[]>(
    proposals ? proposals.map((proposal) => proposal.id) : [],
  );

  if (state.segmentAdoption) {
    return (
      <div className="flex justify-center px-8 py-[38px]">
        <div className="w-full max-w-[720px]">
          <p className="mb-2 text-[21px] leading-[1.5] tracking-[-0.01em] text-ink [text-wrap:pretty]">
            {t(
              "One customer segment is already known to your organisation. Keep it if it rings true for this product.",
            )}
          </p>
          <AdoptionCard adoption={state.segmentAdoption} />
        </div>
      </div>
    );
  }

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
            likely customer segments. Keep the ones that ring true.
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
                <span className="text-[13px] text-faint">{proposal.reason}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={ticked.length === 0}
            onClick={() => actions.addSegmentProposals(ticked)}
            className="mb-8 rounded-[9px] bg-teal px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Add{" "}
            <span className="data">{ticked.length}</span>{" "}
            segments
          </button>
          <LogFeedbackFlow variant="day-one" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center px-8">
      <div className="w-full max-w-[600px]">
        <p className="mb-[26px] text-[23px] leading-[1.45] tracking-[-0.015em] text-ink [text-wrap:pretty]">
          Where does customer feedback land today? Tell me one thing a customer
          said — or point me at your reviews — and I’ll start finding the
          themes.
        </p>
        <LogFeedbackFlow variant="day-one" />
        <div className="mt-4">
          <button
            type="button"
            className="text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            Set up a feedback source
          </button>
        </div>
        <p className="mt-6 text-[12.5px] leading-[1.65] text-faint">
          Segments and personas here are built from real feedback, reviews and
          what you tell me — never guessed. Everything you’ll see carries its
          evidence.
        </p>
      </div>
    </div>
  );
}

export function CustomersOverviewPage() {
  const { customersOverview, segmentProposals } = useAppState();
  if (!customersOverview) {
    return (
      <DayOneCustomers key={segmentProposals ? "proposals" : "empty"} />
    );
  }
  return <PopulatedOverview overview={customersOverview} />;
}
