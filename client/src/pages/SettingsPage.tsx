import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "wouter";
import { ExternalLink } from "@/components/ExternalLink";
import {
  onSettingsAnchor,
  parseSettingsAnchor,
  type SettingsAnchor,
} from "@/lib/anchors";
import { useProductHref } from "@/lib/productUrl";
import { countNoun } from "@/lib/text";
import { formatElapsed } from "@/mock/competitors";
import {
  agentMeta,
  earliestNextRun,
  EDITABLE_FREQUENCIES,
  FREQUENCY_LABELS,
  hasAnyKey,
  hasSearchKey,
  PER_OBJECT_NOTE,
  PROVIDERS,
  providerName,
  type ProviderMeta,
} from "@/mock/settings";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import type {
  AgentScheduleRow,
  LicenceState,
  LlmKeyRow,
  ModuleId,
  ModuleState,
  SettingsState,
} from "@/mock/types";

/**
 * Settings — a Level-1 Overview (settings-spec part 1): one scannable page
 * of control blocks in fixed order, no tabs. Urgent conditions surface in
 * the lede and the footer; the page order never reshuffles.
 */

// Placeholder until the licensing sprint wires the merchant-of-record
// checkout (brief §2 / spec 6.1).
const BUY_URL = "https://discoveree.com/buy";
const LICENCE_TERMS_URL =
  "https://github.com/faithfourstar/discoveree-desktop/blob/main/LICENSE.md";

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** Inline mono figure in prose — the RichText "mono" treatment. */
function Fig({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[0.88em] tabular-nums">{children}</span>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-label">
      {children}
    </span>
  );
}

function WebSearchTag() {
  return (
    <span className="rounded-[4px] bg-chip px-[5px] py-[1.5px] font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-faint">
      Web search
    </span>
  );
}

