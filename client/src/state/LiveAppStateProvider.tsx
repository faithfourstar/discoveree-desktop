import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  aboutFromServer,
  agentRowFromServer,
  api,
  ApiError,
  changeClause,
  classifyKeyTest,
  freshSinceLabel,
  llmKeyRowsFromServer,
  objectFromDetail,
  objectFromRow,
  proposalFromDetail,
  providerKeyField,
  providerToServer,
  rowFromCard,
  threatToServer,
  type KeyTestOutcome,
  type ServerActiveRun,
  type ServerAgentSchedules,
  type ServerCompetitorCard,
  type ServerFeedChange,
  type ServerLlmKeysView,
  type ServerProduct,
} from "@/lib/api";
import {
  composeCustomers,
  customersApi,
  enrichNoticeFrom,
  fitToServer,
  typeToServer,
  type ServerEvidenceStatus,
  type ServerFeedbackEntry,
  type ServerSegmentCard,
  type ServerSegmentDetail,
  type ServerTheme,
} from "@/lib/customersApi";
import { parseProductId, productBase } from "@/lib/productUrl";
import {
  competitorsSeenChangesKey,
  competitorsViewKey,
  customersSeenEntriesKey,
} from "@/lib/storageKeys";
import {
  buildLede,
  initialAddFlow,
  normaliseDomain,
  orderRows,
  type LedeHighlight,
} from "@/mock/competitors";
import {
  earliestNextRun,
  isWellFormedLicenceKey,
  makeMask,
  normaliseLicenceKey,
} from "@/mock/settings";
import { ordinal } from "@/mock/customers";
import type {
  AboutInfo,
  AddStage,
  AgentFrequency,
  AppState,
  CompetitorChecking,
  CompetitorRow,
  LicenceState,
  LlmKeyRow,
  LogFeedbackState,
  ProviderId,
  SettingsState,
} from "@/mock/types";
import { AppStateBridge, type AppActions } from "./appStateCore";

/**
 * Live provider: the same AppState/AppActions surface as the mock harness,
 * served from the local desktop server (127.0.0.1:7317 behind the /api
 * proxy). Coarse pipeline states come from the server — nothing is
 * fabricated: staged rows reflect the runs the server actually reports.
 *
 * Product scoping (ADR 003 §1.2): the active product is URL state — every
 * product-scoped fetch is keyed off it, per-product preferences (view,
 * seen-change ids) are keyed by product id, and switching products swaps
 * the dataset cleanly: in-flight responses for the product being left are
 * dropped, never merged.
 */

const POLL_MS = 3000;
const OFFLINE_RETRY_MS = 8000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Static trial placeholder — there is no licensing server yet; the future
 * licensing sprint replaces this with real key state (settings-spec part 6,
 * 14-day trial decided).
 */
const TRIAL_PLACEHOLDER: LicenceState = { kind: "trial", daysLeft: 14 };
const TRIAL_FOOTER = "Trial · 14 days left";

function storedView(productId: string | null): "cards" | "table" {
  if (!productId) {
    return "cards";
  }
  const stored = window.localStorage.getItem(competitorsViewKey(productId));
  return stored === "table" ? "table" : "cards";
}

