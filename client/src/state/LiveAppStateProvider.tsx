import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  changeClause,
  freshSinceLabel,
  objectFromDetail,
  objectFromRow,
  proposalFromDetail,
  rowFromCard,
  threatToServer,
  type ServerActiveRun,
  type ServerCompetitorCard,
  type ServerFeedChange,
} from "@/lib/api";
import {
  buildLede,
  initialAddFlow,
  normaliseDomain,
  orderRows,
  type LedeHighlight,
} from "@/mock/competitors";
import type {
  AddStage,
  AppState,
  CompetitorChecking,
  CompetitorRow,
} from "@/mock/types";
import { AppStateBridge, type AppActions } from "./appStateCore";

/**
 * Live provider: the same AppState/AppActions surface as the mock harness,
 * served from the local desktop server (127.0.0.1:7317 behind the /api
 * proxy). Coarse pipeline states come from the server — nothing is
 * fabricated: staged rows reflect the runs the server actually reports.
 */

const VIEW_STORAGE_KEY = "discoveree.competitors.view";
const SEEN_STORAGE_KEY = "discoveree.competitors.seenChanges";
const POLL_MS = 3000;
const OFFLINE_RETRY_MS = 8000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function storedView(): "cards" | "table" {
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === "table" ? "table" : "cards";
}

function loadSeenChangeIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
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

function persistSeenChangeIds(ids: ReadonlySet<string>): void {
  window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...ids]));
}

function nameFromDomain(domain: string): string {
  const stem = domain.split(".")[0] ?? domain;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function makeLiveBaseState(): AppState {
  return {
    productName: "Discoveree",
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
  const [state, setState] = useState<AppState>(makeLiveBaseState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const cardsRef = useRef<ServerCompetitorCard[]>([]);
  const feedRef = useRef<ServerFeedChange[]>([]);
  const seenRef = useRef<Set<string>>(loadSeenChangeIds());
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
      return { agents: "Agents idle", agentsLive: false };
    };

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
            local: "Local · 127.0.0.1:7317",
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
                  view: prev.competitorsOverview?.view ?? storedView(),
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
      if (!detailLoadedRef.current.has(id)) {
        return;
      }
      try {
        const detail = await api.getCompetitor(id);
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
      try {
        const [listRes, activeRes] = await Promise.all([
          api.listCompetitors(),
          api.getActiveRun(),
        ]);
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
            const changesRes = await api.listChanges(50);
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
            const detail = await api.getCompetitor(proposalRun.id);
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
      try {
        const [productRes, listRes, changesRes, activeRes] = await Promise.all([
          api.getProduct(),
          api.listCompetitors(),
          api.listChanges(50),
          api.getActiveRun(),
        ]);
        offlineRef.current = false;
        cardsRef.current = listRes.competitors;
        feedRef.current = changesRes.changes;
        serverActiveRef.current = activeRes;
        setState((prev) => ({
          ...prev,
          productName: productRes.product?.name ?? "Discoveree",
        }));
        recompose();
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
        const { competitor } = await api.createCompetitor({
          ...body,
          classification: "DIRECT",
        });
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

    // ── The actions surface ───────────────────────────────────────────────

    const live: AppActions = {
      setCompetitorsView: (view) => {
        window.localStorage.setItem(VIEW_STORAGE_KEY, view);
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
        if (pendingRunsRef.current.has(id)) {
          return;
        }
        void (async () => {
          try {
            await api.refreshCompetitor(id);
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
          persistSeenChangeIds(seenRef.current);
          recompose();
        }
      },
      ensureCompetitorDetail: (id) => {
        void (async () => {
          try {
            const detail = await api.getCompetitor(id);
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
        void (async () => {
          try {
            const { competitor } = await api.patchCompetitor(id, {
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
        void (async () => {
          try {
            const { competitor } = await api.patchCompetitor(id, {
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
        void (async () => {
          try {
            await api.deleteCompetitor(id);
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
        if (!proposalRunRef.current) {
          void (async () => {
            try {
              const { competitors } = await api.listCompetitors(true);
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
        const run = proposalRunRef.current;
        if (run) {
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
          void api.refreshCompetitor(run.id).catch(() => {
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
        const proposal = stateRef.current.competitorAddFlow.proposal;
        const run = proposalRunRef.current;
        const id = proposal?.id;
        if (!proposal || !id) {
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
            const { competitor } = await api.patchCompetitor(id, {
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
        const proposal = stateRef.current.competitorAddFlow.proposal;
        const id = proposal?.id;
        if (!proposal || !id) {
          return;
        }
        const next = proposal.classification === "DIRECT" ? "ADJACENT" : "DIRECT";
        void (async () => {
          try {
            const { competitor } = await api.patchCompetitor(id, {
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
        const id =
          proposalRunRef.current?.id ??
          stateRef.current.competitorAddFlow.proposal?.id;
        if (!id) {
          return;
        }
        void (async () => {
          try {
            // The human accept is real: only now does the row materialise.
            const { competitor } = await api.acceptCompetitor(id);
            proposalRunRef.current = null;
            cardsRef.current = [
              ...cardsRef.current.filter((c) => c.id !== competitor.id),
              competitor,
            ];
            try {
              const changesRes = await api.listChanges(50);
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
        const flow = stateRef.current.competitorAddFlow;
        const id =
          proposalRunRef.current?.id ?? flow.proposal?.id ?? flow.orphan?.id;
        proposalRunRef.current = null;
        setState((prev) => ({
          ...prev,
          competitorAddFlow: { ...initialAddFlow, open: true },
        }));
        if (id) {
          // Discarding a proposed row deletes it entirely.
          void api.deleteCompetitor(id).catch(() => {
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
    };

    return Object.assign(live, { __loadAll: loadAll });
  }, []);

  // Initial load + cleanup.
  useEffect(() => {
    mountedRef.current = true;
    void (
      actions as AppActions & { __loadAll: () => Promise<void> }
    ).__loadAll();
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
    };
  }, [actions]);

  return (
    <AppStateBridge state={state} actions={actions}>
      {children}
    </AppStateBridge>
  );
}
