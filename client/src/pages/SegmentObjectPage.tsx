import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { NewTag } from "@/components/competitors/chips";
import { VerifiedStamp } from "@/components/competitors/VerifiedStamp";
import {
  AddedByYouChip,
  EvidenceBasisLine,
} from "@/components/customers/EvidenceBasisLine";
import {
  FilingResultLine,
  LogFeedbackFlow,
} from "@/components/customers/LogFeedbackFlow";
import { Verbatim } from "@/components/customers/ProvenanceLine";
import { SegmentTypeBadge } from "@/components/customers/SegmentRowCard";
import { ConfirmDialogue } from "@/components/ConfirmDialogue";
import { EmptyState } from "@/components/EmptyState";
import { EvidenceRow } from "@/components/EvidenceChip";
import { useProductHref } from "@/lib/productUrl";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import type { FitWord, PersonaBlock, SegmentObject } from "@/mock/types";

/** Segment Object — the two-level register on one page (spec part 3). */

function SectionKicker({
  children,
  shared,
}: {
  children: string;
  /** Multi-product only: "· shared across your products" suffix (3.2). */
  shared?: boolean | undefined;
}) {
  return (
    <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
      {children}
      {shared ? (
        <span className="text-ghost"> · shared across your products</span>
      ) : null}
    </div>
  );
}

function PersonaCard({
  persona,
  onAddEvidence,
}: {
  persona: PersonaBlock;
  onAddEvidence: () => void;
}) {
  return (
    <div>
      <div className="text-[14.5px] font-medium text-ink">{persona.title}</div>
      <p className="mt-0.5 text-[13px] leading-[1.6] text-faint">
        {persona.identityLine}
      </p>
      {persona.goals ? (
        <p className="mt-1.5 text-[13.5px] leading-[1.65] text-body">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
            Goals:
          </span>{" "}
          {persona.goals}
        </p>
      ) : null}
      {persona.pains ? (
        <p className="mt-1 text-[13.5px] leading-[1.65] text-body">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
            Pains:
          </span>{" "}
          {persona.pains}
        </p>
      ) : null}
      <EvidenceBasisLine basis={persona.basis} onAddEvidence={onAddEvidence} />
    </div>
  );
}

const FIT_WORDS: readonly FitWord[] = [
  "strong fit",
  "moderate fit",
  "weak fit",
];