function loadSeenChangeIds(productId: string | null): Set<string> {
  if (!productId) {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(
      competitorsSeenChangesKey(productId),
    );
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function loadCustomersSeen(productId: string | null): Set<string> {
  if (!productId) {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(customersSeenEntriesKey(productId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function persistCustomersSeen(
  productId: string | null,
  ids: ReadonlySet<string>,
): void {
  if (productId) {
    window.localStorage.setItem(
      customersSeenEntriesKey(productId),
      JSON.stringify([...ids]),
    );
  }
}

function persistSeenChangeIds(
  productId: string | null,
  ids: ReadonlySet<string>,
): void {
  if (!productId) {
    return;
  }
  window.localStorage.setItem(
    competitorsSeenChangesKey(productId),
    JSON.stringify([...ids]),
  );
}

function nameFromDomain(domain: string): string {
  const stem = domain.split(".")[0] ?? domain;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function makeLiveBaseState(): AppState {
  return {
    productName: "Discoveree",
    products: [],
    productCreate: { pending: false, error: null },
    scenario: "briefing",
    mockScenario: "briefing",
    modules: {
      home: { enabled: true, populated: true },
      competitors: { enabled: true, populated: false },
      customers: { enabled: true, populated: false },
      strategy: { enabled: true, populated: false },
      roadmap: { enabled: true, populated: false },
      connections: { enabled: true, populated: true },
      settings: { enabled: true, populated: true },
    },
    footer: {
      local: "Local · 127.0.0.1:7317",
      offline: "Works offline",
    },
    home: null,
    dayOne: null,
    competitorsOverview: null,
    competitors: {},
    competitorAddFlow: { ...initialAddFlow },
    onboardingProposals: null,
    // Customers module — live wiring lands with the 3b server (ADR 004 §6);
    // until then the module renders its day-one state in live mode.
    customersOverview: null,
    themes: {},
    segments: {},
    feedbackFlow: { open: false, draft: "" },
    customersChecking: [],
    segmentProposals: null,
    segmentAdoption: null,
    settings: null,
    agentsPaused: false,
    justVerifiedId: null,
  };
}

interface PendingRun {
  startedAtMs: number;
  prevNewestChangeId: string | null;
}

/**
 * The proposed row the add flow is shepherding (review-before-save gate):
 * POST creates it "proposed"; while enrichment runs we show coarse staged
 * rows; when it settles the proposal card renders from the real draft; only
 * /accept makes it a tracked row.
 */
interface ProposalRun {
  id: string;
  name: string;
  /** Coarse stages the server has actually reported so far, in order. */
  seenLabels: string[];
  /** Enrichment settled — the proposal card is showing; stop polling it. */
  settled: boolean;
}

const AGENT_STAGE_COPY: Record<string, { running: string; done: string }> = {
  "Competitor Profile": {
    running: "Drafting the profile — reading their site…",
    done: "Drafted the profile",
  },
  Features: {
    running: "Cataloguing their features…",
    done: "Catalogued their features",
  },
  "Competitor Updates": {
    running: "Scanning for recent changes…",
    done: "Scanned for recent changes",
  },
};

export function LiveAppStateProvider({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const activeProductId = parseProductId(location);
  const [state, setState] = useState<AppState>(makeLiveBaseState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeProductIdRef = useRef<string | null>(activeProductId);
  activeProductIdRef.current = activeProductId;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const productsRef = useRef<ServerProduct[]>([]);
  const cardsRef = useRef<ServerCompetitorCard[]>([]);
  const feedRef = useRef<ServerFeedChange[]>([]);
  const seenRef = useRef<Set<string>>(loadSeenChangeIds(activeProductId));

  // Customers module (ADR 004 §6)
  const customersDataRef = useRef<{
    segments: ServerSegmentCard[];
    themes: ServerTheme[];
    unfiledCount: number;
    entries: ServerFeedbackEntry[];
    details: Map<string, ServerSegmentDetail>;
  }>({ segments: [], themes: [], unfiledCount: 0, entries: [], details: new Map() });
  const customersSeenRef = useRef<Set<string>>(
    loadCustomersSeen(activeProductId),
  );
  /**
   * Live customers runs, keyed by stamp target (segment id for enrich, the
   * initiating theme id for aggregate) or `run:<kind>` for product-wide runs
   * adopted from the server. Elapsed stamps derive from the server's
   * startedAt once the run is seen there.
   */
  const customersRunsRef = useRef<
    Map<
      string,
      {
        kind: "collect" | "aggregate" | "enrich";
        stampId?: string;
        startedAtMs: number;
        seenOnServer: boolean;
        agentLabel?: string;
      }
    >
  >(new Map());
  const customersNoticesRef = useRef<Map<string, string>>(new Map());
  const customersRenamedRef = useRef<Map<string, string>>(new Map());
  const customersPollTimerRef = useRef<number | null>(null);
  const customersTickTimerRef = useRef<number | null>(null);
  const pendingRunsRef = useRef<Map<string, PendingRun>>(new Map());
  const serverActiveRef = useRef<ServerActiveRun | null>(null);
  const proposalRunRef = useRef<ProposalRun | null>(null);
  /** Rows whose stamp carries "· nothing changed" until their next check. */
  const quietSuffixRef = useRef<Set<string>>(new Set());
  const offlineRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const tintTimerRef = useRef<number | null>(null);
  const detailLoadedRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  // Settings (org-scoped: loaded once, independent of the product dimension).
  const keysViewRef = useRef<ServerLlmKeysView | null>(null);
  const schedulesRef = useRef<ServerAgentSchedules | null>(null);
  const aboutRef = useRef<AboutInfo | null>(null);
  /** Providers whose key could not be verified this session (2.4). */
  const unverifiedKeysRef = useRef<Set<ProviderId>>(new Set());
  const keyTickTimerRef = useRef<number | null>(null);
  const settingsTimersRef = useRef<number[]>([]);
  const settingsRetryTimerRef = useRef<number | null>(null);

  const actions = useMemo<AppActions>(() => {
    // ── Recompose helpers (refs → state) ──────────────────────────────────

    const newestChangeFor = (name: string): ServerFeedChange | undefined =>
      feedRef.current.find((change) => change.competitorName === name);

    const checkingEntries = (): CompetitorChecking[] => {
      const entries = new Map<string, CompetitorChecking>();
      const now = Date.now();
      for (const [id, pending] of pendingRunsRef.current) {
        const card = cardsRef.current.find((c) => c.id === id);
        entries.set(id, {
          id,
          name: card?.name ?? "competitor",
          elapsedS: Math.max(0, Math.floor((now - pending.startedAtMs) / 1000)),
        });
      }
      const active = serverActiveRef.current;
      if (active?.active) {
        const id =
          active.competitorId ??
          cardsRef.current.find((c) => c.name === active.competitorName)?.id ??
          null;
        // A proposed row's run belongs to the add flow, never the overview.
        if (id && id !== proposalRunRef.current?.id && !entries.has(id)) {
          const startedMs = active.startedAt
            ? new Date(active.startedAt).getTime()
            : now;
          entries.set(id, {
            id,
            name: active.competitorName ?? "competitor",
            elapsedS: Math.max(0, Math.floor((now - startedMs) / 1000)),
          });
        }
      }
      return [...entries.values()];
    };

    const composeRows = (): readonly CompetitorRow[] =>
      orderRows(
        cardsRef.current.map((card) => {
          const row = rowFromCard({
            card,
            latestChange: newestChangeFor(card.name),
            seenChangeIds: seenRef.current,
          });
          if (quietSuffixRef.current.has(card.id) && row.verifiedAgo) {
            row.verifiedAgo = `${row.verifiedAgo} · nothing changed`;
          }
          return row;
        }),
      );

    const composeLede = (rows: readonly CompetitorRow[]) => {
      const weekAgo = Date.now() - WEEK_MS;
      const weekChanges = feedRef.current
        .filter((change) => new Date(change.detectedAt).getTime() >= weekAgo)
        .slice(0, 2);
      const highlights: LedeHighlight[] = [];
      for (const change of weekChanges) {
        const row = rows.find((r) => r.name === change.competitorName);
        if (row && !highlights.some((h) => h.id === row.id)) {
          highlights.push({
            name: row.name,
            id: row.id,
            clause: changeClause(change.changeType),
          });
        }
      }
      const weekIds = new Set(highlights.map((h) => h.id));
      const weekChangedIds = new Set(
        rows
          .filter((r) => {
            const change = newestChangeFor(r.name);
            return (
              change && new Date(change.detectedAt).getTime() >= weekAgo
            );
          })
          .map((r) => r.id),
      );
      // The lede counts movement this week; older change lines stay on rows.
      const ledeRows = rows.map((row) =>
        weekChangedIds.has(row.id) || weekIds.has(row.id)
          ? row
          : (({ change: _change, ...rest }) => rest)(row),
      );
      const newestVerified = cardsRef.current
        .map((card) => card.lastVerifiedAt)
        .filter((iso): iso is string => iso !== null)
        .sort()
        .pop() ?? null;
      return buildLede(ledeRows, highlights, freshSinceLabel(newestVerified));
    };

    const composeFooterAgents = (
      checking: readonly CompetitorChecking[],
    ): { agents: string; agentsLive: boolean } => {
      if (checking.length > 0) {
        const names = checking.map((entry) => entry.name).join(" and ");
        return { agents: `Agents · checking ${names}`, agentsLive: true };
      }
      const schedules = schedulesRef.current;
      if (schedules?.pausedAll) {
        // Pausing is a choice, not a failure — default colouring (spec 3.4).
        return { agents: "Agents · paused by you", agentsLive: false };
      }
      const next = schedules
        ? earliestNextRun(schedules.agents.map(agentRowFromServer))
        : undefined;
      return {
        agents: next?.nextRun
          ? `Agents idle · next run ${next.nextRun}`
          : "Agents idle",
        agentsLive: false,
      };
    };

    /** The footer's Local segment — the db size once About has loaded. */
    const composeFooterLocal = (): string =>
      aboutRef.current
        ? `Local · ${aboutRef.current.dbSizeOnDisk} on disk`
        : "Local · 127.0.0.1:7317";

    const composeAddFlowStages = (): readonly AddStage[] | null => {
      const run = proposalRunRef.current;
      if (!run || run.settled) {
        return null;
      }
      const stages: AddStage[] = [
        {
          id: "saved",
          label: `Saved ${run.name} as a draft — nothing is tracked until you accept`,
          status: "done",
        },
      ];
      const active = serverActiveRef.current;
      const activeLabel =
        active?.active &&
        (active.competitorId === run.id || active.competitorName === run.name)
          ? (active.agentLabel ?? null)
          : null;
      if (activeLabel && !run.seenLabels.includes(activeLabel)) {
        run.seenLabels.push(activeLabel);
      }
      run.seenLabels.forEach((label) => {
        const copy = AGENT_STAGE_COPY[label];
        if (!copy) {
          return;
        }
        const isRunning = label === activeLabel;
        stages.push({
          id: `agent:${label}`,
          label: isRunning ? copy.running : copy.done,
          status: isRunning ? "running" : "done",
        });
      });
      return stages;
    };

    const recompose = () => {
      if (!mountedRef.current) {
        return;
      }
      setState((prev) => {
        if (offlineRef.current) {
          return {
            ...prev,
            footer: {
              ...prev.footer,
              local: "Local · server unreachable — retrying",
              agents: undefined,
              agentsLive: false,
            },
            competitorsOverview: null,
            modules: {
              ...prev.modules,
              competitors: { ...prev.modules.competitors, populated: false },
            },
          };
        }
        const rows = composeRows();
        const checking = checkingEntries();
        const { agents, agentsLive } = composeFooterAgents(checking);
        const stages = composeAddFlowStages();
        const competitors = { ...prev.competitors };
        for (const row of rows) {
          const existing = competitors[row.id];
          if (!existing || !detailLoadedRef.current.has(row.id)) {
            competitors[row.id] = objectFromRow(row);
          } else {
            // Keep the fetched detail; refresh the row-derived stamp fields.
            competitors[row.id] = {
              ...existing,
              threat: row.threat,
              classification: row.classification,
              verifiedAgo: row.verifiedAgo,
              stale: row.stale ? true : undefined,
              staleDays: row.staleDays,
              lastRunFailed: row.lastRunFailed,
              changeUnseen: row.change?.unseen ? true : undefined,
            };
          }
        }
        for (const id of Object.keys(competitors)) {
          if (!rows.some((row) => row.id === id)) {
            delete competitors[id];
          }
        }
        return {
          ...prev,
          footer: {
            ...prev.footer,
            local: composeFooterLocal(),
            agents,
            agentsLive,
          },
          modules: {
            ...prev.modules,
            competitors: {
              ...prev.modules.competitors,
              populated: rows.length > 0,
            },
          },
          competitorsOverview:
            rows.length > 0
              ? {
                  lede: composeLede(rows),
                  rows,
                  view:
                    prev.competitorsOverview?.view ??
                    storedView(activeProductIdRef.current),
                  checking,
                  searchKeyMissing: false,
                }
              : null,
          competitors,
          competitorAddFlow: stages
            ? {
                ...prev.competitorAddFlow,
                phase: "researching",
                stages,
              }
            : prev.competitorAddFlow,
        };
      });
    };

    // ── Timers ────────────────────────────────────────────────────────────

    const stopPolling = () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (tickTimerRef.current !== null) {
        window.clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
    };

    const shouldPoll = (): boolean =>
      pendingRunsRef.current.size > 0 ||
      (proposalRunRef.current !== null && !proposalRunRef.current.settled) ||
      serverActiveRef.current?.active === true ||
      cardsRef.current.some(
        (card) =>
          card.enrichmentStatus === "pending" ||
          card.enrichmentStatus === "enriching",
      );

    const markJustVerified = (id: string) => {
      setState((prev) => ({ ...prev, justVerifiedId: id }));
      if (tintTimerRef.current !== null) {
        window.clearTimeout(tintTimerRef.current);
      }
      tintTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, justVerifiedId: null }));
        }
      }, 1500);
    };

    const refreshDetailIfLoaded = async (id: string) => {
      const productId = activeProductIdRef.current;
      if (!productId || !detailLoadedRef.current.has(id)) {
        return;
      }
      try {
        const detail = await api.getCompetitor(productId, id);
        if (activeProductIdRef.current !== productId) {
          return; // Switched away — never merge across products.
        }
        const row = composeRows().find((r) => r.id === id);
        if (!row) {
          return;
        }
        const object = objectFromDetail(detail.competitor, detail.changes, row);
        setState((prev) => ({
          ...prev,
          competitors: { ...prev.competitors, [id]: object },
        }));
      } catch {
        // The next poll cycle will retry; detail is a read-through cache.
      }
    };

    const pollOnce = async () => {
      const productId = activeProductIdRef.current;
      if (!productId) {
        return;
      }
      try {
        const [listRes, activeRes] = await Promise.all([
          api.listCompetitors(productId),
          api.getActiveRun(productId),
        ]);
        if (activeProductIdRef.current !== productId) {
          return; // Switched away mid-poll — drop the stale product's data.
        }
        cardsRef.current = listRes.competitors;
        serverActiveRef.current = activeRes;
        offlineRef.current = false;

        // Settle finished client-initiated runs.
        for (const [id, pending] of pendingRunsRef.current) {
          const card = cardsRef.current.find((c) => c.id === id);
          if (!card) {
            pendingRunsRef.current.delete(id);
            continue;
          }
          const stillActive =
            activeRes.active &&
            (activeRes.competitorId === id ||
              activeRes.competitorName === card.name);
          const stillEnriching =
            card.enrichmentStatus === "pending" ||
            card.enrichmentStatus === "enriching";
          if (!stillActive && !stillEnriching) {
            pendingRunsRef.current.delete(id);
            const changesRes = await api.listChanges(productId, 50);
            if (activeProductIdRef.current !== productId) {
              return;
            }
            feedRef.current = changesRes.changes;
            const newest = newestChangeFor(card.name);
            const changed =
              newest !== undefined && newest.id !== pending.prevNewestChangeId;
            if (!changed && card.enrichmentStatus === "completed") {
              quietSuffixRef.current.add(id);
            } else {
              quietSuffixRef.current.delete(id);
            }
            if (card.enrichmentStatus === "completed") {
              // The tint fade marks a settled verification, never a failure.
              markJustVerified(id);
            }
            void refreshDetailIfLoaded(id);
          }
        }

        // The proposed row settles when its enrichment leaves the running
        // states — then the proposal card renders from the real draft.
        const proposalRun = proposalRunRef.current;
        if (proposalRun && !proposalRun.settled) {
          try {
            const detail = await api.getCompetitor(productId, proposalRun.id);
            if (activeProductIdRef.current !== productId) {
              return;
            }
            const stillActive =
              activeRes.active &&
              (activeRes.competitorId === proposalRun.id ||
                activeRes.competitorName === proposalRun.name);
            const stillEnriching =
              detail.competitor.enrichmentStatus === "pending" ||
              detail.competitor.enrichmentStatus === "enriching";
            if (!stillActive && !stillEnriching) {
              proposalRun.settled = true;
              // Keep the run's name server-canonical for rename tracking.
              proposalRun.name = detail.competitor.name;
              const proposal = proposalFromDetail(detail.competitor);
              setState((prev) => ({
                ...prev,
                competitorAddFlow: {
                  ...prev.competitorAddFlow,
                  phase: "proposal",
                  stages: [],
                  proposal,
                },
              }));
            }
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
              // The proposed row vanished (discarded elsewhere) — reset.
              proposalRunRef.current = null;
              setState((prev) => ({
                ...prev,
                competitorAddFlow: { ...initialAddFlow, open: true },
              }));
            }
          }
        }

        recompose();
        if (!shouldPoll()) {
          stopPolling();
        }
      } catch {
        // Transient poll failure — keep the timers; full outage is handled
        // by the initial-load retry path when the next action fails.
      }
    };

    const ensurePolling = () => {
      if (pollTimerRef.current === null) {
        pollTimerRef.current = window.setInterval(() => {
          void pollOnce();
        }, POLL_MS);
      }
      if (tickTimerRef.current === null) {
        // The elapsed counters tick every second from server startedAt times.
        tickTimerRef.current = window.setInterval(() => {
          const overview = stateRef.current.competitorsOverview;
          if (!overview || (overview.checking ?? []).length === 0) {
            return;
          }
          setState((prev) =>
            prev.competitorsOverview
              ? {
                  ...prev,
                  competitorsOverview: {
                    ...prev.competitorsOverview,
                    checking: checkingEntries(),
                  },
                }
              : prev,
          );
        }, 1000);
      }
    };

    const loadAll = async () => {
      const productId = activeProductIdRef.current;
      try {
        // Org first: the product list drives the switcher and validates the
        // URL's product before anything product-scoped is fetched.
        const productsRes = await api.listProducts();
        productsRef.current = productsRes.products;
        offlineRef.current = false;
        const active = productId
          ? productsRes.products.find((product) => product.id === productId)
          : undefined;
        setState((prev) => ({
          ...prev,
          products: productsRes.products.map((product) => ({
            id: product.id,
            name: product.name,
          })),
          productName:
            active?.name ?? productsRes.products[0]?.name ?? "Discoveree",
        }));
        if (!active) {
          // No (valid) product in the URL — the URL guard redirects into
          // the first product; nothing product-scoped to load yet.
          recompose();
          return;
        }
        const [listRes, changesRes, activeRes] = await Promise.all([
          api.listCompetitors(active.id),
          api.listChanges(active.id, 50),
          api.getActiveRun(active.id),
        ]);
        if (activeProductIdRef.current !== active.id) {
          return; // Switched away mid-load.
        }
        cardsRef.current = listRes.competitors;
        feedRef.current = changesRes.changes;
        serverActiveRef.current = activeRes;
        recompose();
        // Customers loads in parallel with its own error handling — a
        // failure there leaves the module in its day-one state.
        void loadCustomers(active.id);
        if (shouldPoll()) {
          ensurePolling();
        }
      } catch {
        offlineRef.current = true;
        recompose();
        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current);
        }
        retryTimerRef.current = window.setTimeout(() => {
          void loadAll();
        }, OFFLINE_RETRY_MS);
      }
    };

    /**
     * Product switch (URL changed): drop everything belonging to the
     * previous product — refs, per-product preferences, add-flow state —
     * and load the new product's dataset. No cross-product bleed.
     */
    const switchProduct = (productId: string | null) => {
      stopPolling();
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      pendingRunsRef.current.clear();
      proposalRunRef.current = null;
      serverActiveRef.current = null;
      cardsRef.current = [];
      feedRef.current = [];
      quietSuffixRef.current.clear();
      detailLoadedRef.current.clear();
      seenRef.current = loadSeenChangeIds(productId);
      stopCustomersTimers();
      customersRunsRef.current.clear();
      customersNoticesRef.current.clear();
      customersRenamedRef.current.clear();
      customersDataRef.current = {
        segments: [],
        themes: [],
        unfiledCount: 0,
        entries: [],
        details: new Map(),
      };
      customersSeenRef.current = loadCustomersSeen(productId);
      setState((prev) => ({
        ...prev,
        productName:
          productsRef.current.find((product) => product.id === productId)
            ?.name ?? prev.productName,
        competitorsOverview: null,
        competitors: {},
        competitorAddFlow: { ...initialAddFlow },
        customersOverview: null,
        themes: {},
        segments: {},
        feedbackFlow: { open: false, draft: "" },
        customersChecking: [],
        justVerifiedId: null,
        modules: {
          ...prev.modules,
          competitors: { ...prev.modules.competitors, populated: false },
          customers: { ...prev.modules.customers, populated: false },
        },
      }));
      void loadAll();
    };

    // ── Customers (ADR 004 §6) ────────────────────────────────────────────

    const recomposeCustomers = () => {
      if (!mountedRef.current) {
        return;
      }
      const data = customersDataRef.current;
      // The part-5 crossover chip resolves through the competitor cards
      // (own-product feedback with competitorEntityId, isCompetitor false).
      const competitorsByEntityId = new Map(
        cardsRef.current
          .filter(
            (card): card is typeof card & { entityId: string } =>
              typeof card.entityId === "string",
          )
          .map((card) => [
            card.entityId,
            { id: card.id, name: card.name },
          ]),
      );
      const composed = composeCustomers({
        ...data,
        seenEntryIds: customersSeenRef.current,
        competitorsByEntityId,
      });
      for (const [id, oldName] of customersRenamedRef.current) {
        const theme = composed.themes[id];
        if (theme) {
          composed.themes[id] = { ...theme, renamedFrom: oldName };
        }
      }
      for (const [id, notice] of customersNoticesRef.current) {
        const segment = composed.segments[id];
        if (segment) {
          composed.segments[id] = { ...segment, enrichNotice: notice };
        }
      }
      const populated =
        data.themes.length > 0 ||
        data.segments.length > 0 ||
        data.entries.length > 0;
      const now = Date.now();
      const runs = [...customersRunsRef.current.values()];
      const checking = runs
        .filter(
          (run): run is typeof run & { stampId: string } =>
            run.stampId !== undefined,
        )
        .map((run) => ({
          id: run.stampId,
          elapsedS: Math.max(0, Math.floor((now - run.startedAtMs) / 1000)),
        }));
      setState((prev) => {
        const next: AppState = {
          ...prev,
          customersOverview: populated ? composed.overview : null,
          themes: composed.themes,
          segments: composed.segments,
          customersChecking: checking,
          modules: {
            ...prev.modules,
            customers: { ...prev.modules.customers, populated },
          },
        };
        // Product-wide and targeted runs both narrate in the footer; the
        // competitors segment keeps priority while its own runs are live.
        const competitorsBusy =
          (prev.competitorsOverview?.checking ?? []).length > 0;
        if (runs.length > 0 && !competitorsBusy) {
          const first = runs[0];
          if (first) {
            const label =
              first.agentLabel ??
              (first.kind === "enrich" ? "enriching segment" : "reading feedback");
            const longestS = Math.floor(
              runs.reduce(
                (max, run) => Math.max(max, now - run.startedAtMs),
                0,
              ) / 1000,
            );
            const minutes = Math.floor(longestS / 60);
            const seconds = String(longestS % 60).padStart(2, "0");
            next.footer = {
              ...next.footer,
              agents: `Agents · ${label} · ${minutes}:${seconds}`,
              agentsLive: true,
            };
          }
        } else if (
          runs.length === 0 &&
          !competitorsBusy &&
          prev.footer.agentsLive
        ) {
          next.footer = {
            ...next.footer,
            ...composeFooterAgents([]),
          };
        }
        return next;
      });
    };

    const loadCustomers = async (productId: string) => {
      try {
        const [segRes, themesRes, feedbackRes] = await Promise.all([
          customersApi.listSegments(productId),
          customersApi.listThemes(productId),
          customersApi.listFeedback(productId),
        ]);
        if (activeProductIdRef.current !== productId) {
          return;
        }
        const tracked = segRes.segments.filter(
          (card) => card.status !== "proposed",
        );
        const detailPairs = await Promise.all(
          tracked.map(async (card) => {
            try {
              const res = await customersApi.getSegment(productId, card.id);
              return [card.id, res.segment] as const;
            } catch {
              return null;
            }
          }),
        );
        if (activeProductIdRef.current !== productId) {
          return;
        }
        customersDataRef.current = {
          segments: segRes.segments,
          themes: themesRes.themes,
          unfiledCount: themesRes.unfiledCount,
          entries: feedbackRes.feedback,
          details: new Map(
            detailPairs.filter(
              (pair): pair is readonly [string, ServerSegmentDetail] =>
                pair !== null,
            ),
          ),
        };
        recomposeCustomers();
      } catch {
        // The customers slice stays empty; the module renders its day-one
        // state. The main offline path (loadAll) owns the retry loop.
      }
    };

    /** Refetch the lists + one segment detail after a mutation settles. */
    const refreshCustomers = async (segmentDetailId?: string) => {
      const productId = activeProductIdRef.current;
      if (!productId) {
        return;
      }
      try {
        const [segRes, themesRes, feedbackRes] = await Promise.all([
          customersApi.listSegments(productId),
          customersApi.listThemes(productId),
          customersApi.listFeedback(productId),
        ]);
        if (activeProductIdRef.current !== productId) {
          return;
        }
        const data = customersDataRef.current;
        data.segments = segRes.segments;
        data.themes = themesRes.themes;
        data.unfiledCount = themesRes.unfiledCount;
        data.entries = feedbackRes.feedback;
        if (segmentDetailId) {
          try {
            const res = await customersApi.getSegment(
              productId,
              segmentDetailId,
            );
            data.details.set(segmentDetailId, res.segment);
          } catch {
            data.details.delete(segmentDetailId);
          }
        }
        recomposeCustomers();
      } catch {
        // Transient — the next action or poll retries.
      }
    };

    const stopCustomersTimers = () => {
      if (customersPollTimerRef.current !== null) {
        window.clearInterval(customersPollTimerRef.current);
        customersPollTimerRef.current = null;
      }
      if (customersTickTimerRef.current !== null) {
        window.clearInterval(customersTickTimerRef.current);
        customersTickTimerRef.current = null;
      }
    };

    /**
     * The runs/active pattern (competitors idiom): poll the server's single
     * live-run view while anything is running; adopt runs we did not start;
     * settle an entry when the server stops reporting it. A just-fired run
     * gets a short grace before its absence means "already finished".
     */
    const customersPollOnce = async () => {
      const productId = activeProductIdRef.current;
      if (!productId || customersRunsRef.current.size === 0) {
        stopCustomersTimers();
        return;
      }
      try {
        const activeRes = await customersApi.getActiveRun(productId);
        if (activeProductIdRef.current !== productId) {
          return;
        }
        const matchesEntry = (entry: {
          kind: "collect" | "aggregate" | "enrich";
          stampId?: string;
        }): boolean => {
          if (!activeRes.active || !activeRes.kind) {
            return false;
          }
          if (activeRes.kind === "enrich") {
            return (
              entry.kind === "enrich" && entry.stampId === activeRes.targetId
            );
          }
          return entry.kind === activeRes.kind;
        };

        if (activeRes.active && activeRes.kind) {
          const matched = [...customersRunsRef.current.values()].find(
            matchesEntry,
          );
          if (matched) {
            matched.seenOnServer = true;
            if (activeRes.startedAt) {
              matched.startedAtMs = new Date(activeRes.startedAt).getTime();
            }
            if (activeRes.agentLabel) {
              matched.agentLabel = activeRes.agentLabel;
            }
          } else {
            // A run we did not start (scheduled/background) — adopt it.
            const key = activeRes.targetId ?? `run:${activeRes.kind}`;
            customersRunsRef.current.set(key, {
              kind: activeRes.kind,
              ...(activeRes.targetId ? { stampId: activeRes.targetId } : {}),
              startedAtMs: activeRes.startedAt
                ? new Date(activeRes.startedAt).getTime()
                : Date.now(),
              seenOnServer: true,
              ...(activeRes.agentLabel
                ? { agentLabel: activeRes.agentLabel }
                : {}),
            });
          }
        }

        const GRACE_MS = 8000;
        for (const [key, entry] of [...customersRunsRef.current.entries()]) {
          const reported = matchesEntry(entry);
          const age = Date.now() - entry.startedAtMs;
          if (!reported && (entry.seenOnServer || age > GRACE_MS)) {
            customersRunsRef.current.delete(key);
            await refreshCustomers(
              entry.kind === "enrich" ? entry.stampId : undefined,
            );
            if (entry.stampId) {
              markJustVerified(entry.stampId);
            }
          }
        }
      } catch {
        // Transient — the next cycle retries; entries keep their stamps.
      }
      recomposeCustomers();
      if (customersRunsRef.current.size === 0) {
        stopCustomersTimers();
      }
    };

    const ensureCustomersTimers = () => {
      if (customersTickTimerRef.current === null) {
        customersTickTimerRef.current = window.setInterval(() => {
          if (customersRunsRef.current.size > 0) {
            recomposeCustomers();
          }
        }, 1000);
      }
      if (customersPollTimerRef.current === null) {
        customersPollTimerRef.current = window.setInterval(() => {
          void customersPollOnce();
        }, 4000);
      }
    };

    const startCustomersRun = (
      kind: "collect" | "aggregate" | "enrich",
      stampId?: string,
    ) => {
      const key = stampId ?? `run:${kind}`;
      if (stampId) {
        customersNoticesRef.current.delete(stampId);
      }
      customersRunsRef.current.set(key, {
        kind,
        ...(stampId ? { stampId } : {}),
        startedAtMs: Date.now(),
        seenOnServer: false,
      });
      recomposeCustomers();
      ensureCustomersTimers();
    };

    // ── Shared action helpers ─────────────────────────────────────────────

    const registerPendingRun = (id: string, startedAtMs: number) => {
      const card = cardsRef.current.find((c) => c.id === id);
      const prevNewest = card ? newestChangeFor(card.name) : undefined;
      quietSuffixRef.current.delete(id);
      pendingRunsRef.current.set(id, {
        startedAtMs,
        prevNewestChangeId: prevNewest?.id ?? null,
      });
      recompose();
      ensurePolling();
    };

    const createCompetitor = async (body: {
      name: string;
      url?: string;
    }): Promise<void> => {
      const productId = activeProductIdRef.current;
      if (!productId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        competitorAddFlow: {
          ...prev.competitorAddFlow,
          open: true,
          phase: "researching",
          stages: [
            { id: "saved", label: `Saving ${body.name}…`, status: "running" },
          ],
        },
      }));
      try {
        // Creates a PROPOSED row: it never touches the overview list, lede
        // or counts until "Track <name>" calls /accept (spec 2.4).
        const { competitor } = await api.createCompetitor(productId, {
          ...body,
          classification: "DIRECT",
        });
        if (activeProductIdRef.current !== productId) {
          return;
        }
        const adoptedFrom = (competitor.alsoTrackedBy ?? []).filter(
          (product) => product.productId !== productId,
        );
        if (adoptedFrom.length > 0) {
          // Adoption (ADR 003 §2.3): the entity already exists in the org —
          // the proposal card renders its existing profile instantly;
          // nothing is re-researched, only facet agents run.
          proposalRunRef.current = {
            id: competitor.id,
            name: competitor.name,
            seenLabels: [],
            settled: true,
          };
          try {
            const detail = await api.getCompetitor(productId, competitor.id);
            if (activeProductIdRef.current !== productId) {
              return;
            }
            const proposal = proposalFromDetail({
              ...detail.competitor,
              alsoTrackedBy: detail.competitor.alsoTrackedBy ?? adoptedFrom,
            });
            setState((prev) => ({
              ...prev,
              competitorAddFlow: {
                ...prev.competitorAddFlow,
                orphan: undefined,
                phase: "proposal",
                stages: [],
                proposal,
              },
            }));
          } catch {
            // Detail fetch hiccup — fall back to the polling path; the
            // card arrives when the poll settles the proposed row.
            if (proposalRunRef.current?.id === competitor.id) {
              proposalRunRef.current.settled = false;
            }
            recompose();
            ensurePolling();
          }
          return;
        }
        proposalRunRef.current = {
          id: competitor.id,
          name: competitor.name,
          seenLabels: [],
          settled: false,
        };
        setState((prev) => ({
          ...prev,
          competitorAddFlow: {
            ...prev.competitorAddFlow,
            orphan: undefined,
          },
        }));
        recompose();
        ensurePolling();
      } catch (error) {
        const line =
          error instanceof ApiError
            ? error.message
            : "We couldn’t reach the local server — is the Discoveree backend running?";
        setState((prev) => ({
          ...prev,
          competitorAddFlow: {
            ...prev.competitorAddFlow,
            phase: "failed",
            stages: [],
            failure: { domain: body.url ?? body.name, line },
          },
        }));
      }
    };

    const startResearch = () => {
      const flow = stateRef.current.competitorAddFlow;
      if (flow.mode === "url") {
        const domain = normaliseDomain(flow.draft);
        if (!domain) {
          return;
        }
        void createCompetitor({
          name: nameFromDomain(domain),
          url: `https://${domain}`,
        });
      } else {
        const name = flow.draft.trim();
        if (!name) {
          return;
        }
        void createCompetitor({ name });
      }
    };

    // ── Settings (org-scoped) ─────────────────────────────────────────────

    const scheduleSettingsTimer = (delay: number, run: () => void) => {
      const timer = window.setTimeout(run, delay);
      settingsTimersRef.current.push(timer);
    };

    /**
     * Rebuild settings from the server refs, carrying over per-row transient
     * UI state (elapsed counters, verdicts, pause memory) and any licence
     * notice — server truth for the data, client truth for the in-flight UI.
     */
    const applySettings = () => {
      if (!mountedRef.current) {
        return;
      }
      setState((prev) => {
        const keysView = keysViewRef.current;
        if (!keysView) {
          return prev;
        }
        const rows = (schedulesRef.current?.agents ?? []).map((agent) => {
          const row = agentRowFromServer(agent);
          const prevRow = prev.settings?.schedules.rows.find(
            (candidate) => candidate.id === row.id,
          );
          if (prevRow?.running) {
            row.running = prevRow.running;
          }
          if (row.frequency === "off" && prevRow?.pausedFrom) {
            row.pausedFrom = prevRow.pausedFrom;
          }
          return row;
        });
        const llmKeys = llmKeyRowsFromServer(
          keysView,
          unverifiedKeysRef.current,
        ).map((row) => {
          const prevRow = prev.settings?.llmKeys.find(
            (candidate) => candidate.provider === row.provider,
          );
          if (!prevRow) {
            return row;
          }
          const next: LlmKeyRow = { ...row };
          if (prevRow.testing) {
            next.testing = prevRow.testing;
          }
          if (prevRow.testResult) {
            next.testResult = prevRow.testResult;
          }
          if (next.saved && prevRow.saved?.lastUsedAgo) {
            next.saved = {
              ...next.saved,
              lastUsedAgo: prevRow.saved.lastUsedAgo,
            };
          }
          return next;
        });
        const settings: SettingsState = {
          llmKeys,
          schedules: {
            pausedAll: schedulesRef.current?.pausedAll ?? false,
            rows,
          },
          capabilities: {
            // Contract gaps (flagged in the sprint report): no run-now
            // endpoint, no weekly day/time fields. Per-agent pause exists
            // as frequency "off", so its controls render once schedules load.
            runNow: false,
            perAgentPause: schedulesRef.current !== null,
            editWeeklyAt: false,
          },
          // No connections summary endpoint yet — the block invites.
          connections: { serving: [], checking: [] },
          licence: TRIAL_PLACEHOLDER,
          about: aboutRef.current,
          ...(prev.settings?.licenceNotice
            ? { licenceNotice: prev.settings.licenceNotice }
            : {}),
        };
        const { agents, agentsLive } = composeFooterAgents(
          prev.competitorsOverview?.checking ?? [],
        );
        return {
          ...prev,
          settings,
          footer: {
            ...prev.footer,
            local: composeFooterLocal(),
            agents,
            agentsLive,
            licence: TRIAL_FOOTER,
          },
        };
      });
    };

    const updateLiveKeyRow = (
      provider: ProviderId,
      update: (row: LlmKeyRow) => LlmKeyRow,
    ) => {
      setState((prev) =>
        prev.settings
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                llmKeys: prev.settings.llmKeys.map((row) =>
                  row.provider === provider ? update(row) : row,
                ),
              },
            }
          : prev,
      );
    };

    const stopKeyTicker = () => {
      if (keyTickTimerRef.current !== null) {
        window.clearInterval(keyTickTimerRef.current);
        keyTickTimerRef.current = null;
      }
    };

    const ensureKeyTicker = () => {
      if (keyTickTimerRef.current !== null) {
        return;
      }
      keyTickTimerRef.current = window.setInterval(() => {
        const anyTesting = stateRef.current.settings?.llmKeys.some(
          (row) => row.testing,
        );
        if (!anyTesting) {
          stopKeyTicker();
          return;
        }
        setState((prev) =>
          prev.settings
            ? {
                ...prev,
                settings: {
                  ...prev.settings,
                  llmKeys: prev.settings.llmKeys.map((row) =>
                    row.testing
                      ? {
                          ...row,
                          testing: { elapsedS: row.testing.elapsedS + 1 },
                        }
                      : row,
                  ),
                },
              }
            : prev,
        );
      }, 1000);
    };

    /** Apply a test outcome to the row (honest-verdict rules, spec 2.4). */
    const settleKeyTest = (
      provider: ProviderId,
      outcome: KeyTestOutcome,
      answeredInS: number,
    ) => {
      const works = outcome.kind === "works";
      if (works) {
        unverifiedKeysRef.current.delete(provider);
      } else {
        unverifiedKeysRef.current.add(provider);
      }
      updateLiveKeyRow(provider, (row) => {
        const next: LlmKeyRow = { ...row };
        delete next.testing;
        next.testResult = works
          ? { kind: "works", answeredInS }
          : outcome;
        if (next.saved) {
          next.saved = {
            ...next.saved,
            verified: works,
            ...(works ? { lastUsedAgo: "just now" } : {}),
          };
        }
        return next;
      });
      if (works) {
        // The ✓ settles back to the normal key line after 5 s.
        scheduleSettingsTimer(5000, () => {
          updateLiveKeyRow(provider, (row) => {
            if (row.testResult?.kind !== "works") {
              return row;
            }
            const next = { ...row };
            delete next.testResult;
            return next;
          });
        });
      }
    };

    const runKeyTest = async (provider: ProviderId): Promise<void> => {
      const started = Date.now();
      try {
        const result = await api.testLlmKey({
          provider: providerToServer(provider),
        });
        settleKeyTest(
          provider,
          classifyKeyTest(result),
          Math.max(0.1, (Date.now() - started) / 1000),
        );
      } catch {
        // Could not reach the LOCAL server to run the test — still no
        // verdict on the key.
        settleKeyTest(provider, { kind: "unreachable" }, 0);
      }
    };

    const loadSettings = async () => {
      try {
        // Keys are the gate; schedules/about arrive on their own contracts
        // and degrade independently while the parallel server work lands.
        const [keys, schedules, about] = await Promise.all([
          api.getLlmKeys(),
          api.getAgentSchedules().catch(() => null),
          api.getAbout().catch(() => null),
        ]);
        keysViewRef.current = keys;
        schedulesRef.current = schedules;
        aboutRef.current = about ? aboutFromServer(about) : null;
        applySettings();
      } catch {
        if (settingsRetryTimerRef.current !== null) {
          window.clearTimeout(settingsRetryTimerRef.current);
        }
        settingsRetryTimerRef.current = window.setTimeout(() => {
          void loadSettings();
        }, OFFLINE_RETRY_MS);
      }
    };

    const putFrequency = (id: string, frequency: string) => {
      void (async () => {
        try {
          const res = await api.putAgentSchedules({
            agents: [{ slug: id, frequency }],
          });
          schedulesRef.current = res;
          applySettings();
        } catch {
          // Reconcile with server truth — the optimistic stamp reverts.
          applySettings();
        }
      })();
    };

    const settingsLive = {
      saveLlmKey: (provider: ProviderId, key: string) => {
        const typed = key.trim();
        if (!typed) {
          return;
        }
        updateLiveKeyRow(provider, (row) => {
          const next: LlmKeyRow = {
            ...row,
            // Optimistic mask until the server's masked view returns.
            saved: { mask: makeMask(provider, typed), verified: false },
            testing: { elapsedS: 0 },
          };
          delete next.testResult;
          return next;
        });
        ensureKeyTicker();
        void (async () => {
          try {
            const view = await api.putLlmKeys({
              [providerKeyField(provider)]: typed,
            });
            keysViewRef.current = view;
            unverifiedKeysRef.current.add(provider);
            applySettings();
          } catch {
            // The save itself failed (local server) — revert to server truth
            // rather than pretending the key was stored.
            updateLiveKeyRow(provider, (row) => {
              const next = { ...row };
              delete next.testing;
              return next;
            });
            applySettings();
            return;
          }
          await runKeyTest(provider);
        })();
      },
      testLlmKey: (provider: ProviderId) => {
        const row = stateRef.current.settings?.llmKeys.find(
          (candidate) => candidate.provider === provider,
        );
        if (!row?.saved || row.testing) {
          return;
        }
        updateLiveKeyRow(provider, (existing) => {
          const next: LlmKeyRow = { ...existing, testing: { elapsedS: 0 } };
          delete next.testResult;
          return next;
        });
        ensureKeyTicker();
        void runKeyTest(provider);
      },
      removeLlmKey: (provider: ProviderId) => {
        void (async () => {
          try {
            const view = await api.putLlmKeys({
              [providerKeyField(provider)]: null,
            });
            keysViewRef.current = view;
            unverifiedKeysRef.current.delete(provider);
            applySettings();
          } catch {
            // Removal failed — the row stays as the server has it.
            applySettings();
          }
        })();
      },
      clearKeyTestResult: (provider: ProviderId) => {
        updateLiveKeyRow(provider, (row) => {
          const next = { ...row };
          delete next.testResult;
          return next;
        });
      },
      setAgentFrequency: (id: string, frequency: AgentFrequency) => {
        if (frequency === "after-gathering") {
          return;
        }
        putFrequency(id, frequency);
      },
      // The live contract carries no weekly day/time fields (flagged) —
      // the page renders the stamp read-only; this never fires.
      setAgentWeeklyAt: () => undefined,
      setAllAgentsPaused: (paused: boolean) => {
        void (async () => {
          try {
            const res = await api.putAgentSchedules({ pausedAll: paused });
            schedulesRef.current = res;
            applySettings();
          } catch {
            applySettings();
          }
        })();
      },
      setAgentPaused: (id: string, paused: boolean) => {
        const row = stateRef.current.settings?.schedules.rows.find(
          (candidate) => candidate.id === id,
        );
        if (!row) {
          return;
        }
        if (paused) {
          // Per-agent pause is frequency "off" on the server contract;
          // remember what Resume restores, client-side.
          const from =
            row.frequency !== "off" && row.frequency !== "after-gathering"
              ? row.frequency
              : undefined;
          if (from) {
            setState((prev) =>
              prev.settings
                ? {
                    ...prev,
                    settings: {
                      ...prev.settings,
                      schedules: {
                        ...prev.settings.schedules,
                        rows: prev.settings.schedules.rows.map((candidate) =>
                          candidate.id === id
                            ? { ...candidate, pausedFrom: from }
                            : candidate,
                        ),
                      },
                    },
                  }
                : prev,
            );
          }
          putFrequency(id, "off");
        } else {
          putFrequency(id, row.pausedFrom ?? "weekly");
        }
      },
      // No run-now endpoint on the live contract (flagged); the capability
      // flag keeps the control off the page, so this never fires.
      runAgentNow: () => undefined,
      // Live mode enables all modules; Add capabilities is absent.
      enableModule: () => undefined,
      activateLicenceKey: (key: string) => {
        // Format check is local; offline signed validation belongs to the
        // licensing sprint — until it lands, a well-formed key honestly
        // fails to validate (spec 6.4).
        const cleaned = normaliseLicenceKey(key);
        const notice = isWellFormedLicenceKey(cleaned)
          ? ({ kind: "invalid" } as const)
          : ({ kind: "malformed" } as const);
        setState((prev) =>
          prev.settings
            ? {
                ...prev,
                settings: { ...prev.settings, licenceNotice: notice },
              }
            : prev,
        );
      },
      clearLicenceNotice: () => {
        setState((prev) => {
          if (!prev.settings) {
            return prev;
          }
          const settings = { ...prev.settings };
          delete settings.licenceNotice;
          return { ...prev, settings };
        });
      },
      // No update-check endpoint on the live contract (flagged); the row
      // renders the version alone, so this never fires.
      checkForUpdates: () => undefined,
    };

    // ── The actions surface ───────────────────────────────────────────────

    const live: AppActions = {
      ...settingsLive,
      setCompetitorsView: (view) => {
        const productId = activeProductIdRef.current;
        if (productId) {
          window.localStorage.setItem(competitorsViewKey(productId), view);
        }
        setState((prev) =>
          prev.competitorsOverview
            ? {
                ...prev,
                competitorsOverview: { ...prev.competitorsOverview, view },
              }
            : prev,
        );
      },
      toggleCompetitorsView: () => {
        const view =
          stateRef.current.competitorsOverview?.view === "table"
            ? "cards"
            : "table";
        live.setCompetitorsView(view);
      },
      checkCompetitor: (id) => {
        const productId = activeProductIdRef.current;
        if (!productId || pendingRunsRef.current.has(id)) {
          return;
        }
        void (async () => {
          try {
            await api.refreshCompetitor(productId, id);
            registerPendingRun(id, Date.now());
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
              // A run is already going — adopt it rather than erroring.
              const payload = error.payload as {
                activeRun?: { startedAt?: string | null };
              } | null;
              const startedAt = payload?.activeRun?.startedAt;
              registerPendingRun(
                id,
                startedAt ? new Date(startedAt).getTime() : Date.now(),
              );
            }
            // Network failures surface through the next poll/load cycle.
          }
        })();
      },
      markCompetitorSeen: (id) => {
        const card = cardsRef.current.find((c) => c.id === id);
        if (!card) {
          return;
        }
        const ids = feedRef.current
          .filter((change) => change.competitorName === card.name)
          .map((change) => change.id);
        if (ids.length === 0) {
          return;
        }
        let added = false;
        for (const changeId of ids) {
          if (!seenRef.current.has(changeId)) {
            seenRef.current.add(changeId);
            added = true;
          }
        }
        if (added) {
          persistSeenChangeIds(activeProductIdRef.current, seenRef.current);
          recompose();
        }
      },
      ensureCompetitorDetail: (id) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            const detail = await api.getCompetitor(productId, id);
            if (activeProductIdRef.current !== productId) {
              return;
            }
            cardsRef.current = [
              ...cardsRef.current.filter((c) => c.id !== id),
              detail.competitor,
            ];
            detailLoadedRef.current.add(id);
            const row = composeRows().find((r) => r.id === id);
            if (!row) {
              return;
            }
            const object = objectFromDetail(
              detail.competitor,
              detail.changes,
              row,
            );
            setState((prev) => ({
              ...prev,
              competitors: { ...prev.competitors, [id]: object },
            }));
          } catch {
            // Row-derived object remains; the overview stays usable.
          }
        })();
      },
      setCompetitorClassification: (id, value) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            const { competitor } = await api.patchCompetitor(productId, id, {
              classification: value,
            });
            cardsRef.current = cardsRef.current.map((c) =>
              c.id === id ? competitor : c,
            );
            recompose();
            void refreshDetailIfLoaded(id);
          } catch {
            // Leave state as the server has it; next poll reconciles.
          }
        })();
      },
      setCompetitorThreat: (id, value) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            const { competitor } = await api.patchCompetitor(productId, id, {
              threatLevel: threatToServer(value),
            });
            cardsRef.current = cardsRef.current.map((c) =>
              c.id === id ? competitor : c,
            );
            recompose();
            void refreshDetailIfLoaded(id);
          } catch {
            // Next poll reconciles.
          }
        })();
      },
      stopTracking: (id) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            await api.deleteCompetitor(productId, id);
            cardsRef.current = cardsRef.current.filter((c) => c.id !== id);
            pendingRunsRef.current.delete(id);
            detailLoadedRef.current.delete(id);
            recompose();
          } catch {
            // Deletion failed — the row stays; next poll reconciles.
          }
        })();
      },
      openAddFlow: () => {
        setState((prev) => ({
          ...prev,
          competitorAddFlow: { ...prev.competitorAddFlow, open: true },
        }));
        // Surface an orphaned proposed row from a previous session rather
        // than letting it linger silently (fetch ?include=proposed).
        const productId = activeProductIdRef.current;
        if (productId && !proposalRunRef.current) {
          void (async () => {
            try {
              const { competitors } = await api.listCompetitors(
                productId,
                true,
              );
              if (activeProductIdRef.current !== productId) {
                return;
              }
              const proposed = competitors.find(
                (card) => card.status === "proposed",
              );
              if (proposed && !proposalRunRef.current) {
                setState((prev) => ({
                  ...prev,
                  competitorAddFlow: {
                    ...prev.competitorAddFlow,
                    orphan: { id: proposed.id, name: proposed.name },
                  },
                }));
              }
            } catch {
              // No orphan surfacing while the server is unreachable.
            }
          })();
        }
      },
      closeAddFlow: () => {
        setState((prev) => ({
          ...prev,
          competitorAddFlow: { ...prev.competitorAddFlow, open: false },
        }));
      },
      setAddFlowMode: (mode) => {
        setState((prev) => ({
          ...prev,
          competitorAddFlow: { ...prev.competitorAddFlow, mode, draft: "" },
        }));
      },
      setAddFlowDraft: (draft) => {
        setState((prev) => ({
          ...prev,
          competitorAddFlow: { ...prev.competitorAddFlow, draft },
        }));
      },
      researchCompetitor: startResearch,
      retryResearch: () => {
        const productId = activeProductIdRef.current;
        const run = proposalRunRef.current;
        if (run && productId) {
          // Re-run enrichment on the existing proposed row (spec 5.1).
          run.settled = false;
          run.seenLabels = [];
          setState((prev) => {
            const { proposal: _proposal, ...flow } = prev.competitorAddFlow;
            return {
              ...prev,
              competitorAddFlow: {
                ...flow,
                phase: "researching",
                stages: [
                  {
                    id: "saved",
                    label: `Checking ${run.name} again…`,
                    status: "running",
                  },
                ],
              },
            };
          });
          void api.refreshCompetitor(productId, run.id).catch(() => {
            // A 409 means a run is already going — the poll picks it up.
          });
          ensurePolling();
          return;
        }
        setState((prev) => ({
          ...prev,
          competitorAddFlow: {
            ...prev.competitorAddFlow,
            phase: "input",
            stages: [],
          },
        }));
        startResearch();
      },
      researchByNameInstead: () => {
        const failure = stateRef.current.competitorAddFlow.failure;
        const guess = failure ? nameFromDomain(failure.domain) : "";
        setState((prev) => ({
          ...prev,
          competitorAddFlow: {
            ...prev.competitorAddFlow,
            mode: "name",
            draft: guess,
            phase: "input",
            stages: [],
          },
        }));
        if (guess) {
          void createCompetitor({ name: guess });
        }
      },
      startManualEntry: () => {
        setState((prev) => ({
          ...prev,
          competitorAddFlow: {
            ...prev.competitorAddFlow,
            phase: "manual",
            stages: [],
          },
        }));
      },
      saveManualCompetitor: ({ name, url }) => {
        const domain = url ? normaliseDomain(url) : null;
        void createCompetitor({
          name,
          ...(domain ? { url: `https://${domain}` } : {}),
        });
      },
      // Optimistic display update while typing; commitProposalName persists.
      setProposalName: (name) => {
        setState((prev) => {
          if (!prev.competitorAddFlow.proposal) {
            return prev;
          }
          const { nameError: _nameError, ...proposal } =
            prev.competitorAddFlow.proposal;
          return {
            ...prev,
            competitorAddFlow: {
              ...prev.competitorAddFlow,
              proposal: { ...proposal, name },
            },
          };
        });
      },
      // Persist the rename when the inline edit commits (blur/Enter) —
      // valid only while the row is proposed; revert quietly on failure.
      commitProposalName: () => {
        const productId = activeProductIdRef.current;
        const proposal = stateRef.current.competitorAddFlow.proposal;
        const run = proposalRunRef.current;
        const id = proposal?.id;
        if (!proposal || !id || !productId) {
          return;
        }
        const persisted = run?.name ?? proposal.name;
        const requested = proposal.name.trim();
        if (!requested || requested === persisted) {
          if (!requested) {
            // An emptied field reverts to the persisted name — no PATCH.
            setState((prev) =>
              prev.competitorAddFlow.proposal
                ? {
                    ...prev,
                    competitorAddFlow: {
                      ...prev.competitorAddFlow,
                      proposal: {
                        ...prev.competitorAddFlow.proposal,
                        name: persisted,
                      },
                    },
                  }
                : prev,
            );
          }
          return;
        }
        void (async () => {
          try {
            const { competitor } = await api.patchCompetitor(productId, id, {
              name: requested,
            });
            if (proposalRunRef.current?.id === id) {
              proposalRunRef.current.name = competitor.name;
            }
            setState((prev) => {
              if (!prev.competitorAddFlow.proposal) {
                return prev;
              }
              const { nameError: _nameError, ...current } =
                prev.competitorAddFlow.proposal;
              return {
                ...prev,
                competitorAddFlow: {
                  ...prev.competitorAddFlow,
                  proposal: { ...current, name: competitor.name },
                },
              };
            });
          } catch (error) {
            const message =
              error instanceof ApiError && error.status === 409
                ? `You’re already tracking a competitor called ${requested}.`
                : error instanceof ApiError
                  ? error.message
                  : "We couldn’t save the name — the local server didn’t answer.";
            setState((prev) =>
              prev.competitorAddFlow.proposal
                ? {
                    ...prev,
                    competitorAddFlow: {
                      ...prev.competitorAddFlow,
                      proposal: {
                        ...prev.competitorAddFlow.proposal,
                        name: persisted,
                        nameError: message,
                      },
                    },
                  }
                : prev,
            );
          }
        })();
      },
      toggleProposalClassification: () => {
        const productId = activeProductIdRef.current;
        const proposal = stateRef.current.competitorAddFlow.proposal;
        const id = proposal?.id;
        if (!proposal || !id || !productId) {
          return;
        }
        const next = proposal.classification === "DIRECT" ? "ADJACENT" : "DIRECT";
        void (async () => {
          try {
            const { competitor } = await api.patchCompetitor(productId, id, {
              classification: next,
            });
            setState((prev) =>
              prev.competitorAddFlow.proposal
                ? {
                    ...prev,
                    competitorAddFlow: {
                      ...prev.competitorAddFlow,
                      proposal: {
                        ...prev.competitorAddFlow.proposal,
                        classification: competitor.classification,
                      },
                    },
                  }
                : prev,
            );
          } catch {
            // Leave the badge as the server has it.
          }
        })();
      },
      acceptProposal: () => {
        const productId = activeProductIdRef.current;
        const id =
          proposalRunRef.current?.id ??
          stateRef.current.competitorAddFlow.proposal?.id;
        if (!id || !productId) {
          return;
        }
        void (async () => {
          try {
            // The human accept is real: only now does the row materialise.
            const { competitor } = await api.acceptCompetitor(productId, id);
            if (activeProductIdRef.current !== productId) {
              return;
            }
            proposalRunRef.current = null;
            cardsRef.current = [
              ...cardsRef.current.filter((c) => c.id !== competitor.id),
              competitor,
            ];
            try {
              const changesRes = await api.listChanges(productId, 50);
              feedRef.current = changesRes.changes;
            } catch {
              // The feed catches up on the next poll.
            }
            setState((prev) => ({
              ...prev,
              competitorAddFlow: { ...initialAddFlow },
            }));
            recompose();
          } catch (error) {
            const line =
              error instanceof ApiError
                ? error.message
                : "We couldn’t reach the local server — is the Discoveree backend running?";
            setState((prev) => ({
              ...prev,
              competitorAddFlow: {
                ...prev.competitorAddFlow,
                phase: "failed",
                stages: [],
                failure: { domain: "", line },
              },
            }));
          }
        })();
      },
      discardProposal: () => {
        const productId = activeProductIdRef.current;
        const flow = stateRef.current.competitorAddFlow;
        const id =
          proposalRunRef.current?.id ?? flow.proposal?.id ?? flow.orphan?.id;
        proposalRunRef.current = null;
        setState((prev) => ({
          ...prev,
          competitorAddFlow: { ...initialAddFlow, open: true },
        }));
        if (id && productId) {
          // Discarding a proposed row deletes it entirely.
          void api.deleteCompetitor(productId, id).catch(() => {
            // Already gone, or unreachable — either way it is not tracked.
          });
        }
      },
      resumeProposal: () => {
        const orphan = stateRef.current.competitorAddFlow.orphan;
        if (!orphan || proposalRunRef.current) {
          return;
        }
        proposalRunRef.current = {
          id: orphan.id,
          name: orphan.name,
          seenLabels: [],
          settled: false,
        };
        setState((prev) => ({
          ...prev,
          competitorAddFlow: {
            ...prev.competitorAddFlow,
            orphan: undefined,
            phase: "researching",
            stages: [
              {
                id: "saved",
                label: `Picking up ${orphan.name} where you left off…`,
                status: "running",
              },
            ],
          },
        }));
        ensurePolling();
        void pollOnce();
      },
      trackOnboardingProposals: () => undefined,
      // ── Customers (ADR 004 §6) ───────────────────────────────────────────
      openFeedbackFlow: (preset) => {
        setState((prev) => {
          const flow: LogFeedbackState = { ...prev.feedbackFlow, open: true };
          delete flow.result;
          delete flow.presetThemeId;
          delete flow.presetSegmentId;
          if (preset?.themeId) {
            flow.presetThemeId = preset.themeId;
          }
          if (preset?.segmentId) {
            flow.presetSegmentId = preset.segmentId;
          }
          return { ...prev, feedbackFlow: flow };
        });
      },
      closeFeedbackFlow: () => {
        setState((prev) => ({
          ...prev,
          feedbackFlow: { ...prev.feedbackFlow, open: false },
        }));
      },
      setFeedbackField: (field, value) => {
        setState((prev) => {
          const flow: LogFeedbackState = {
            ...prev.feedbackFlow,
            [field]: value,
          };
          delete flow.error;
          return { ...prev, feedbackFlow: flow };
        });
      },
      fileFeedback: () => {
        const productId = activeProductIdRef.current;
        const flow = stateRef.current.feedbackFlow;
        const text = flow.draft.trim();
        if (!productId || !text) {
          return;
        }
        // Date discipline: only send a parseable authored-at date; a
        // malformed one is dropped (entry time approximates occurrence)
        // rather than blocking the verbatim on a 400.
        let sourceCreatedAt: string | undefined;
        if (flow.when?.trim() && flow.when.trim().toLowerCase() !== "today") {
          const parsed = new Date(flow.when.trim());
          if (!Number.isNaN(parsed.getTime())) {
            sourceCreatedAt = parsed.toISOString();
          }
        }
        const presetTheme = flow.presetThemeId
          ? customersDataRef.current.themes.find(
              (theme) => theme.id === flow.presetThemeId,
            )
          : undefined;
        void (async () => {
          try {
            const { feedback } = await customersApi.createFeedback(productId, {
              quotedText: text,
              ...(flow.where ? { sourceName: flow.where } : {}),
              ...(presetTheme ? { topic: presetTheme.themeName } : {}),
              ...(sourceCreatedAt ? { sourceCreatedAt } : {}),
            });
            customersDataRef.current.entries = [
              feedback,
              ...customersDataRef.current.entries,
            ];
            customersDataRef.current.unfiledCount += 1;
            setState((prev) => ({
              ...prev,
              feedbackFlow: {
                open: false,
                draft: "",
                result: { kind: "filed" },
              },
            }));
            recomposeCustomers();

            // Matching: run the aggregation pass and watch for the entry to
            // file; settle honestly if it does not (spec 2.3).
            let held = false;
            try {
              await customersApi.aggregateThemes(productId);
            } catch {
              held = true;
            }
            const started = Date.now();
            while (!held && Date.now() - started < 20_000) {
              await new Promise((resolve) => window.setTimeout(resolve, 3000));
              if (activeProductIdRef.current !== productId) {
                return;
              }
              const themesRes = await customersApi.listThemes(productId);
              customersDataRef.current.themes = themesRes.themes;
              customersDataRef.current.unfiledCount = themesRes.unfiledCount;
              const matched = themesRes.themes.find((theme) =>
                theme.feedbackEntryIds.includes(feedback.id),
              );
              if (matched) {
                customersSeenRef.current.add(feedback.id);
                persistCustomersSeen(productId, customersSeenRef.current);
                setState((prev) => ({
                  ...prev,
                  feedbackFlow: {
                    ...prev.feedbackFlow,
                    result: {
                      kind: "matched",
                      themeId: matched.id,
                      themeName: matched.themeName,
                      ordinal: ordinal(matched.mentionCount),
                    },
                  },
                }));
                recomposeCustomers();
                return;
              }
            }
            setState((prev) => ({
              ...prev,
              feedbackFlow: {
                ...prev.feedbackFlow,
                result: held
                  ? { kind: "held" }
                  : {
                      kind: "unfiled",
                      totalThemes: customersDataRef.current.themes.filter(
                        (theme) => theme.status !== "dismissed",
                      ).length,
                      unfiledCount: customersDataRef.current.unfiledCount,
                    },
              },
            }));
            recomposeCustomers();
          } catch (error) {
            const line =
              error instanceof ApiError
                ? error.message
                : "We couldn’t reach the local server — the feedback was not saved. Your words are still here.";
            // The draft is restored: a failed save never loses the verbatim.
            setState((prev) => {
              const flow: LogFeedbackState = {
                ...prev.feedbackFlow,
                open: true,
                draft: text,
                error: line,
              };
              delete flow.result;
              return { ...prev, feedbackFlow: flow };
            });
          }
        })();
      },
      clearFeedbackResult: () => {
        setState((prev) => {
          if (!prev.feedbackFlow.result) {
            return prev;
          }
          const flow = { ...prev.feedbackFlow };
          delete flow.result;
          return { ...prev, feedbackFlow: flow };
        });
      },
      refreshTheme: (id) => {
        const productId = activeProductIdRef.current;
        if (!productId || customersRunsRef.current.has(id)) {
          return;
        }
        void (async () => {
          try {
            await customersApi.aggregateThemes(productId);
          } catch {
            // 409 (already running) still means a pass is under way — poll.
          }
          startCustomersRun("aggregate", id);
        })();
      },
      markThemeSeen: (id) => {
        const theme = customersDataRef.current.themes.find(
          (candidate) => candidate.id === id,
        );
        customersRenamedRef.current.delete(id);
        if (theme) {
          let added = false;
          for (const entryId of theme.feedbackEntryIds) {
            if (!customersSeenRef.current.has(entryId)) {
              customersSeenRef.current.add(entryId);
              added = true;
            }
          }
          if (added) {
            persistCustomersSeen(
              activeProductIdRef.current,
              customersSeenRef.current,
            );
          }
        }
        recomposeCustomers();
      },
      renameTheme: (id, name) => {
        const productId = activeProductIdRef.current;
        const trimmed = name.trim();
        const theme = customersDataRef.current.themes.find(
          (candidate) => candidate.id === id,
        );
        if (!productId || !trimmed || !theme || theme.themeName === trimmed) {
          return;
        }
        void (async () => {
          try {
            const res = await customersApi.patchTheme(productId, id, {
              themeName: trimmed,
            });
            customersRenamedRef.current.set(id, theme.themeName);
            customersDataRef.current.themes =
              customersDataRef.current.themes.map((candidate) =>
                candidate.id === id ? res.theme : candidate,
              );
            recomposeCustomers();
          } catch {
            // Leave the name as the server has it.
          }
        })();
      },
      mergeThemes: (survivorId, absorbedId) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            await customersApi.mergeThemes(productId, survivorId, absorbedId);
            await refreshCustomers();
          } catch {
            // The dialogue closed; state reconciles on the next fetch.
          }
        })();
      },
      retireTheme: (id) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            await customersApi.patchTheme(productId, id, {
              status: "dismissed",
            });
            await refreshCustomers();
          } catch {
            // Reconciles on the next fetch.
          }
        })();
      },
      checkSegment: (id) => {
        const productId = activeProductIdRef.current;
        if (!productId || customersRunsRef.current.has(id)) {
          return;
        }
        // The honest gate: when the evidence pool is below every threshold,
        // render the invitation instead of firing a doomed request.
        const card = customersDataRef.current.segments.find(
          (candidate) => candidate.id === id,
        );
        if (card && card.evidenceStatus.sufficientFor.length === 0) {
          customersNoticesRef.current.set(
            id,
            enrichNoticeFrom(card.evidenceStatus),
          );
          recomposeCustomers();
          return;
        }
        void (async () => {
          try {
            await customersApi.enrichSegment(productId, id);
            startCustomersRun("enrich", id);
          } catch (error) {
            if (error instanceof ApiError && error.status === 422) {
              const payload = error.payload as {
                evidenceStatus?: ServerEvidenceStatus;
              } | null;
              if (payload?.evidenceStatus) {
                customersNoticesRef.current.set(
                  id,
                  enrichNoticeFrom(payload.evidenceStatus),
                );
                recomposeCustomers();
              }
            }
          }
        })();
      },
      markSegmentSeen: () => undefined,
      setSegmentFit: (id, fit) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            const res = await customersApi.patchSegment(productId, id, {
              icpFit: fitToServer(fit),
            });
            customersDataRef.current.segments =
              customersDataRef.current.segments.map((candidate) =>
                candidate.id === id ? res.segment : candidate,
              );
            recomposeCustomers();
            void refreshCustomers(id);
          } catch {
            // Reconciles on the next fetch.
          }
        })();
      },
      setSegmentType: (id, type) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            const res = await customersApi.patchSegment(productId, id, {
              segmentType: typeToServer(type),
            });
            customersDataRef.current.segments =
              customersDataRef.current.segments.map((candidate) =>
                candidate.id === id ? res.segment : candidate,
              );
            recomposeCustomers();
            void refreshCustomers(id);
          } catch {
            // Reconciles on the next fetch.
          }
        })();
      },
      removeSegment: (id) => {
        const productId = activeProductIdRef.current;
        if (!productId) {
          return;
        }
        void (async () => {
          try {
            await customersApi.deleteSegment(productId, id);
            customersDataRef.current.segments =
              customersDataRef.current.segments.filter(
                (candidate) => candidate.id !== id,
              );
            customersDataRef.current.details.delete(id);
            recomposeCustomers();
          } catch {
            // Reconciles on the next fetch.
          }
        })();
      },
      // No live source for onboarding proposals / adoption yet: segment
      // creation flows land with onboarding (the POST + adopted flag is
      // served; the client flow is a later task).
      addSegmentProposals: () => undefined,
      acceptSegmentAdoption: () => undefined,
      dismissSegmentAdoption: () => undefined,
      createProduct: ({ url }) => {
        const domain = normaliseDomain(url);
        if (!domain) {
          setState((prev) => ({
            ...prev,
            productCreate: {
              pending: false,
              error:
                "That doesn’t look like a web address — try something like acme.com.",
            },
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          productCreate: { pending: true, error: null },
        }));
        void (async () => {
          try {
            const { product } = await api.createProduct({
              name: nameFromDomain(domain),
              url: `https://${domain}`,
            });
            productsRef.current = [
              ...productsRef.current.filter((p) => p.id !== product.id),
              product,
            ];
            setState((prev) => ({
              ...prev,
              products: productsRef.current.map((p) => ({
                id: p.id,
                name: p.name,
              })),
              productCreate: { pending: false, error: null },
            }));
            navigateRef.current(productBase(product.id));
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "We couldn’t reach the local server — is the Discoveree backend running?";
            setState((prev) => ({
              ...prev,
              productCreate: { pending: false, error: message },
            }));
          }
        })();
      },
    };

    return Object.assign(live, {
      __switchProduct: switchProduct,
      __loadSettings: loadSettings,
    });
  }, []);

  // The active product is URL state (ADR 003 §1.2): load on mount and
  // reload — dropping the previous product's dataset — whenever it changes.
  useEffect(() => {
    (
      actions as AppActions & {
        __switchProduct: (productId: string | null) => void;
      }
    ).__switchProduct(activeProductId);
  }, [actions, activeProductId]);

  // Settings are org-scoped — loaded once, not per product switch.
  useEffect(() => {
    void (
      actions as AppActions & { __loadSettings: () => Promise<void> }
    ).__loadSettings();
  }, [actions]);

  // Cleanup on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }
      if (tickTimerRef.current !== null) {
        window.clearInterval(tickTimerRef.current);
      }
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
      if (tintTimerRef.current !== null) {
        window.clearTimeout(tintTimerRef.current);
      }
      if (keyTickTimerRef.current !== null) {
        window.clearInterval(keyTickTimerRef.current);
      }
      if (settingsRetryTimerRef.current !== null) {
        window.clearTimeout(settingsRetryTimerRef.current);
      }
      if (customersPollTimerRef.current !== null) {
        window.clearInterval(customersPollTimerRef.current);
      }
      if (customersTickTimerRef.current !== null) {
        window.clearInterval(customersTickTimerRef.current);
      }
      for (const timer of settingsTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  return (
    <AppStateBridge state={state} actions={actions}>
      {children}
    </AppStateBridge>
  );
}
