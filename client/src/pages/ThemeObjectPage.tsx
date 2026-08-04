import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { NewTag } from "@/components/competitors/chips";
import { VerifiedStamp } from "@/components/competitors/VerifiedStamp";
import {
  FilingResultLine,
  LogFeedbackFlow,
} from "@/components/customers/LogFeedbackFlow";
import { Verbatim } from "@/components/customers/ProvenanceLine";
import { ConfirmDialogue } from "@/components/ConfirmDialogue";
import { EmptyState } from "@/components/EmptyState";
import { EvidenceRow } from "@/components/EvidenceChip";
import { useProductHref } from "@/lib/productUrl";
import { segmentPath } from "@/components/customers/SegmentRowCard";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import type { ThemeObject } from "@/mock/types";

/** A theme is an agent-made claim about a pattern — its page leads with the
 * pattern's raw material (customers spec part 4). */

function SectionKicker({ children }: { children: string }) {
  return (
    <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
      {children}
    </div>
  );
}

function ThemeOverflowMenu({
  theme,
  otherThemes,
  onMergeInto,
  onRetire,
}: {
  theme: ThemeObject;
  otherThemes: readonly { id: string; name: string }[];
  onMergeInto: (absorbedId: string) => void;
  onRetire: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [merging, setMerging] = useState(false);
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
        setMerging(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

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
          {!merging ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setMerging(true)}
                className="block w-full px-3.5 py-1.5 text-left text-[13px] text-body hover:bg-inset"
              >
                Merge into…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onRetire();
                }}
                className="block w-full px-3.5 py-1.5 text-left text-[13px] text-red-700 hover:bg-inset dark:text-red-400"
              >
                Retire this theme
              </button>
            </>
          ) : (
            <>
              <div className="px-3.5 pb-1 pt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-label">
                Merge {theme.name} into
              </div>
              {otherThemes.map((other) => (
                <button
                  key={other.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setMerging(false);
                    onMergeInto(other.id);
                  }}
                  className="block w-full px-3.5 py-1.5 text-left text-[13px] text-body hover:bg-inset"
                >
                  {other.name}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ThemeView({ theme }: { theme: ThemeObject }) {
  const state = useAppState();
  const actions = useAppActions();
  const productHref = useProductHref();
  const [showAll, setShowAll] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(theme.name);
  const [confirming, setConfirming] = useState<
    { kind: "retire" } | { kind: "merge"; intoId: string; intoName: string } | null
  >(null);

  // "Unseen" clears once the Object has been opened — on leaving.
  const markSeenRef = useRef(actions.markThemeSeen);
  markSeenRef.current = actions.markThemeSeen;
  useEffect(() => {
    const id = theme.id;
    return () => markSeenRef.current(id);
  }, [theme.id]);

  // A filing result fades after the next navigation (spec 2.3).
  const clearResultRef = useRef(actions.clearFeedbackResult);
  clearResultRef.current = actions.clearFeedbackResult;
  useEffect(() => () => clearResultRef.current(), []);

  const checkingEntry = state.customersChecking.find(
    (entry) => entry.id === theme.id,
  );
  const overviewThemes = state.customersOverview?.themes ?? [];
  const otherThemes = overviewThemes
    .filter((row) => row.id !== theme.id)
    .map((row) => ({ id: row.id, name: row.name }));

  const metaSegments: string[] = [
    `${theme.mentionCount} mention${theme.mentionCount === 1 ? "" : "s"}`,
  ];
  if (theme.sentimentMixed) {
    metaSegments.push("sentiment mixed");
  } else if (theme.sentiment !== undefined) {
    metaSegments.push(`sentiment ${theme.sentiment}`);
  }
  if (theme.trend) {
    metaSegments.push(theme.trend);
  }
  metaSegments.push(theme.lifecycle);
  if (theme.firstHeard) {
    metaSegments.push(`first heard ${theme.firstHeard}`);
  }

  const visibleItems = showAll ? theme.items : theme.items.slice(0, 5);

  const commitRename = () => {
    setEditingName(false);
    if (nameDraft.trim() && nameDraft.trim() !== theme.name) {
      actions.renameTheme(theme.id, nameDraft);
    } else {
      setNameDraft(theme.name);
    }
  };

  return (
    <div className="flex justify-center px-8 py-[38px]">
      <div className="w-full max-w-[720px]">
        <div className="mb-1.5 flex items-baseline gap-3">
          {editingName ? (
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setNameDraft(theme.name);
                  setEditingName(false);
                }
              }}
              aria-label="Theme name"
              className="min-w-0 flex-1 border-b border-edge-input bg-transparent text-[22px] font-semibold tracking-[-0.02em] text-ink outline-none focus:border-teal"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setNameDraft(theme.name);
                setEditingName(true);
              }}
              title="Rename this theme"
              className="text-left text-[22px] font-semibold tracking-[-0.02em] text-ink hover:underline"
            >
              {theme.name}
            </button>
          )}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Explore this
            </button>
            <ThemeOverflowMenu
              theme={theme}
              otherThemes={otherThemes}
              onMergeInto={(intoId) => {
                const into = otherThemes.find((other) => other.id === intoId);
                if (into) {
                  setConfirming({ kind: "merge", intoId, intoName: into.name });
                }
              }}
              onRetire={() => setConfirming({ kind: "retire" })}
            />
          </span>
        </div>
        <div className="mb-[26px] flex items-baseline gap-1 font-mono text-xs tabular-nums text-faint">
          <span>{metaSegments.join(" · ")} ·</span>
          <VerifiedStamp
            verifiedAgo={theme.refreshedAgo}
            stale={theme.stale}
            checkingElapsedS={checkingEntry?.elapsedS}
            agentsPaused={state.agentsPaused}
            onCheck={() => actions.refreshTheme(theme.id)}
            verb="refreshed"
            checkingLabel="refreshing"
          />
        </div>

        <div
          className={
            state.justVerifiedId === theme.id ? "tint-fade" : undefined
          }
        >
          {theme.renamedFrom ? (
            <p className="mb-2 text-[12.5px] text-faint">
              Renamed from {theme.renamedFrom}.
            </p>
          ) : null}
          <p className="mb-3 text-[15px] leading-[1.65] text-ink [text-wrap:pretty]">
            {theme.changeUnseen ? <NewTag /> : null}
            {theme.summary}
          </p>
          <div className="mb-6">
            <EvidenceRow evidence={theme.changeEvidence} />
          </div>
        </div>

        <section className="border-t border-edge-hairline pt-[26px]">
          <SectionKicker>What people said</SectionKicker>
          <div className="flex flex-col gap-3.5">
            {visibleItems.map((item) => (
              <Verbatim key={item.id} item={item} showSegmentChip />
            ))}
          </div>
          {!showAll && theme.items.length > 5 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-4 text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              All{" "}
              <span className="font-mono tabular-nums">
                {theme.mentionCount}
              </span>{" "}
              mentions →
            </button>
          ) : null}
        </section>

        {theme.segmentBreakdown && theme.segmentBreakdown.length > 0 ? (
          <section className="mt-8 border-t border-edge-hairline pt-[26px]">
            <SectionKicker>Who it comes from</SectionKicker>
            <div className="flex flex-col gap-1.5">
              {theme.segmentBreakdown.map((row) => (
                <Link
                  key={row.segmentId}
                  href={productHref(segmentPath(row.segmentId))}
                  className="font-mono text-xs tabular-nums text-body hover:text-teal-deep hover:underline"
                >
                  {row.name} · {row.mentions} mention
                  {row.mentions === 1 ? "" : "s"}
                  {row.sentiment !== undefined
                    ? ` · sentiment ${row.sentiment}`
                    : ""}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {theme.sources && theme.sources.length > 0 ? (
          <section className="mt-8 border-t border-edge-hairline pt-[26px]">
            <SectionKicker>Sources</SectionKicker>
            <div className="flex flex-col">
              {theme.sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-baseline gap-3 py-[7px]"
                >
                  <span className="font-mono text-xs text-body">
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
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {theme.filedThreads.length > 0 ? (
          <p className="mt-[30px] text-[12.5px] leading-[1.7] text-faint">
            Filed here already:{" "}
            {theme.filedThreads.map((thread, index) => (
              <span key={thread.id}>
                {index > 0 ? " · " : ""}
                <span className="text-body">{thread.title}</span> ·{" "}
                {thread.filedOn}
              </span>
            ))}
          </p>
        ) : null}

        <div className="mt-8 border-t border-edge-hairline pt-5">
          {state.feedbackFlow.result ? (
            <FilingResultLine result={state.feedbackFlow.result} />
          ) : null}
          {state.feedbackFlow.open &&
          state.feedbackFlow.presetThemeId === theme.id ? (
            <LogFeedbackFlow variant="inline" />
          ) : (
            <button
              type="button"
              onClick={() => actions.openFeedbackFlow({ themeId: theme.id })}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Log another mention
            </button>
          )}
        </div>

        {confirming?.kind === "retire" ? (
          <ConfirmDialogue
            title={`Retire ${theme.name}?`}
            body={`Its ${theme.mentionCount} mentions return to the unfiled pool, and the name is remembered so agents don’t recreate it.`}
            confirmLabel="Retire theme"
            onConfirm={() => {
              setConfirming(null);
              actions.retireTheme(theme.id);
              window.history.back();
            }}
            onCancel={() => setConfirming(null)}
          />
        ) : null}
        {confirming?.kind === "merge" ? (
          <ConfirmDialogue
            title={`Merge ${theme.name} into ${confirming.intoName}?`}
            body={`Its ${theme.mentionCount} mentions move across with their sources kept intact. The name is remembered so agents don’t rebuild it. This cannot be undone.`}
            confirmLabel="Merge themes"
            onConfirm={() => {
              const intoId = confirming.intoId;
              setConfirming(null);
              actions.mergeThemes(intoId, theme.id);
              window.history.back();
            }}
            onCancel={() => setConfirming(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

export function ThemeObjectPage() {
  const params = useParams<{ id: string }>();
  const { themes } = useAppState();
  const slug = params.id ?? "";
  const theme = Object.values(themes).find(
    (candidate) => (candidate.id.split(":").pop() ?? candidate.id) === slug,
  );
  if (!theme) {
    return (
      <EmptyState line="That theme isn’t here any more — its mentions may have merged into another. Head back to Customers." />
    );
  }
  return <ThemeView theme={theme} />;
}
