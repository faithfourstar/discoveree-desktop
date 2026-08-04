import {
  BookOpen,
  FileSearch,
  Globe,
  MoreHorizontal,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { CapabilityColumn } from "@/components/competitors/CapabilityColumns";
import { NewTag } from "@/components/competitors/chips";
import { SourceLink } from "@/components/competitors/SourceLink";
import { VerifiedStamp } from "@/components/competitors/VerifiedStamp";
import { EmptyState } from "@/components/EmptyState";
import { EvidenceRow } from "@/components/EvidenceChip";
import { RichText } from "@/components/RichText";
import { useProductHref } from "@/lib/productUrl";
import { countNoun } from "@/lib/text";
import { competitorSlug } from "@/mock/competitors";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import type {
  CapabilityRef,
  CitedDifferentiator,
  CitedFeature,
  CitedMarket,
  CompetitorObject,
  DeepDiveThread,
  FeatureCoverage,
  ObjectChange,
  ReviewEvidence,
  SourceRow,
  ThreatWord,
} from "@/mock/types";

function SectionKicker({ children }: { children: string }) {
  return (
    <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
      {children}
    </div>
  );
}

/** The Thread pattern: a deep dive growing inside the column, teal-edged. */
function OpenThread({ thread }: { thread: DeepDiveThread }) {
  return (
    <section className="border-l-2 border-teal pl-5">
      <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-teal">
        Deep dive · {thread.status}
      </div>
      <div className="mb-3 text-[15.5px] font-medium leading-[1.5] text-ink">
        {thread.question}
      </div>
      <div className="mb-3 text-[13.5px] leading-[1.7] text-body">
        {thread.answer}
      </div>
      <div className="mb-4">
        <EvidenceRow evidence={thread.evidence} />
      </div>
      <div className="flex gap-[9px]">
        <button
          type="button"
          className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          {thread.fileUnderLabel}
        </button>
        <button
          type="button"
          className="rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
        >
          {thread.keepAskingLabel}
        </button>
      </div>
    </section>
  );
}

function CoverageList({
  heading,
  items,
}: {
  heading: string;
  items: readonly CapabilityRef[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 6);
  return (
    <div className="flex-1">
      <div className="mb-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
        {heading}
      </div>
      <div className="text-[13.5px] leading-[1.75] text-body">
        {visible.map((item) => (
          <div key={item.id}>
            <button
              type="button"
              className="text-left hover:text-teal-deep hover:underline"
            >
              {item.label}
            </button>
          </div>
        ))}
        {!showAll && items.length > 6 ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-1 text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            Show all{" "}
            <span className="font-mono tabular-nums">{items.length}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** NEW — feature coverage against your inventory (spec part 3.5). */
function CoverageSection({ coverage }: { coverage: FeatureCoverage }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="mt-8 border-t border-edge-hairline pt-[26px]">
      <SectionKicker>Where you overlap</SectionKicker>
      <p className="text-[15px] leading-[1.65] text-ink [text-wrap:pretty]">
        They cover{" "}
        <button
          type="button"
          title="Open the filtered feature inventory"
          className="font-mono text-[0.88em] tabular-nums text-teal-deep hover:underline"
        >
          {coverage.covered}
        </button>{" "}
        of the{" "}
        <span className="font-mono text-[0.88em] tabular-nums">
          {coverage.inventoryTotal}
        </span>{" "}
        features in your inventory, and{" "}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="font-mono text-[0.88em] tabular-nums text-teal-deep hover:underline"
        >
          {coverage.uniqueToThem}
        </button>{" "}
        of theirs have no equivalent in yours.
      </p>
      {expanded ? (
        <div className="mt-5 flex gap-[34px]">
          <CoverageList
            heading="They have, you don’t"
            items={coverage.theyHaveYouDont}
          />
          <CoverageList
            heading="You have, they don’t"
            items={coverage.youHaveTheyDont}
          />
        </div>
      ) : null}
    </section>
  );
}

/** NEW — what buyers say (spec part 3.6). */
function BuyersSection({ review }: { review: ReviewEvidence }) {
  return (
    <section className="mt-8 border-t border-edge-hairline pt-[26px]">
      <SectionKicker>What buyers say</SectionKicker>
      <p className="mb-4 text-[15px] leading-[1.65] text-ink">
        <RichText value={review.line} />
      </p>
      <div className="flex flex-col gap-3.5">
        {review.quotes.map((quote) => (
          <blockquote
            key={quote.id}
            className="border-l border-edge-hairline pl-4"
          >
            <p className="text-[13.5px] leading-[1.65] text-body">
              “{quote.text}”
            </p>
            <footer className="mt-1 font-mono text-[11px] text-faint">
              {quote.attribution}
            </footer>
          </blockquote>
        ))}
      </div>
      <button
        type="button"
        className="mt-4 text-[12.5px] font-medium text-teal-deep hover:underline"
      >
        All review evidence →
      </button>
    </section>
  );
}

/** Live API — provenance-carrying differentiators (no invented columns). */
function DifferentiatorsSection({
  items,
}: {
  items: readonly CitedDifferentiator[];
}) {
  return (
    <section className="mt-8 border-t border-edge-hairline pt-[26px]">
      <SectionKicker>What sets them apart</SectionKicker>
      <div className="flex flex-col gap-2 text-[13.5px] leading-[1.65] text-body">
        {items.map((item) => (
          <div key={item.text}>
            {item.text}
            <SourceLink href={item.sourceUrl} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Live API — the 20 newest change records, each evidence-cited. */
function RecentChangesSection({
  changes,
}: {
  changes: readonly ObjectChange[];
}) {
  return (
    <section className="mt-8 border-t border-edge-hairline pt-[26px]">
      <SectionKicker>Recent changes</SectionKicker>
      <div className="flex flex-col gap-4">
        {changes.map((change) => (
          <div key={change.id}>
            <p className="text-[14.5px] font-medium leading-[1.55] text-ink">
              {change.title}
            </p>
            {change.description ? (
              <p className="mt-0.5 text-[13.5px] leading-[1.6] text-body">
                {change.description}
              </p>
            ) : null}
            <p className="mt-1 font-mono text-[11px] text-faint">
              {change.changeType}
              {change.detectedOn ? ` · ${change.detectedOn}` : ""}
              <SourceLink href={change.sourceUrl} />
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Live API — the catalogued feature list, with a Show-all expander. */
function KeyFeaturesSection({ items }: { items: readonly CitedFeature[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 8);
  return (
    <section className="mt-8 border-t border-edge-hairline pt-[26px]">
      <SectionKicker>Key features</SectionKicker>
      <div className="text-[13.5px] leading-[1.75] text-body">
        {visible.map((item) => (
          <div key={item.feature}>
            {item.feature}
            <SourceLink href={item.sourceUrl} />
          </div>
        ))}
        {!showAll && items.length > 8 ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-1 text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            Show all{" "}
            <span className="font-mono tabular-nums">{items.length}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Live API — markets served, as quiet chips. */
function MarketsSection({ items }: { items: readonly CitedMarket[] }) {
  return (
    <section className="mt-8 border-t border-edge-hairline pt-[26px]">
      <SectionKicker>Markets</SectionKicker>
      <div className="flex flex-wrap gap-[9px]">
        {items.map((item) =>
          item.sourceUrl ? (
            <a
              key={item.market}
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-1 font-mono text-[10.5px] font-medium text-muted hover:text-teal-deep hover:underline"
            >
              {item.market}
            </a>
          ) : (
            <span
              key={item.market}
              className="whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-1 font-mono text-[10.5px] font-medium text-muted"
            >
              {item.market}
            </span>
          ),
        )}
      </div>
    </section>
  );
}

const SOURCE_ICONS: Record<string, LucideIcon> = {
  "site crawl": Globe,
  "watching for changes": FileSearch,
  "review mining": Star,
  "feature inventory": BookOpen,
};

/** NEW — provenance audit (spec part 3.7). */
function SourcesSection({ sources }: { sources: readonly SourceRow[] }) {
  return (
    <section className="mt-8 border-t border-edge-hairline pt-[26px]">
      <SectionKicker>What this profile is built on</SectionKicker>
      <div className="flex flex-col">
        {sources.map((source) => {
          const Icon = SOURCE_ICONS[source.feeds] ?? Globe;
          return (
            <button
              key={source.id}
              type="button"
              title="Open the source record"
              className="group flex items-baseline gap-3 py-[7px] text-left"
            >
              <Icon
                size={14}
                strokeWidth={1.75}
                className="translate-y-[2px] text-faint"
                aria-hidden
              />
              <span className="font-mono text-xs text-body group-hover:underline">
                {source.name}
              </span>
              <span className="font-mono text-xs text-faint">
                {source.feeds}
              </span>
              <span
                className={[
                  "ml-auto font-mono text-xs tabular-nums",
                  source.stale
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-faint",
                ].join(" ")}
              >
                {source.stamp}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-3 text-[12.5px] font-medium text-teal-deep hover:underline"
      >
        Add a source
      </button>
    </section>
  );
}

/** Relationship and housekeeping edits behind the ghost "…" (spec part 3). */
function OverflowMenu({
  competitor,
  onStopTracking,
}: {
  competitor: CompetitorObject;
  onStopTracking: () => void;
}) {
  const actions = useAppActions();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: Event) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const threatWords: readonly ThreatWord[] = [
    "big threat",
    "competitive",
    "watch",
    "quiet",
  ];

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="rounded p-1 text-ghost transition-colors hover:text-muted"
      >
        <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-7 z-10 w-[200px] rounded-[9px] border border-edge bg-surface py-1.5 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              actions.setCompetitorClassification(
                competitor.id,
                competitor.classification === "DIRECT" ? "ADJACENT" : "DIRECT",
              );
              setOpen(false);
            }}
            className="block w-full px-3.5 py-1.5 text-left text-[13px] text-body hover:bg-inset"
          >
            {competitor.classification === "DIRECT"
              ? "Mark as adjacent"
              : "Mark as direct"}
          </button>
          <div className="mt-1.5 border-t border-edge-hairline px-3.5 pb-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-label">
            Set threat
          </div>
          {threatWords.map((word) => (
            <button
              key={word}
              type="button"
              role="menuitemradio"
              aria-checked={competitor.threat === word}
              onClick={() => {
                actions.setCompetitorThreat(competitor.id, word);
                setOpen(false);
              }}
              className={[
                "block w-full px-3.5 py-1.5 text-left font-mono text-xs hover:bg-inset",
                competitor.threat === word ? "text-ink" : "text-body",
              ].join(" ")}
            >
              {word}
              {competitor.threat === word ? " ✓" : ""}
            </button>
          ))}
          <div className="mt-1.5 border-t border-edge-hairline pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onStopTracking();
              }}
              className="block w-full px-3.5 py-1.5 text-left text-[13px] text-red-700 hover:bg-inset dark:text-red-400"
            >
              Stop tracking
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StopTrackingDialogue({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Stop tracking ${name}?`}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 px-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[400px] rounded-[12px] border border-edge bg-surface p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-2 text-[16px] font-semibold text-ink">
          Stop tracking {name}?
        </h2>
        <p className="mb-5 text-[13.5px] leading-[1.6] text-body">
          The profile, its sources and its filed deep dives will be deleted.
          This cannot be undone.
        </p>
        <div className="flex justify-end gap-[9px]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-[7px] bg-red-600 px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Stop tracking
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Object pattern: a linkable detail view owned by no tab (spec part 3). */
function CompetitorView({ competitor }: { competitor: CompetitorObject }) {
  const state = useAppState();
  const actions = useAppActions();
  const [, navigate] = useLocation();
  const productHref = useProductHref();
  const [confirmingStop, setConfirmingStop] = useState(false);

  const row = state.competitorsOverview?.rows.find(
    (candidate) => candidate.id === competitor.id,
  );
  const checkingEntry = (state.competitorsOverview?.checking ?? []).find(
    (entry) => entry.id === competitor.id,
  );

  // "Unseen" means unseen: the NEW tag clears once the Object has been
  // opened — on leaving, so the finding stays highlighted during this visit.
  const markSeenRef = useRef(actions.markCompetitorSeen);
  markSeenRef.current = actions.markCompetitorSeen;
  useEffect(() => {
    const id = competitor.id;
    return () => markSeenRef.current(id);
  }, [competitor.id]);

  // Live mode fetches the detail projection on demand; mock is a no-op.
  const ensureDetailRef = useRef(actions.ensureCompetitorDetail);
  ensureDetailRef.current = actions.ensureCompetitorDetail;
  useEffect(() => {
    ensureDetailRef.current(competitor.id);
  }, [competitor.id]);

  const metaSegments: string[] = [competitor.domain, competitor.threat].filter(
    Boolean,
  );
  if (competitor.sentiment !== undefined) {
    metaSegments.push(`sentiment ${competitor.sentiment}`);
  }
  if (competitor.reviewCount !== undefined) {
    metaSegments.push(countNoun(competitor.reviewCount, "review"));
  }

  return (
    <div className="flex justify-center px-8 py-[38px]">
      <div className="w-full max-w-[720px]">
        <div className="mb-1.5 flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
            {competitor.name}
          </h1>
          <span className="rounded bg-teal-tint px-1.5 py-1 font-mono text-[10px] font-semibold text-teal-dark">
            {competitor.classification}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Explore this
            </button>
            <OverflowMenu
              competitor={competitor}
              onStopTracking={() => setConfirmingStop(true)}
            />
          </span>
        </div>
        <div className="mb-[26px] flex items-baseline gap-1 font-mono text-xs tabular-nums text-faint">
          <span>{metaSegments.join(" · ")} ·</span>
          <VerifiedStamp
            verifiedAgo={competitor.verifiedAgo}
            stale={competitor.stale}
            unverified={row?.unverified}
            unverifiedLabel={row?.unverifiedLabel}
            lastRunFailed={competitor.lastRunFailed}
            checkingElapsedS={checkingEntry?.elapsedS}
            agentsPaused={state.agentsPaused}
            onCheck={() => actions.checkCompetitor(competitor.id)}
            onRetry={() => actions.checkCompetitor(competitor.id)}
          />
        </div>

        <div
          className={
            state.justVerifiedId === competitor.id ? "tint-fade" : undefined
          }
        >
          <p className="mb-3 text-[15px] leading-[1.65] text-ink [text-wrap:pretty]">
            {competitor.changeUnseen ? <NewTag /> : null}
            {competitor.summary}
          </p>
          <div className="mb-6">
            <EvidenceRow evidence={competitor.changeEvidence} />
          </div>
        </div>

        {competitor.theyBeatYouOn.length > 0 ||
        competitor.youBeatThemOn.length > 0 ? (
          <div className="mb-8 flex gap-[34px] border-b border-edge-hairline pb-[26px]">
            <CapabilityColumn
              heading="They beat you on"
              items={competitor.theyBeatYouOn}
            />
            <CapabilityColumn
              heading="You beat them on"
              items={competitor.youBeatThemOn}
            />
          </div>
        ) : null}

        {competitor.differentiators && competitor.differentiators.length > 0 ? (
          <DifferentiatorsSection items={competitor.differentiators} />
        ) : null}

        {competitor.changes && competitor.changes.length > 0 ? (
          <RecentChangesSection changes={competitor.changes} />
        ) : null}

        {competitor.openThread ? (
          <OpenThread thread={competitor.openThread} />
        ) : null}

        {competitor.featureCoverage ? (
          <CoverageSection coverage={competitor.featureCoverage} />
        ) : null}

        {competitor.keyFeatureList && competitor.keyFeatureList.length > 0 ? (
          <KeyFeaturesSection items={competitor.keyFeatureList} />
        ) : null}

        {competitor.marketList && competitor.marketList.length > 0 ? (
          <MarketsSection items={competitor.marketList} />
        ) : null}

        {competitor.reviewEvidence ? (
          <BuyersSection review={competitor.reviewEvidence} />
        ) : null}

        {competitor.sources && competitor.sources.length > 0 ? (
          <SourcesSection sources={competitor.sources} />
        ) : null}

        {competitor.filedThreads.length > 0 ? (
          <p className="mt-[30px] text-[12.5px] leading-[1.7] text-faint">
            Filed here already:{" "}
            {competitor.filedThreads.map((thread, index) => (
              <span key={thread.id}>
                {index > 0 ? " · " : ""}
                <span className="text-body">{thread.title}</span> ·{" "}
                {thread.filedOn}
              </span>
            ))}
          </p>
        ) : null}

        {confirmingStop ? (
          <StopTrackingDialogue
            name={competitor.name}
            onConfirm={() => {
              setConfirmingStop(false);
              actions.stopTracking(competitor.id);
              navigate(productHref("/competitors"));
            }}
            onCancel={() => setConfirmingStop(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

export function CompetitorObjectPage() {
  const params = useParams<{ id: string }>();
  const { competitors } = useAppState();
  const slug = params.id ?? "";
  const competitor = Object.values(competitors).find(
    (candidate) => competitorSlug(candidate.id) === slug,
  );
  if (!competitor) {
    return (
      <EmptyState line="That competitor isn’t tracked here. Choose one from the Competitors overview." />
    );
  }
  return <CompetitorView competitor={competitor} />;
}