function TealAction({
  onClick,
  children,
  size = "text-[12.5px]",
}: {
  onClick: () => void;
  children: ReactNode;
  size?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${size} font-medium text-teal-deep hover:underline`}
    >
      {children}
    </button>
  );
}

/**
 * The standard confirm dialogue — used only when removal changes what
 * Discoveree can do (spec 2.6).
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 px-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-[420px] rounded-[12px] border border-edge bg-surface p-6 shadow-lg">
        <h2 className="mb-2 text-[15.5px] font-semibold text-ink">{title}</h2>
        <p className="mb-5 text-[13.5px] leading-[1.6] text-body">{body}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[8px] border border-edge-btn px-3.5 py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-[8px] bg-red-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anchored blocks with the one-time highlight (spec §0.1)
// ---------------------------------------------------------------------------

interface AnchorFocus {
  anchor: SettingsAnchor;
  nonce: number;
}

function useAnchorFocus(): [AnchorFocus | null, (anchor: SettingsAnchor) => void] {
  const [focus, setFocus] = useState<AnchorFocus | null>(null);
  const nonceRef = useRef(0);

  const goTo = (anchor: SettingsAnchor) => {
    document
      .getElementById(anchor)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    nonceRef.current += 1;
    setFocus({ anchor, nonce: nonceRef.current });
  };
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // Layout effect: the listener must exist before the footer's post-commit
  // announcement fires (lib/anchors.ts).
  useLayoutEffect(() => {
    const initial = parseSettingsAnchor(window.location.hash);
    if (initial) {
      goToRef.current(initial);
    }
    return onSettingsAnchor((anchor) => goToRef.current(anchor));
  }, []);

  return [focus, goTo];
}

function Block({
  id,
  focus,
  children,
}: {
  id: SettingsAnchor;
  focus: AnchorFocus | null;
  children: ReactNode;
}) {
  const highlighted = focus?.anchor === id;
  return (
    <section
      id={id}
      // Keyed so a repeat arrival restarts the 600 ms tint fade.
      key={highlighted ? `${id}-${focus.nonce}` : id}
      className={[
        "mt-9 scroll-mt-4 border-t border-edge-hairline pt-8",
        highlighted ? "tint-fade" : "",
      ].join(" ")}
    >
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The lede (spec 1.2) — the machine's state, most useful truth first
// ---------------------------------------------------------------------------

function AmberClause({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-b-2 border-amberflag text-left text-amber-600 hover:opacity-80 dark:text-amber-400"
    >
      {children}
    </button>
  );
}

function SettingsLede({
  settings,
  goTo,
}: {
  settings: SettingsState;
  goTo: (anchor: SettingsAnchor) => void;
}) {
  const anyKey = hasAnyKey(settings.llmKeys);
  const pausedAll = settings.schedules.pausedAll;
  const licence = settings.licence;

  let clause: ReactNode;
  if (!anyKey) {
    clause = (
      <AmberClause onClick={() => goTo("llm-keys")}>
        Agents are paused until you add an LLM key.
      </AmberClause>
    );
  } else if (pausedAll) {
    clause = (
      <AmberClause onClick={() => goTo("agent-schedules")}>
        You’ve paused the agents — nothing is being checked, and stamps are
        ageing.
      </AmberClause>
    );
  } else if (licence.kind === "readingOnly") {
    clause = (
      <>
        Discoveree is reading-only just now — your context is safe and served,
        and edits resume with{" "}
        <button
          type="button"
          onClick={() => goTo("licence")}
          className="text-teal-deep hover:underline"
        >
          a licence
        </button>
        .
      </>
    );
  } else {
    const keyNames = settings.llmKeys
      .filter((row) => row.saved)
      .map((row) => providerName(row.provider));
    const next = earliestNextRun(settings.schedules.rows);
    clause = (
      <>
        Agents run on your{" "}
        {keyNames.map((name, index) => (
          <span key={name}>
            {index > 0 ? (index === keyNames.length - 1 ? " and " : ", ") : ""}
            <Fig>{name}</Fig>
          </span>
        ))}{" "}
        {keyNames.length === 1 ? "key" : "keys"}
        {next?.nextRun ? (
          <>
            {" "}
            — next run <Fig>{next.nextRun}</Fig> —
          </>
        ) : null}{" "}
        {licence.kind === "licensed" ? (
          <>
            and you’re licensed to <Fig>{licence.expires}</Fig>.
          </>
        ) : (
          <>
            and you’re on the free trial, <Fig>{licence.daysLeft}</Fig>{" "}
            {licence.daysLeft === 1 ? "day" : "days"} left.
          </>
        )}
      </>
    );
  }

  return (
    <p className="text-[21px] leading-[1.5] tracking-[-0.01em] text-ink [text-wrap:pretty]">
      Everything here stays on this machine. {clause}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Part 2 — LLM keys
// ---------------------------------------------------------------------------

/** Paste-first cleaning: trim whitespace, strip accidental quotes (2.3). */
function cleanKeyInput(raw: string): string {
  return raw.trim().replace(/^["']+|["']+$/g, "");
}

function KeyEntry({
  meta,
  onSave,
  onCancel,
}: {
  meta: ProviderMeta;
  onSave: (key: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  const key = cleanKeyInput(draft);
  return (
    <div className="mt-3 flex gap-2.5">
      <input
        type="password"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && key) {
            onSave(key);
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        placeholder={meta.placeholder}
        autoFocus
        className="h-[46px] flex-1 rounded-[9px] border border-edge-input bg-surface px-3.5 font-mono text-[13px] text-ink outline-none placeholder:text-ghost focus:border-teal"
        aria-label={`${meta.name} API key`}
      />
      <button
        type="button"
        disabled={!key}
        onClick={() => onSave(key)}
        className="h-[46px] rounded-[9px] bg-teal px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Save and test
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="h-[46px] px-2 text-[12.5px] font-medium text-faint hover:text-muted"
      >
        Cancel
      </button>
    </div>
  );
}

function ProviderRow({
  row,
  isLastKey,
  isLastSearchKey,
}: {
  row: LlmKeyRow;
  isLastKey: boolean;
  isLastSearchKey: boolean;
}) {
  const actions = useAppActions();
  const meta = PROVIDERS.find((provider) => provider.id === row.provider);
  const [entryOpen, setEntryOpen] = useState(false);
  const [confirm, setConfirm] = useState<"last-key" | "last-search" | null>(
    null,
  );
  const [removedPending, setRemovedPending] = useState(false);
  const undoTimerRef = useRef<number | null>(null);
  const commitRef = useRef<(() => void) | null>(null);

  // Commit a still-pending removal if the page unmounts inside the 5 s
  // undo window — undo must never silently become "kept".
  useEffect(
    () => () => {
      commitRef.current?.();
    },
    [],
  );

  if (!meta) {
    return null;
  }
  const name = meta.name;

  const commitRemoval = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    commitRef.current = null;
    actions.removeLlmKey(row.provider);
    setRemovedPending(false);
  };

  const startRemoval = () => {
    if (isLastKey) {
      setConfirm("last-key");
      return;
    }
    if (row.webSearch && isLastSearchKey) {
      setConfirm("last-search");
      return;
    }
    // Any other removal: no dialogue, inline 5 s undo (2.6).
    setRemovedPending(true);
    commitRef.current = () => {
      actions.removeLlmKey(row.provider);
    };
    undoTimerRef.current = window.setTimeout(commitRemoval, 5000);
  };

  const undoRemoval = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    commitRef.current = null;
    setRemovedPending(false);
  };

  const openReplace = () => {
    actions.clearKeyTestResult(row.provider);
    setEntryOpen(true);
  };

  // ── Key line trailing segment (2.4) ─────────────────────────────────────
  let trailing: ReactNode = null;
  if (row.testing) {
    trailing = (
      <span className="text-teal-deep">
        testing · {formatElapsed(row.testing.elapsedS)}
      </span>
    );
  } else if (row.testResult?.kind === "works") {
    trailing = (
      <span className="text-teal-deep">
        ✓ answered in <Fig>{row.testResult.answeredInS.toFixed(1)}</Fig> s
      </span>
    );
  } else if (row.testResult?.kind === "invalid") {
    trailing = (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span className="text-red-700 dark:text-red-400">
          {name} rejected this key.
        </span>
        <TealAction size="text-[12px]" onClick={openReplace}>
          Replace
        </TealAction>
        <button
          type="button"
          onClick={startRemoval}
          className="text-[12px] font-medium text-faint hover:text-muted"
        >
          Remove
        </button>
      </span>
    );
  } else if (row.testResult?.kind === "unreachable") {
    // Network/timeout ONLY — an unreachable provider passes NO verdict on
    // the key, and this copy never renders for a provider that answered.
    trailing = (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span className="text-red-700 dark:text-red-400">
          Couldn’t reach {name} — the key wasn’t checked.
        </span>
        <TealAction
          size="text-[12px]"
          onClick={() => actions.testLlmKey(row.provider)}
        >
          Try again
        </TealAction>
      </span>
    );
  } else if (row.testResult?.kind === "provider-error") {
    // The provider WAS reached and answered with an error — honest copy
    // says so; the sanitised detail renders as served, mono where it
    // quotes the provider.
    trailing = (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span className="text-red-700 dark:text-red-400">
          {row.testResult.detail ? (
            <>
              {name} answered with an error —{" "}
              <span className="font-mono">{row.testResult.detail}</span>
            </>
          ) : (
            (row.testResult.line ?? `${name} answered with an error.`)
          )}
        </span>
        <TealAction
          size="text-[12px]"
          onClick={() => actions.testLlmKey(row.provider)}
        >
          Try again
        </TealAction>
      </span>
    );
  } else if (row.testResult?.kind === "rate-limited") {
    trailing = (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span className="text-red-700 dark:text-red-400">
          {row.testResult.line ??
            `${name} rate-limited the check — the key may still be valid.`}
        </span>
        <TealAction
          size="text-[12px]"
          onClick={() => actions.testLlmKey(row.provider)}
        >
          Try again
        </TealAction>
      </span>
    );
  }

  const saved = row.saved;
  const showSaved = saved !== undefined && !removedPending;

  return (
    <div className="border-t border-edge-hairline py-4 first:border-t-0">
      <div className="flex items-baseline gap-2.5">
        <span
          className={
            showSaved
              ? "text-[15.5px] font-medium text-ink"
              : "text-[15.5px] text-body"
          }
        >
          {name}
        </span>
        {row.webSearch ? <WebSearchTag /> : null}
        <span className="ml-auto flex items-baseline gap-3">
          {showSaved && !entryOpen ? (
            <>
              <TealAction onClick={() => actions.testLlmKey(row.provider)}>
                Test
              </TealAction>
              <TealAction onClick={openReplace}>Replace</TealAction>
              <button
                type="button"
                onClick={startRemoval}
                className="text-[12.5px] font-medium text-faint hover:text-muted"
              >
                Remove
              </button>
            </>
          ) : !entryOpen && !removedPending ? (
            <>
              <TealAction onClick={() => setEntryOpen(true)}>
                Add a key
              </TealAction>
              <ExternalLink
                href={meta.keyPageUrl}
                className="text-[12.5px] font-medium text-ghost hover:text-faint"
              >
                Get key ↗
              </ExternalLink>
            </>
          ) : null}
        </span>
      </div>

      {showSaved && !entryOpen ? (
        <div className="mt-1 font-mono text-xs tabular-nums text-faint">
          {saved.mask}
          {trailing ? <> · {trailing}</> : saved.verified ? (
            <>
              {saved.addedAt ? <> · added {saved.addedAt}</> : null}
              {saved.lastUsedAgo ? <> · last used {saved.lastUsedAgo}</> : null}
            </>
          ) : (
            <> · saved · not yet verified</>
          )}
        </div>
      ) : null}

      {removedPending ? (
        <div className="mt-1 text-[12.5px] text-faint">
          Key removed ·{" "}
          <TealAction size="text-[12.5px]" onClick={undoRemoval}>
            Undo
          </TealAction>
        </div>
      ) : null}

      {entryOpen ? (
        <KeyEntry
          meta={meta}
          onSave={(key) => {
            setEntryOpen(false);
            actions.saveLlmKey(row.provider, key);
          }}
          onCancel={() => setEntryOpen(false)}
        />
      ) : null}

      {row.provider === "openrouter" && !showSaved && !removedPending ? (
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-faint">
          One OpenRouter key covers every job — models from all providers,
          including the ones that power web search.
        </p>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={
            confirm === "last-key"
              ? "Remove your last key?"
              : "Remove your last search key?"
          }
          body={
            confirm === "last-key"
              ? "Agents can’t run without an LLM key — your context will stop being kept current until you add another."
              : "Reviews and market news will pause — site crawling and changelog watching carry on."
          }
          confirmLabel="Remove key"
          onConfirm={() => {
            setConfirm(null);
            actions.removeLlmKey(row.provider);
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function LlmKeysBlock({ settings }: { settings: SettingsState }) {
  const rows = settings.llmKeys;
  const savedCount = rows.filter((row) => row.saved).length;
  const searchCount = rows.filter((row) => row.webSearch && row.saved).length;

  return (
    <>
      <div className="mb-3.5">
        <Kicker>LLM keys</Kicker>
      </div>
      <p className="mb-2 text-[15px] leading-[1.6] text-ink">
        One key from any provider is enough. The router picks the best
        available model for each job and falls back across providers
        automatically — more keys just mean more fallback.
      </p>
      <p className="mb-5 text-[12.5px] leading-[1.65] text-faint">
        Keys are encrypted and stored only on this machine, inside your local
        database. They are sent to exactly one place: the provider they belong
        to, when an agent makes a call. There is no Discoveree server for them
        to go to.
      </p>
      <div>
        {rows.map((row) => (
          <ProviderRow
            key={row.provider}
            row={row}
            isLastKey={savedCount === 1 && row.saved !== undefined}
            isLastSearchKey={searchCount === 1 && row.saved !== undefined}
          />
        ))}
      </div>
      {!hasSearchKey(rows) ? (
        <p className="mt-4 text-[13px] leading-[1.6] text-amber-600 dark:text-amber-400">
          Your agents can think but not search — reviews and market news are
          paused until you add an OpenAI, Google, Perplexity or OpenRouter key.
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Part 3 — Agent schedules
// ---------------------------------------------------------------------------

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_HOURS = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, "0")}:00`,
);

function QuietSelect({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className="cursor-pointer appearance-none rounded-[5px] border border-transparent bg-transparent font-mono text-xs text-faint outline-none hover:border-edge-hairline hover:text-muted focus:border-edge-input"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function AgentRow({
  row,
  pausedAll,
  capabilities,
}: {
  row: AgentScheduleRow;
  pausedAll: boolean;
  capabilities: SettingsState["capabilities"];
}) {
  const actions = useAppActions();
  const productHref = useProductHref();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pausedNote, setPausedNote] = useState(false);
  const menuRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onMouseDown = (event: Event) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuOpen]);

  const rowOff = row.frequency === "off";
  const paused = pausedAll || rowOff;
  const meta = agentMeta(row.id);
  const perObject = meta?.perObject ?? false;

  const handleRunNow = () => {
    if (paused) {
      setPausedNote(true);
      return;
    }
    actions.runAgentNow(row.id);
  };

  // ── Right-hand stamp (3.2/3.4) ──────────────────────────────────────────
  let stamp: ReactNode = null;
  if (row.running) {
    stamp = (
      <span className="whitespace-nowrap font-mono text-xs tabular-nums text-teal-deep">
        running · {formatElapsed(row.running.elapsedS)}
      </span>
    );
  } else if (paused) {
    stamp = (
      <span className="whitespace-nowrap font-mono text-xs text-faint">
        paused
      </span>
    );
  } else if (row.nextRun) {
    stamp = (
      <span className="whitespace-nowrap font-mono text-xs tabular-nums text-faint">
        next {row.nextRun}
      </span>
    );
  }

  const failed = row.lastRun?.failed;

  return (
    <div className="border-t border-edge-hairline py-4 first:border-t-0">
      <div className="flex items-baseline gap-3">
        <span className="text-[15.5px] font-medium text-ink">{row.name}</span>
        {capabilities.runNow && row.runNow ? (
          <button
            type="button"
            onClick={handleRunNow}
            className={
              paused
                ? "cursor-default text-[12.5px] font-medium text-ghost"
                : "text-[12.5px] font-medium text-teal-deep hover:underline"
            }
            aria-disabled={paused}
          >
            Run now
          </button>
        ) : capabilities.runNow && perObject ? (
          <span className="text-[12px] text-ghost">{PER_OBJECT_NOTE}</span>
        ) : null}
        <span className="ml-auto flex items-baseline gap-2.5">
          {row.frequency === "after-gathering" ? (
            <span className="font-mono text-xs text-faint">
              after gathering
            </span>
          ) : (
            <QuietSelect
              value={row.frequency}
              ariaLabel={`${row.name} frequency`}
              options={EDITABLE_FREQUENCIES.map((frequency) => ({
                value: frequency,
                label: FREQUENCY_LABELS[frequency],
              }))}
              onChange={(value) =>
                actions.setAgentFrequency(
                  row.id,
                  value as AgentScheduleRow["frequency"],
                )
              }
            />
          )}
          {row.weeklyAt &&
          row.frequency === "weekly" &&
          capabilities.editWeeklyAt ? (
            <>
              <QuietSelect
                value={row.weeklyAt.day}
                ariaLabel={`${row.name} day`}
                options={WEEK_DAYS.map((day) => ({ value: day, label: day }))}
                onChange={(day) =>
                  actions.setAgentWeeklyAt(row.id, {
                    day,
                    time: row.weeklyAt?.time ?? "21:00",
                  })
                }
              />
              <QuietSelect
                value={row.weeklyAt.time}
                ariaLabel={`${row.name} time`}
                options={DAY_HOURS.map((time) => ({
                  value: time,
                  label: time,
                }))}
                onChange={(time) =>
                  actions.setAgentWeeklyAt(row.id, {
                    day: row.weeklyAt?.day ?? "Sun",
                    time,
                  })
                }
              />
            </>
          ) : null}
          {stamp}
          {capabilities.perAgentPause &&
          row.frequency !== "after-gathering" ? (
            <span ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`${row.name} options`}
                className="px-1 text-[13px] leading-none text-ghost hover:text-faint"
              >
                …
              </button>
              {menuOpen ? (
                <span
                  role="menu"
                  className="absolute right-0 top-5 z-10 block w-[168px] rounded-[9px] border border-edge bg-surface py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      actions.setAgentPaused(row.id, !rowOff);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[12.5px] text-body hover:bg-inset"
                  >
                    {rowOff ? "Resume" : "Pause this agent"}
                  </button>
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>

      {pausedNote && paused ? (
        <p className="mt-1 text-[12px] text-faint">
          {pausedAll ? "Agents are paused." : "This agent is paused."}
        </p>
      ) : null}

      {failed ? (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-red-700 dark:text-red-400">
          <span>
            failed {row.lastRun?.at} · {failed.reason}
          </span>
          <button
            type="button"
            onClick={handleRunNow}
            className="font-sans text-[12px] font-medium text-teal-deep hover:underline"
          >
            Try again
          </button>
          <button
            type="button"
            className="font-sans text-[12px] font-medium text-teal-deep hover:underline"
          >
            View log
          </button>
        </div>
      ) : row.lastRun ? (
        <div className="mt-1 font-mono text-xs tabular-nums text-faint">
          last ran {row.lastRun.at}
          {row.lastRun.findings !== undefined ? (
            row.lastRun.findings > 0 ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={productHref("/")}
                  className="text-faint underline decoration-edge-input underline-offset-2 hover:text-teal-deep"
                >
                  {countNoun(row.lastRun.findings, "change")} found
                </Link>
              </>
            ) : (
              <> · nothing changed</>
            )
          ) : null}
        </div>
      ) : null}

      <p className="mt-1 text-[13px] leading-[1.6] text-faint">
        {row.description}
      </p>
    </div>
  );
}

function AgentSchedulesBlock({
  settings,
  modules,
}: {
  settings: SettingsState;
  modules: Record<ModuleId, ModuleState>;
}) {
  const actions = useAppActions();
  const { pausedAll } = settings.schedules;
  // Gating §0.2: rows render only for enabled modules — never greyed.
  const rows = settings.schedules.rows.filter(
    (row) => row.module === "always" || modules[row.module].enabled,
  );
  const onlyInventory =
    rows.length === 1 && rows[0]?.id === "product-inventory";

  return (
    <>
      <div className="mb-3.5 flex items-baseline">
        <Kicker>Agent schedules</Kicker>
        <span className="ml-auto">
          <TealAction onClick={() => actions.setAllAgentsPaused(!pausedAll)}>
            {pausedAll ? "Resume" : "Pause all"}
          </TealAction>
        </span>
      </div>
      <p className="mb-2 text-[15px] leading-[1.6] text-ink">
        Agents run on these rhythms while Discoveree is open, and anything
        overdue catches up when you launch.
      </p>
      {pausedAll ? (
        <p className="mb-2 text-[13px] leading-[1.6] text-amber-600 dark:text-amber-400">
          All agents are paused. Nothing is being checked, and freshness stamps
          keep counting — your context will drift stale until you resume.
        </p>
      ) : null}
      <div className="mt-3">
        {rows.map((row) => (
          <AgentRow
            key={row.id}
            row={row}
            pausedAll={pausedAll}
            capabilities={settings.capabilities}
          />
        ))}
      </div>
      {onlyInventory ? (
        <p className="mt-3 text-[13px] leading-[1.6] text-faint">
          More agents arrive with the jobs that need them — see{" "}
          <span className="text-teal-deep">Add capabilities</span> below.
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Part 4 — Connections (stub: a door with a live summary)
// ---------------------------------------------------------------------------

function ConnectionsBlock({ settings }: { settings: SettingsState }) {
  const productHref = useProductHref();
  const { serving, checking } = settings.connections;
  const connected = serving.length > 0 || checking.length > 0;

  const door = (
    <Link
      href={productHref("/connections")}
      className="whitespace-nowrap text-[12.5px] font-medium text-teal-deep hover:underline"
    >
      Open Connections →
    </Link>
  );

  return (
    <>
      <div className="mb-3.5 flex items-baseline">
        <Kicker>Connections</Kicker>
        <span className="ml-auto">{door}</span>
      </div>
      {connected ? (
        <>
          <p className="text-[15px] leading-[1.6] text-ink">
            {serving.length > 0 ? (
              <>
                Serving{" "}
                {serving.map((tool, index) => (
                  <span key={tool.name}>
                    {index > 0
                      ? index === serving.length - 1
                        ? " and "
                        : ", "
                      : ""}
                    <Link
                      href={productHref("/connections")}
                      className="text-teal-deep hover:underline"
                    >
                      {tool.name}
                    </Link>
                  </span>
                ))}
              </>
            ) : null}
            {checking.length > 0 ? (
              <>
                {serving.length > 0 ? "; checking " : "Checking "}
                {checking.map((tool, index) => (
                  <span key={tool.name}>
                    {index > 0 ? ", " : ""}
                    <Link
                      href={productHref("/connections")}
                      className="text-teal-deep hover:underline"
                    >
                      {tool.name}
                    </Link>{" "}
                    {tool.cadence}
                  </span>
                ))}
              </>
            ) : null}
            .
          </p>
          <p className="mt-1.5 font-mono text-xs tabular-nums text-faint">
            {[
              ...serving.map(
                (tool) => `${tool.name} · ${tool.queriesThisWeek} queries this week`,
              ),
              ...checking.map((tool) => `${tool.name} · polled ${tool.polledAgo}`),
            ].join(" · ")}
          </p>
        </>
      ) : (
        <p className="text-[15px] leading-[1.6] text-ink">
          Your AI tools and data tools connect here — most take under a minute.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Part 5 — Add capabilities (the one place unchosen modules exist)
// ---------------------------------------------------------------------------

/** Step-2 jobs, in step-2 wording exactly (onboarding spec A.2). */
const JOBS: readonly {
  module: ModuleId;
  title: string;
  consequence: string;
}[] = [
  {
    module: "competitors",
    title: "Track competitors",
    consequence:
      "Profiles kept current by agents, changelog watching, review mining, comparisons.",
  },
  {
    module: "customers",
    title: "Understand customers and feedback",
    consequence:
      "Segments and personas, feedback gathered into themes with sentiment.",
  },
  {
    module: "strategy",
    title: "Keep strategy sharp",
    consequence:
      "Vision, ambitions, pillars and goals as structured context — plus deep dives to explore growth options.",
  },
  {
    module: "roadmap",
    title: "Check we’re building the most valuable things",
    consequence:
      "A weekly review of your roadmap against strategy, feedback and competitor moves — with evidence-cited suggestions you approve.",
  },
  {
    module: "connections",
    title: "Feed context to my AI tools",
    consequence:
      "Serve everything Discoveree knows to Claude, Cursor, ChatGPT or your own agents over MCP.",
  },
];

function AddCapabilitiesBlock({
  modules,
}: {
  modules: Record<ModuleId, ModuleState>;
}) {
  const actions = useAppActions();
  const unchosen = JOBS.filter((job) => !modules[job.module].enabled);
  if (unchosen.length === 0) {
    return null;
  }
  return (
    <>
      <div className="mb-3.5">
        <Kicker>Add capabilities</Kicker>
      </div>
      <div>
        {unchosen.map((job) => (
          <div
            key={job.module}
            className="flex items-baseline gap-4 border-t border-edge-hairline py-4 first:border-t-0"
          >
            <div className="flex-1">
              <div className="text-[15.5px] font-medium text-ink">
                {job.title}
              </div>
              <p className="mt-0.5 text-[13px] leading-[1.6] text-faint">
                {job.consequence}
              </p>
            </div>
            <TealAction onClick={() => actions.enableModule(job.module)}>
              Switch on
            </TealAction>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Part 6 — Licence
// ---------------------------------------------------------------------------

function LicenceKeyEntry({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const actions = useAppActions();
  const [draft, setDraft] = useState("");
  const notice = state.settings?.licenceNotice;

  // A valid key collapses the field; the block re-renders licensed (6.4).
  useEffect(() => {
    if (notice?.kind === "valid") {
      onClose();
    }
  }, [notice, onClose]);

  // Cancelling drops any lingering error with the field — but never the
  // valid confirmation, which outlives the field by design.
  const cancel = () => {
    if (notice && notice.kind !== "valid") {
      actions.clearLicenceNotice();
    }
    onClose();
  };

  const key = draft.trim().toUpperCase();

  return (
    <div className="mt-3.5">
      <div className="flex gap-2.5">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter" && key) {
              actions.activateLicenceKey(key);
            }
            if (event.key === "Escape") {
              cancel();
            }
          }}
          placeholder="DSCV-XXXX-XXXX-XXXX-XXXX"
          autoFocus
          className="h-[46px] flex-1 rounded-[9px] border border-edge-input bg-surface px-3.5 font-mono text-[13px] tabular-nums text-ink outline-none placeholder:text-ghost focus:border-teal"
          aria-label="Licence key"
        />
        <button
          type="button"
          disabled={!key}
          onClick={() => actions.activateLicenceKey(key)}
          className="h-[46px] rounded-[9px] bg-teal px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Activate
        </button>
        <button
          type="button"
          onClick={cancel}
          className="h-[46px] px-2 text-[12.5px] font-medium text-faint hover:text-muted"
        >
          Cancel
        </button>
      </div>
      {notice && notice.kind !== "valid" ? (
        <p className="mt-2 text-[13px] leading-[1.6] text-red-700 dark:text-red-400">
          {notice.kind === "malformed" ? (
            <>
              That doesn’t look like a Discoveree key — keys look like{" "}
              <Fig>DSCV-XXXX-…</Fig> and arrive by email with your receipt.
            </>
          ) : notice.kind === "invalid" ? (
            <>
              This key didn’t validate — check for missing characters, or
              reply to your receipt email and we’ll put it right.
            </>
          ) : (
            <>
              This key expired on <Fig>{notice.expiredOn}</Fig> — renewing
              reactivates it.{" "}
              <ExternalLink
                href={BUY_URL}
                className="font-medium text-teal-deep hover:underline"
              >
                Renew ↗
              </ExternalLink>
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

function BuyButton({ label }: { label: string }) {
  return (
    <ExternalLink
      href={BUY_URL}
      className="inline-block rounded-[9px] bg-teal px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
    >
      {label}
    </ExternalLink>
  );
}

function LicenceBlock({ settings }: { settings: SettingsState }) {
  const licence: LicenceState = settings.licence;
  const notice = settings.licenceNotice;
  const [entryOpen, setEntryOpen] = useState(false);

  return (
    <>
      <div className="mb-3.5 flex items-baseline">
        <Kicker>Licence</Kicker>
        {licence.kind === "trial" ? (
          <span
            className={[
              "ml-auto font-mono text-xs tabular-nums",
              licence.daysLeft <= 3
                ? "text-amber-600 dark:text-amber-400"
                : "text-faint",
            ].join(" ")}
          >
            trial · {licence.daysLeft}{" "}
            {licence.daysLeft === 1 ? "day" : "days"} left
          </span>
        ) : null}
      </div>

      {licence.kind === "trial" ? (
        <>
          <p className="text-[15px] leading-[1.65] text-ink">
            You’re trying the full product — everything on, nothing held back,{" "}
            <Fig>{licence.daysLeft}</Fig>{" "}
            {licence.daysLeft === 1 ? "day" : "days"} to go. After that,
            Discoveree becomes a free reader of the context you’ve built:
            everything stays readable here and over MCP, but agents and edits
            wait for a licence.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <BuyButton label="Buy a licence ↗" />
            {!entryOpen ? (
              <TealAction onClick={() => setEntryOpen(true)}>
                I have a key
              </TealAction>
            ) : null}
          </div>
        </>
      ) : licence.kind === "licensed" ? (
        <>
          <p className="text-[15px] leading-[1.65] text-ink">
            Licensed to <Fig>{licence.email}</Fig> · expires{" "}
            <Fig>
              <span
                className={
                  licence.renewalDue
                    ? "text-amber-600 dark:text-amber-400"
                    : ""
                }
              >
                {licence.expires}
              </span>
            </Fig>
            .
            {licence.renewalDue ? (
              <>
                {" "}
                Renewing keeps agents running and updates coming —{" "}
                <ExternalLink
                  href={BUY_URL}
                  className="font-medium text-teal-deep hover:underline"
                >
                  Renew ↗
                </ExternalLink>
                .
              </>
            ) : null}
          </p>
          <div className="mt-2 flex items-baseline gap-3 font-mono text-xs tabular-nums text-faint">
            <span>
              {licence.keyMask}
              {licence.enteredOn ? <> · entered {licence.enteredOn}</> : null}
            </span>
            {!entryOpen ? (
              <TealAction onClick={() => setEntryOpen(true)}>
                Replace key
              </TealAction>
            ) : null}
          </div>
          <p className="mt-2 text-[12.5px] leading-[1.65] text-faint">
            Your key is checked on this machine — Discoveree doesn’t phone
            home.
          </p>
        </>
      ) : (
        <>
          <p className="text-[15px] leading-[1.65] text-ink">
            {licence.reason === "trial" ? (
              <>
                Your trial ended on <Fig>{licence.endedOn}</Fig>.
              </>
            ) : (
              <>
                Your licence expired on <Fig>{licence.endedOn}</Fig>.
              </>
            )}{" "}
            Nothing you made has been taken away — your context is safe on
            this machine, readable here and served over MCP. Agents and edits
            resume with a licence.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <BuyButton
              label={licence.reason === "trial" ? "Buy a licence ↗" : "Renew ↗"}
            />
            {!entryOpen ? (
              <TealAction onClick={() => setEntryOpen(true)}>
                I have a key
              </TealAction>
            ) : null}
          </div>
        </>
      )}

      {entryOpen ? (
        <LicenceKeyEntry onClose={() => setEntryOpen(false)} />
      ) : null}

      {notice?.kind === "valid" ? (
        <p className="mt-3 text-[13px] leading-[1.6] text-body">
          Licensed — thank you. Expires <Fig>{notice.expires}</Fig>.
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Part 7 — About & your data
// ---------------------------------------------------------------------------

function middleTruncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(value.length - half)}`;
}

function revealLabel(): string {
  const platform =
    typeof navigator === "undefined" ? "" : navigator.platform.toLowerCase();
  if (platform.includes("mac")) {
    return "Reveal in Finder";
  }
  if (platform.includes("win")) {
    return "Show in Explorer";
  }
  return "Show in Files";
}

function AboutRow({
  label,
  value,
  action,
}: {
  label: string;
  value: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-4 border-t border-edge-hairline py-3 first:border-t-0">
      <span className="w-[118px] flex-none text-[13px] text-faint">
        {label}
      </span>
      <span className="min-w-0 flex-1">{value}</span>
      {action ? <span className="flex-none">{action}</span> : null}
    </div>
  );
}

function AboutBlock({ settings }: { settings: SettingsState }) {
  const actions = useAppActions();
  const productHref = useProductHref();
  const about = settings.about;
  if (!about) {
    return null;
  }

  const update = about.updateState;

  return (
    <>
      <div className="mb-3.5">
        <Kicker>About &amp; your data</Kicker>
      </div>
      <p className="mb-4 text-[15px] leading-[1.6] text-ink">
        Discoveree keeps everything on this machine — one folder holds the
        database, files and settings. Back that folder up and you’ve backed up
        Discoveree.
      </p>
      <div>
        <AboutRow
          label="Your data"
          value={
            <span
              title={about.dataDir}
              className="font-mono text-xs text-faint"
            >
              {middleTruncate(about.dataDir, 46)}
            </span>
          }
          action={
            about.canReveal ? (
              <TealAction onClick={() => undefined}>{revealLabel()}</TealAction>
            ) : undefined
          }
        />
        <AboutRow
          label="Database"
          value={
            <span className="font-mono text-xs tabular-nums text-faint">
              {about.dbSizeOnDisk} on disk
            </span>
          }
        />
        <AboutRow
          label="Version"
          value={
            <span className="font-mono text-xs tabular-nums text-faint">
              {about.version}
              {update === "current" ? (
                <span className="font-sans"> · up to date</span>
              ) : null}
              {typeof update === "object" ? (
                <span className="font-sans text-red-700 dark:text-red-400">
                  {" "}
                  · couldn’t check for updates · {update.failedAt}
                </span>
              ) : null}
            </span>
          }
          action={
            update === "ready" ? (
              <TealAction onClick={() => undefined}>
                Update ready — restart to apply
              </TealAction>
            ) : update === "current" ? (
              <TealAction onClick={actions.checkForUpdates}>
                Check for updates
              </TealAction>
            ) : typeof update === "object" ? (
              <TealAction onClick={actions.checkForUpdates}>
                Try again
              </TealAction>
            ) : undefined
          }
        />
        <AboutRow
          label="Sources"
          value={
            <span className="text-[13px] italic text-faint">
              Everything agents believe, and why
            </span>
          }
          action={
            <Link
              href={productHref("/sources")}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Open Sources →
            </Link>
          }
        />
        <AboutRow
          label="Licence terms"
          value={
            <span className="font-mono text-xs text-faint">
              source-available · FSL
            </span>
          }
          action={
            <ExternalLink
              href={LICENCE_TERMS_URL}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              Read the licence ↗
            </ExternalLink>
          }
        />
        {/* Snapshot export ships with team-sharing rung 1 — the slot is
            reserved, the UI shows nothing until the feature exists (7.1). */}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const state = useAppState();
  const [focus, goTo] = useAnchorFocus();
  const settings = state.settings;
  if (!settings) {
    return null;
  }

  const { modules } = state;
  const connectionBearing =
    modules.connections.enabled ||
    modules.roadmap.enabled ||
    modules.customers.enabled;
  const anyUnchosen = JOBS.some((job) => !modules[job.module].enabled);

  return (
    <div className="flex justify-center px-8 py-[42px]">
      <div className="w-full max-w-[720px]">
        <div className="mb-4">
          <Kicker>Settings · this machine</Kicker>
        </div>
        <SettingsLede settings={settings} goTo={goTo} />

        <Block id="llm-keys" focus={focus}>
          <LlmKeysBlock settings={settings} />
        </Block>

        <Block id="agent-schedules" focus={focus}>
          <AgentSchedulesBlock settings={settings} modules={modules} />
        </Block>

        {connectionBearing ? (
          <Block id="connections" focus={focus}>
            <ConnectionsBlock settings={settings} />
          </Block>
        ) : null}

        {anyUnchosen ? (
          <Block id="add-capabilities" focus={focus}>
            <AddCapabilitiesBlock modules={modules} />
          </Block>
        ) : null}

        <Block id="licence" focus={focus}>
          <LicenceBlock settings={settings} />
        </Block>

        <Block id="about" focus={focus}>
          <AboutBlock settings={settings} />
        </Block>
      </div>
    </div>
  );
}