function SegmentOverflowMenu({
  segment,
  onRemove,
}: {
  segment: SegmentObject;
  onRemove: () => void;
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

  const sharedElsewhere =
    segment.alsoServedBy !== undefined && segment.alsoServedBy.length > 0;

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
          className="absolute right-0 top-7 z-10 w-[230px] rounded-[9px] border border-edge bg-surface py-1.5 shadow-lg"
        >
          <div className="px-3.5 pb-1 pt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-label">
            Set fit
          </div>
          {FIT_WORDS.map((word) => (
            <button
              key={word}
              type="button"
              role="menuitemradio"
              aria-checked={segment.fit === word}
              onClick={() => {
                actions.setSegmentFit(segment.id, word);
                setOpen(false);
              }}
              className={[
                "block w-full px-3.5 py-1.5 text-left font-mono text-xs hover:bg-inset",
                segment.fit === word ? "text-ink" : "text-body",
              ].join(" ")}
            >
              {word}
              {segment.fit === word ? " ✓" : ""}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={segment.fit === undefined}
            onClick={() => {
              actions.setSegmentFit(segment.id, null);
              setOpen(false);
            }}
            className={[
              "block w-full px-3.5 py-1.5 text-left font-mono text-xs hover:bg-inset",
              segment.fit === undefined ? "text-ink" : "text-body",
            ].join(" ")}
          >
            unrated
            {segment.fit === undefined ? " ✓" : ""}
          </button>
          <div className="mt-1.5 border-t border-edge-hairline px-3.5 pb-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-label">
            Change type
          </div>
          {(
            [
              { value: null, label: "segment" },
              { value: "vertical", label: "industry vertical" },
              { value: "partnership", label: "partnership" },
            ] as const
          ).map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitemradio"
              aria-checked={(segment.type ?? null) === option.value}
              onClick={() => {
                actions.setSegmentType(segment.id, option.value);
                setOpen(false);
              }}
              className={[
                "block w-full px-3.5 py-1.5 text-left font-mono text-xs hover:bg-inset",
                (segment.type ?? null) === option.value
                  ? "text-ink"
                  : "text-body",
              ].join(" ")}
            >
              {option.label}
              {(segment.type ?? null) === option.value ? " ✓" : ""}
            </button>
          ))}
          <div className="mt-1.5 border-t border-edge-hairline pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
              className="block w-full px-3.5 py-1.5 text-left text-[13px] text-red-700 hover:bg-inset dark:text-red-400"
            >
              {sharedElsewhere ? "Remove from this product" : "Delete segment"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SegmentView({ segment }: { segment: SegmentObject }) {
  const state = useAppState();
  const actions = useAppActions();
  const productHref = useProductHref();
  const [, navigate] = useLocation();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const shared = segment.sharedAcrossProducts === true;
  const sharedElsewhere =
    segment.alsoServedBy !== undefined && segment.alsoServedBy.length > 0;

  const markSeenRef = useRef(actions.markSegmentSeen);
  markSeenRef.current = actions.markSegmentSeen;
  useEffect(() => {
    const id = segment.id;
    return () => markSeenRef.current(id);
  }, [segment.id]);

  // A filing result fades after the next navigation (spec 2.3).
  const clearResultRef = useRef(actions.clearFeedbackResult);
  clearResultRef.current = actions.clearFeedbackResult;
  useEffect(() => () => clearResultRef.current(), []);

  const checkingEntry = state.customersChecking.find(
    (entry) => entry.id === segment.id,
  );

  const metaSegments: string[] = [];
  if (segment.fit) {
    metaSegments.push(segment.fit);
  }
  if (segment.feedbackCount !== undefined) {
    metaSegments.push(
      `${segment.feedbackCount} feedback item${segment.feedbackCount === 1 ? "" : "s"}`,
    );
  }
  if (segment.sentiment !== undefined) {
    metaSegments.push(`sentiment ${segment.sentiment}`);
  }

  const openFeedbackForSegment = () =>
    actions.openFeedbackFlow({ segmentId: segment.id });

  const removalBody = sharedElsewhere
    ? `Its jobs-to-be-done, needs and feedback links for this product will be deleted. ${segment.alsoServedBy?.map((product) => product.name).join(" and ") ?? ""} keeps its own view of this segment.`
    : "The profile, its personas and its feedback links will be deleted. This cannot be undone.";

  return (
    <div className="flex justify-center px-8 py-[38px]">
      <div className="w-full max-w-[720px]">
        <div className="mb-1.5 flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
            {segment.name}
          </h1>
          <SegmentTypeBadge type={segment.type} />
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Explore this
            </button>
            <SegmentOverflowMenu
              segment={segment}
              onRemove={() => setConfirmingRemove(true)}
            />
          </span>
        </div>
        <div className="mb-[26px] flex flex-wrap items-baseline gap-x-1 gap-y-1 font-mono text-xs tabular-nums text-faint">
          <span>
            {metaSegments.join(" · ")}
            {metaSegments.length > 0 ? " ·" : ""}
          </span>
          <VerifiedStamp
            verifiedAgo={segment.verifiedAgo}
            stale={segment.stale}
            checkingElapsedS={checkingEntry?.elapsedS}
            agentsPaused={state.agentsPaused}
            onCheck={() => actions.checkSegment(segment.id)}
          />
          {sharedElsewhere ? (
            <span>
              · also served by{" "}
              {segment.alsoServedBy?.map((product, index) => (
                <span key={product.id}>
                  {index > 0 ? ", " : ""}
                  <span className="text-teal-deep">{product.name}</span>
                </span>
              ))}
            </span>
          ) : null}
        </div>

        {segment.enrichNotice ? (
          <p className="mb-5 text-[13px] leading-[1.6] text-amber-600 dark:text-amber-400">
            {segment.enrichNotice}{" "}
            <button
              type="button"
              onClick={openFeedbackForSegment}
              className="font-medium text-teal-deep hover:underline"
            >
              Log feedback
            </button>
          </p>
        ) : null}

        {segment.summary ? (
          <div
            className={
              state.justVerifiedId === segment.id ? "tint-fade" : undefined
            }
          >
            <p className="mb-3 text-[15px] leading-[1.65] text-ink [text-wrap:pretty]">
              {segment.changeUnseen ? <NewTag /> : null}
              {segment.summary}
            </p>
            {segment.changeEvidence && segment.changeEvidence.length > 0 ? (
              <div className="mb-6">
                <EvidenceRow evidence={segment.changeEvidence} />
              </div>
            ) : null}
          </div>
        ) : null}

        <section className="border-t border-edge-hairline pt-[26px]">
          <SectionKicker>What they hire you for</SectionKicker>
          {segment.jobsToBeDone ? (
            <>
              <div className="text-[13.5px] leading-[1.75] text-body">
                {segment.jobsToBeDone.items.map((job) => (
                  <div key={job}>{job}</div>
                ))}
              </div>
              <EvidenceBasisLine
                basis={segment.jobsToBeDone.basis}
                onAddEvidence={openFeedbackForSegment}
              />
            </>
          ) : (
            <p className="text-[13.5px] leading-[1.65] text-body">
              What do they hire this product for? Log some feedback or tell me
              yourself, and I’ll draft it from what’s real.{" "}
              <button
                type="button"
                onClick={openFeedbackForSegment}
                className="font-medium text-teal-deep hover:underline"
              >
                Log feedback
              </button>{" "}
              <button
                type="button"
                className="font-medium text-teal-deep hover:underline"
              >
                Write it myself
              </button>
            </p>
          )}
        </section>

        {segment.needs ? (
          <section className="mt-8 border-t border-edge-hairline pt-[26px]">
            <SectionKicker>Needs and pains</SectionKicker>
            <div className="flex flex-col gap-1.5">
              {segment.needs.items.map((need) => (
                <div key={need.id} className="flex items-baseline gap-3">
                  <span className="flex-1 text-[13.5px] leading-[1.65] text-body">
                    {need.text}
                  </span>
                  {need.satisfied ? (
                    <span className="whitespace-nowrap font-mono text-xs tabular-nums text-faint">
                      {need.satisfied}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <EvidenceBasisLine
              basis={segment.needs.basis}
              onAddEvidence={openFeedbackForSegment}
            />
          </section>
        ) : null}

        {segment.personas.length > 0 ? (
          <section className="mt-8 border-t border-edge-hairline pt-[26px]">
            <SectionKicker shared={shared}>Who you’ll meet</SectionKicker>
            <div className="flex flex-col gap-5">
              {segment.personas.map((persona) => (
                <PersonaCard
                  key={persona.id}
                  persona={persona}
                  onAddEvidence={openFeedbackForSegment}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-8 border-t border-edge-hairline pt-[26px]">
          <SectionKicker>What they’re telling you</SectionKicker>
          {segment.recentItems.length > 0 ? (
            <>
              <div className="flex flex-col gap-3.5">
                {segment.recentItems.map((item) => (
                  <Verbatim key={item.id} item={item} showThemeChip />
                ))}
              </div>
              {segment.feedbackCount !== undefined &&
              segment.feedbackCount > segment.recentItems.length ? (
                <button
                  type="button"
                  className="mt-4 text-[12.5px] font-medium text-teal-deep hover:underline"
                >
                  All{" "}
                  <span className="font-mono tabular-nums">
                    {segment.feedbackCount}
                  </span>{" "}
                  items →
                </button>
              ) : null}
            </>
          ) : (
            <p className="text-[13.5px] leading-[1.65] text-body">
              No feedback from this segment yet — log something they’ve said,
              or connect a source.{" "}
              <button
                type="button"
                onClick={openFeedbackForSegment}
                className="font-medium text-teal-deep hover:underline"
              >
                Log feedback
              </button>{" "}
              <button
                type="button"
                className="font-medium text-teal-deep hover:underline"
              >
                Set up a source
              </button>
            </p>
          )}
          {state.feedbackFlow.result ? (
            <FilingResultLine result={state.feedbackFlow.result} />
          ) : null}
          {state.feedbackFlow.open &&
          state.feedbackFlow.presetSegmentId === segment.id ? (
            <div className="mt-5 border-t border-edge-hairline pt-5">
              <LogFeedbackFlow variant="inline" />
            </div>
          ) : null}
        </section>

        {segment.satisfaction ? (
          <section className="mt-8 border-t border-edge-hairline pt-[26px]">
            <SectionKicker>Satisfaction</SectionKicker>
            <p className="font-mono text-xs tabular-nums text-body">
              {[
                segment.satisfaction.csat !== undefined
                  ? `CSAT ${segment.satisfaction.csat}`
                  : null,
                segment.satisfaction.nps !== undefined
                  ? `NPS ${segment.satisfaction.nps >= 0 ? "+" : ""}${segment.satisfaction.nps}`
                  : null,
                segment.satisfaction.responses !== undefined
                  ? `from ${segment.satisfaction.responses} responses`
                  : null,
                segment.satisfaction.period ?? null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {segment.satisfaction.sourceUrl ? (
                <a
                  href={segment.satisfaction.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-faint hover:text-teal-deep hover:underline"
                >
                  source
                </a>
              ) : null}
            </p>
          </section>
        ) : null}

        {segment.sources && segment.sources.length > 0 ? (
          <section className="mt-8 border-t border-edge-hairline pt-[26px]">
            <SectionKicker>Sources</SectionKicker>
            <div className="flex flex-col">
              {segment.sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-baseline gap-3 py-[7px]"
                >
                  <span className="font-mono text-xs text-body">
                    {source.name}
                  </span>
                  <span className="flex items-baseline gap-1.5 font-mono text-xs text-faint">
                    {source.feeds}
                    {source.name === "Your interview" ||
                    source.name === "Added by you" ? (
                      <AddedByYouChip />
                    ) : null}
                  </span>
                  <span className="ml-auto font-mono text-xs tabular-nums text-faint">
                    {source.stamp}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Add a source
            </button>
          </section>
        ) : null}

        {segment.filedThreads.length > 0 ? (
          <p className="mt-[30px] text-[12.5px] leading-[1.7] text-faint">
            Filed here already:{" "}
            {segment.filedThreads.map((thread, index) => (
              <span key={thread.id}>
                {index > 0 ? " · " : ""}
                <span className="text-body">{thread.title}</span> ·{" "}
                {thread.filedOn}
              </span>
            ))}
          </p>
        ) : null}

        {confirmingRemove ? (
          <ConfirmDialogue
            title={
              sharedElsewhere
                ? `Remove ${segment.name} from this product?`
                : `Delete ${segment.name}?`
            }
            body={removalBody}
            confirmLabel={sharedElsewhere ? "Remove" : "Delete segment"}
            onConfirm={() => {
              setConfirmingRemove(false);
              actions.removeSegment(segment.id);
              navigate(productHref("/customers"));
            }}
            onCancel={() => setConfirmingRemove(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

export function SegmentObjectPage() {
  const params = useParams<{ id: string }>();
  const { segments } = useAppState();
  const slug = params.id ?? "";
  const segment = Object.values(segments).find(
    (candidate) => (candidate.id.split(":").pop() ?? candidate.id) === slug,
  );
  if (!segment) {
    return (
      <EmptyState line="That segment isn’t part of this product’s context. Head back to Customers." />
    );
  }
  return <SegmentView segment={segment} />;
}
