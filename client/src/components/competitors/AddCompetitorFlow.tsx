import {
  Check,
  FileSearch,
  Globe,
  ListChecks,
  Loader2,
  Minus,
  PenLine,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { EvidenceRow } from "@/components/EvidenceChip";
import { joinNames } from "@/lib/api";
import { provenanceLine } from "@/mock/competitors";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import type { AddStage, CompetitorProposal } from "@/mock/types";
import { CapabilityColumns } from "./CapabilityColumns";
import { ClassificationBadge } from "./chips";
import { SourceLink } from "./SourceLink";

/**
 * The "Track another" flow (spec part 2) — inline in the column, no modal.
 * All pipeline state lives behind the provider seam; this component only
 * renders the staged rows and the proposal card the provider emits.
 */

const STAGE_ICONS: Record<string, LucideIcon> = {
  read: Globe,
  changelog: FileSearch,
  reviews: Star,
  compare: ListChecks,
  draft: PenLine,
};

function StageRow({ stage }: { stage: AddStage }) {
  const Icon = STAGE_ICONS[stage.id] ?? Globe;
  const skipped = stage.status === "skipped";
  return (
    <div className="flex items-center gap-3 py-[7px]">
      {skipped ? (
        <Minus size={16} strokeWidth={1.75} className="text-ghost" aria-hidden />
      ) : (
        <Icon
          size={16}
          strokeWidth={1.75}
          className={stage.status === "done" ? "text-teal-deep" : "text-faint"}
          aria-hidden
        />
      )}
      <span
        className={[
          "flex-1 text-[15px] leading-[1.5]",
          skipped ? "text-faint" : "text-ink",
        ].join(" ")}
      >
        {stage.label}
      </span>
      {stage.status === "running" ? (
        <Loader2
          size={14}
          strokeWidth={2}
          className="animate-spin text-teal-deep"
          aria-label="In progress"
        />
      ) : stage.status === "done" ? (
        <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-faint">
          <Check size={13} strokeWidth={2.25} className="text-teal-deep" aria-hidden />
          {stage.completedIn}
        </span>
      ) : null}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: CompetitorProposal }) {
  const actions = useAppActions();
  return (
    <div className="mt-2">
      <div className="mb-3 font-mono text-xs tabular-nums text-faint">
        {proposal.summaryLine}
      </div>
      <div className="rounded-[10px] border border-edge bg-surface p-5">
        <div className="mb-1 flex items-baseline gap-3">
          <input
            value={proposal.name}
            onChange={(event) => actions.setProposalName(event.target.value)}
            onBlur={actions.commitProposalName}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            aria-label="Proposed competitor name"
            className="min-w-0 flex-1 border-b border-transparent bg-transparent text-[17px] font-semibold tracking-[-0.01em] text-ink outline-none focus:border-edge-input"
          />
          <ClassificationBadge
            value={proposal.classification}
            onClick={actions.toggleProposalClassification}
            title={
              proposal.classification === "DIRECT"
                ? "Switch to ADJACENT"
                : "Switch to DIRECT"
            }
          />
        </div>
        {proposal.nameError ? (
          <p className="mb-2 text-[12px] leading-[1.5] text-red-700 dark:text-red-400">
            {proposal.nameError}
          </p>
        ) : null}
        <div className="mb-4 font-mono text-xs text-faint">
          {proposal.domain} · suggested: {proposal.suggestedThreat}
        </div>
        {proposal.adoption ? (
          // ADR 003 §2.3 adoption variant: the entity already exists in the
          // organisation — the profile below is reused, not re-researched.
          <div className="mb-4 rounded-[9px] border border-edge bg-inset px-4 py-3 text-[13px] leading-[1.6] text-body">
            <span className="font-medium text-ink">
              Already tracked for{" "}
              {joinNames(proposal.adoption.otherProductNames)}
            </span>{" "}
            — adopt them for this product? The profile below is what your
            organisation already knows; tracking here reuses it, and only the
            comparison against this product is drawn up afresh.
          </div>
        ) : null}
        <p className="mb-5 text-[15px] leading-[1.65] text-ink [text-wrap:pretty]">
          {proposal.summary}
        </p>
        {proposal.theyBeatYouOn.length > 0 ||
        proposal.youBeatThemOn.length > 0 ? (
          <div className="mb-5">
            <CapabilityColumns
              theyBeatYouOn={proposal.theyBeatYouOn}
              youBeatThemOn={proposal.youBeatThemOn}
            />
          </div>
        ) : null}
        {proposal.differentiators && proposal.differentiators.length > 0 ? (
          <div className="mb-5">
            <div className="mb-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
              What sets them apart
            </div>
            <div className="flex flex-col gap-1.5 text-[13.5px] leading-[1.65] text-body">
              {proposal.differentiators.map((item) => (
                <div key={item.text}>
                  {item.text}
                  <SourceLink href={item.sourceUrl} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {proposal.crawlOnlyNote ? (
          <p className="mb-4 text-[12.5px] leading-[1.6] text-faint">
            {proposal.crawlOnlyNote}
          </p>
        ) : null}
        {proposal.failureNote ? (
          <p className="mb-4 rounded-[9px] border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] leading-[1.6] text-red-700 dark:text-red-400">
            {proposal.failureNote}
          </p>
        ) : null}
        {proposal.evidence.length > 0 ? (
          <div className="mb-5">
            <EvidenceRow evidence={proposal.evidence} />
          </div>
        ) : null}
        <div className="flex items-center gap-[9px]">
          <button
            type="button"
            onClick={actions.acceptProposal}
            className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Track {proposal.name}
          </button>
          <button
            type="button"
            onClick={actions.discardProposal}
            className="rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
          >
            Discard
          </button>
          {proposal.failureNote ? (
            <button
              type="button"
              onClick={actions.retryResearch}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ManualEntryForm() {
  const actions = useAppActions();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    actions.saveManualCompetitor({
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(url.trim() ? { url: url.trim() } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="mt-3 flex max-w-[420px] flex-col gap-2.5">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Competitor name"
        aria-label="Competitor name"
        required
        className="h-[40px] rounded-[9px] border border-edge-input bg-surface px-3.5 text-sm text-ink outline-none placeholder:text-ghost focus:border-teal"
      />
      <input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="One-line description (optional)"
        aria-label="One-line description (optional)"
        className="h-[40px] rounded-[9px] border border-edge-input bg-surface px-3.5 text-sm text-ink outline-none placeholder:text-ghost focus:border-teal"
      />
      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="competitor.com (optional)"
        aria-label="Website (optional)"
        className="h-[40px] rounded-[9px] border border-edge-input bg-surface px-3.5 text-sm text-ink outline-none placeholder:text-ghost focus:border-teal"
      />
      <div>
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Save competitor
        </button>
      </div>
      <p className="text-[12.5px] leading-[1.6] text-faint">
        Saved unverified — agents will retry in the background and merge what
        they find.
      </p>
    </form>
  );
}

export function AddCompetitorFlow({ variant }: { variant: "inline" | "day-one" }) {
  const state = useAppState();
  const actions = useAppActions();
  const flow = state.competitorAddFlow;
  const searchKeyMissing =
    state.competitorsOverview?.searchKeyMissing ?? false;

  const inputRow = (
    <div>
      {flow.orphan ? (
        <div className="mb-4 flex items-center gap-3 rounded-[9px] border border-edge bg-inset px-4 py-3">
          <p className="flex-1 text-[13px] leading-[1.55] text-body">
            You were reviewing{" "}
            <span className="font-medium text-ink">{flow.orphan.name}</span> —
            continue or discard.
          </p>
          <button
            type="button"
            onClick={actions.resumeProposal}
            className="whitespace-nowrap text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={actions.discardProposal}
            className="whitespace-nowrap text-[12.5px] font-medium text-body hover:underline"
          >
            Discard
          </button>
        </div>
      ) : null}
      <div className="flex max-w-[480px] gap-2.5">
        {flow.mode === "url" ? (
          <input
            type="text"
            value={flow.draft}
            onChange={(event) => actions.setAddFlowDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                actions.researchCompetitor();
              }
            }}
            placeholder="competitor.com"
            aria-label="Competitor website"
            className="h-[46px] flex-1 rounded-[9px] border border-edge-input bg-surface px-3.5 text-sm text-ink outline-none placeholder:text-ghost focus:border-teal"
          />
        ) : (
          <input
            type="text"
            value={flow.draft}
            onChange={(event) => actions.setAddFlowDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                actions.researchCompetitor();
              }
            }}
            placeholder="Competitor name"
            aria-label="Competitor name"
            className="h-[46px] flex-1 rounded-[9px] border border-edge-input bg-surface px-3.5 text-sm text-ink outline-none placeholder:text-ghost focus:border-teal"
          />
        )}
        <button
          type="button"
          onClick={actions.researchCompetitor}
          className="h-[46px] rounded-[9px] bg-teal px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Research them
        </button>
      </div>
      <p className="mt-3 max-w-[480px] text-[12.5px] leading-[1.65] text-faint">
        About two minutes: I’ll read their site, look for a changelog and help
        centre, mine reviews, and compare them against your own feature
        inventory. You’ll review the profile before anything is saved.
      </p>
      <div className="mt-2">
        {flow.mode === "url" ? (
          searchKeyMissing ? (
            <p className="text-[12.5px] text-faint">
              <span className="text-ghost">I only know the name</span> —
              researching by name needs a web-search key.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => actions.setAddFlowMode("name")}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              I only know the name
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => actions.setAddFlowMode("url")}
            className="text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            Use their web address instead
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && variant === "inline") {
          actions.closeAddFlow();
        }
      }}
    >
      {variant === "inline" ? (
        <p className="mb-3.5 text-[15px] font-medium leading-[1.5] text-ink">
          Who should Discoveree keep an eye on?
        </p>
      ) : null}

      {flow.phase === "input" ? inputRow : null}

      {flow.phase === "researching" ? (
        <div>
          <div className="flex max-w-[480px] gap-2.5">
            <input
              type="text"
              value={flow.draft}
              disabled
              aria-label="Competitor"
              className="h-[46px] flex-1 rounded-[9px] border border-edge-input bg-inset px-3.5 text-sm text-faint outline-none"
            />
          </div>
          <div className="mt-4 max-w-[560px]">
            {flow.stages.map((stage) => (
              <StageRow key={stage.id} stage={stage} />
            ))}
          </div>
          <p className="mt-3 max-w-[520px] text-[12.5px] leading-[1.65] text-faint">
            {provenanceLine}
          </p>
        </div>
      ) : null}

      {flow.phase === "failed" && flow.failure ? (
        <div className="max-w-[560px]">
          <div className="rounded-[9px] border border-red-500/20 bg-red-500/5 px-4 py-3 text-[14px] leading-[1.6] text-red-700 dark:text-red-400">
            {flow.failure.line}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={actions.retryResearch}
              className="rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
            >
              Try again
            </button>
            {searchKeyMissing ? (
              <span className="text-[12.5px] text-faint">
                Researching by name needs a web-search key.
              </span>
            ) : (
              <button
                type="button"
                onClick={actions.researchByNameInstead}
                className="text-[12.5px] font-medium text-teal-deep hover:underline"
              >
                Research by name instead
              </button>
            )}
            <button
              type="button"
              onClick={actions.startManualEntry}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Add the basics myself
            </button>
          </div>
        </div>
      ) : null}

      {flow.phase === "manual" ? <ManualEntryForm /> : null}

      {flow.phase === "proposal" && flow.proposal ? (
        <ProposalCard proposal={flow.proposal} />
      ) : null}
    </div>
  );
}
