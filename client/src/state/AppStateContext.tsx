import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearch } from "wouter";
import {
  AppStateBridge,
  useAppActions,
  useAppState,
  type AppActions,
} from "./appStateCore";
import { LiveAppStateProvider } from "./LiveAppStateProvider";
import {
  domainFromName,
  formatElapsed,
  initialAddFlow,
  insertionIndex,
  makeProposal,
  makeStageScripts,
  makeStages,
  makeUnreachableFailure,
  normaliseDomain,
  objectFromProposal,
  orderRows,
  rowFromProposal,
  rowFromProposalSeed,
  deriveObjectFromRow,
  type ResearchStageScript,
} from "@/mock/competitors";
import { makeAppState } from "@/mock/data";
import type {
  AppState,
  CompetitorObject,
  CompetitorRow,
  MockScenarioKey,
  RichText,
} from "@/mock/types";

/**
 * Serves the current app state and its actions to the shell and pages.
 * Today it selects between mock datasets and simulates agent pipelines with
 * timers; the server wiring later replaces this provider's data source and
 * action implementations without touching any component.
 *
 * Dev affordance: `?state=` switches datasets — `briefing` (default),
 * `day-one`, `proposals`, `many`, `quiet`, `checking`, `no-search-key`,
 * `no-llm-key`. The choice is sticky across navigation.
 */

const MOCK_SCENARIOS: readonly MockScenarioKey[] = [
  "briefing",
  "day-one",
  "proposals",
  "many",
  "quiet",
  "checking",
  "no-search-key",
  "no-llm-key",
];

const VIEW_STORAGE_KEY = "discoveree.competitors.view";
const CHECK_DURATION_S = 8;

// ---------------------------------------------------------------------------
// Pure state helpers
// ---------------------------------------------------------------------------

function todayShort(): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date());
}

function withStoredView(state: AppState): AppState {
  const stored =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(VIEW_STORAGE_KEY);
  if (
    (stored === "cards" || stored === "table") &&
    state.competitorsOverview &&
    state.competitorsOverview.view !== stored
  ) {
    return {
      ...state,
      competitorsOverview: { ...state.competitorsOverview, view: stored },
    };
  }
  return state;
}

function updateRow(
  state: AppState,
  id: string,
  update: (row: CompetitorRow) => CompetitorRow,
): AppState {
  if (!state.competitorsOverview) {
    return state;
  }
  return {
    ...state,
    competitorsOverview: {
      ...state.competitorsOverview,
      rows: state.competitorsOverview.rows.map((row) =>
        row.id === id ? update(row) : row,
      ),
    },
  };
}

function updateObject(
  state: AppState,
  id: string,
  update: (object: CompetitorObject) => CompetitorObject,
): AppState {
  const object = state.competitors[id];
  if (!object) {
    return state;
  }
  return {
    ...state,
    competitors: { ...state.competitors, [id]: update(object) },
  };
}

/** The lede for the very first tracked competitor (day one → one real row). */
function firstCompetitorLede(row: CompetitorRow): RichText {
  return [
    { text: row.name, tone: "link", objectId: row.id },
    {
      text: " is now tracked. The profile is verified and its sources are being watched — the next check runs on schedule.",
    },
  ];
}

/** Insert an accepted row at its threat position and register its object. */
function addCompetitor(
  state: AppState,
  row: CompetitorRow,
  object: CompetitorObject,
): AppState {
  const next: AppState = {
    ...state,
    competitors: { ...state.competitors, [object.id]: object },
    competitorAddFlow: { ...initialAddFlow },
  };
  if (next.competitorsOverview) {
    const rows = [...next.competitorsOverview.rows];
    rows.splice(insertionIndex(rows, row), 0, row);
    next.competitorsOverview = { ...next.competitorsOverview, rows };
  } else {
    // Day one — the first saved competitor swaps the page to the standard
    // Overview with one real row (spec 2.5).
    next.competitorsOverview = {
      lede: firstCompetitorLede(row),
      rows: [row],
      view: "cards",
      searchKeyMissing: false,
    };
    next.modules = {
      ...next.modules,
      competitors: { ...next.modules.competitors, populated: true },
    };
    next.footer = {
      ...next.footer,
      agents: "Agents · next competitor check Thu 09:00",
    };
    next.onboardingProposals = null;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Mock provider — the dev/design harness behind `?state=`
// ---------------------------------------------------------------------------

export function MockAppStateProvider({ children }: { children: ReactNode }) {
  const search = useSearch();
  const requestedParam = new URLSearchParams(search).get("state");
  const requested = MOCK_SCENARIOS.find((key) => key === requestedParam);
  const [state, setState] = useState<AppState>(() =>
    withStoredView(makeAppState("briefing")),
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Base agents footer segment, restored when a run completes. */
  const baseAgentsRef = useRef<string | undefined>(state.footer.agents);
  const checkIntervalRef = useRef<number | null>(null);
  const flowTimersRef = useRef<number[]>([]);
  const tintTimerRef = useRef<number | null>(null);

  const clearFlowTimers = () => {
    for (const timer of flowTimersRef.current) {
      window.clearTimeout(timer);
    }
    flowTimersRef.current = [];
  };

  const clearCheckInterval = () => {
    if (checkIntervalRef.current !== null) {
      window.clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
  };

  const actions = useMemo<AppActions>(() => {
    const schedule = (delay: number, run: () => void) => {
      const timer = window.setTimeout(run, delay);
      flowTimersRef.current.push(timer);
    };

    /** One competitor's run completes (spec 4.3). */
    const completeCheck = (id: string) => {
      setState((current) => {
        const overview = current.competitorsOverview;
        if (!overview) {
          return current;
        }
        const checking = (overview.checking ?? []).filter(
          (entry) => entry.id !== id,
        );
        const row = overview.rows.find((candidate) => candidate.id === id);
        const changeDetected = row?.stale === true;
        let next: AppState = {
          ...current,
          justVerifiedId: id,
          competitorsOverview: {
            ...overview,
            checking,
          },
        };
        next = updateRow(next, id, (existing) => {
          const updated: CompetitorRow = {
            ...existing,
            stale: false,
            verifiedOrder: 0,
          };
          delete updated.staleDays;
          delete updated.lastRunFailed;
          delete updated.unverified;
          if (changeDetected) {
            updated.verifiedAgo = "just now";
            updated.change = {
              line: `Usage-based pricing has been replaced by seat pricing on ${existing.domain}.`,
              evidence: [
                {
                  id: `ev:${existing.id}-pricing-diff`,
                  kind: "source",
                  label: "1 source",
                  count: 1,
                  objectId: `source:${existing.domain}-pricing-diff`,
                },
              ],
              unseen: true,
            };
            delete updated.confirmedQuietSince;
          } else {
            // Confirmed stillness is a normal, valuable result (spec 5.2).
            updated.verifiedAgo = "just now · nothing changed";
            if (!updated.change) {
              updated.confirmedQuietSince = todayShort();
            }
          }
          return updated;
        });
        next = updateObject(next, id, (object) => {
          const updated: CompetitorObject = {
            ...object,
            verifiedAgo: changeDetected ? "just now" : "just now · nothing changed",
          };
          delete updated.stale;
          delete updated.staleDays;
          delete updated.lastRunFailed;
          if (changeDetected) {
            updated.summary = `Usage-based pricing has been replaced by seat pricing on ${object.domain}. The pricing page rewrite landed since the last verification.`;
            updated.changeUnseen = true;
            updated.changeEvidence = [
              {
                id: `ev:${object.id}-pricing-diff`,
                kind: "source",
                label: "1 source",
                count: 1,
                objectId: `source:${object.domain}-pricing-diff`,
              },
            ];
          }
          return updated;
        });
        if (checking.length === 0) {
          next = {
            ...next,
            footer: {
              ...next.footer,
              agents: baseAgentsRef.current,
              agentsLive: false,
            },
          };
        }
        return next;
      });
      if (tintTimerRef.current !== null) {
        window.clearTimeout(tintTimerRef.current);
      }
      tintTimerRef.current = window.setTimeout(() => {
        setState((current) => ({ ...current, justVerifiedId: null }));
      }, 1500);
    };

    const tick = () => {
      // Decide completions from the latest rendered state, not inside the
      // updater — updaters must stay side-effect free.
      const entries =
        stateRef.current.competitorsOverview?.checking ?? [];
      if (entries.length === 0) {
        return;
      }
      const finished = entries
        .filter((entry) => entry.elapsedS + 1 >= CHECK_DURATION_S)
        .map((entry) => entry.id);
      setState((current) => {
        const overview = current.competitorsOverview;
        if (!overview || !overview.checking || overview.checking.length === 0) {
          return current;
        }
        const checking = overview.checking.map((entry) => ({
          ...entry,
          elapsedS: entry.elapsedS + 1,
        }));
        const names = checking.map((entry) => entry.name).join(" and ");
        const longest = checking.reduce(
          (max, entry) => Math.max(max, entry.elapsedS),
          0,
        );
        return {
          ...current,
          competitorsOverview: { ...overview, checking },
          footer: {
            ...current.footer,
            agents: `Agents · checking ${names} · ${formatElapsed(longest)}`,
            agentsLive: true,
          },
        };
      });
      for (const id of finished) {
        completeCheck(id);
      }
    };

    const startCheck = (id: string) => {
      const current = stateRef.current;
      if (current.agentsPaused) {
        return; // Home owns the no-LLM-key message (spec 5.3).
      }
      const overview = current.competitorsOverview;
      const row = overview?.rows.find((candidate) => candidate.id === id);
      if (!overview || !row) {
        return;
      }
      if ((overview.checking ?? []).some((entry) => entry.id === id)) {
        return;
      }
      setState((prev) => {
        const prevOverview = prev.competitorsOverview;
        if (!prevOverview) {
          return prev;
        }
        const checking = [
          ...(prevOverview.checking ?? []),
          { id, name: row.name, elapsedS: 0 },
        ];
        const names = checking.map((entry) => entry.name).join(" and ");
        return {
          ...prev,
          competitorsOverview: { ...prevOverview, checking },
          footer: {
            ...prev.footer,
            agents: `Agents · checking ${names} · 0:00`,
            agentsLive: true,
          },
        };
      });
      if (checkIntervalRef.current === null) {
        checkIntervalRef.current = window.setInterval(tick, 1000);
      }
    };

    /** Step through the 2.3 staged pipeline (mock timings, real-event shape). */
    const runResearch = (domain: string, options?: { neverFail?: boolean }) => {
      clearFlowTimers();
      const current = stateRef.current;
      const searchKeyMissing =
        current.competitorsOverview?.searchKeyMissing ?? false;
      const scripts = makeStageScripts(domain, searchKeyMissing);
      const shouldFail = !options?.neverFail && domain.includes("fail");

      setState((prev) => ({
        ...prev,
        competitorAddFlow: {
          ...prev.competitorAddFlow,
          open: true,
          phase: "researching",
          stages: makeStages(scripts, 0, 0),
        },
      }));

      if (shouldFail) {
        schedule(1600, () => {
          setState((prev) => ({
            ...prev,
            competitorAddFlow: {
              ...prev.competitorAddFlow,
              phase: "failed",
              stages: [],
              failure: makeUnreachableFailure(domain),
            },
          }));
        });
        return;
      }

      const stepDelays = [1400, 1500, 1600, 1300, 1200];
      let elapsed = 0;
      scripts.forEach((script: ResearchStageScript, index: number) => {
        const delay = script.skipped ? 250 : (stepDelays[index] ?? 1300);
        elapsed += delay;
        const completed = index + 1;
        schedule(elapsed, () => {
          setState((prev) => {
            if (prev.competitorAddFlow.phase !== "researching") {
              return prev;
            }
            if (completed === scripts.length) {
              return {
                ...prev,
                competitorAddFlow: {
                  ...prev.competitorAddFlow,
                  phase: "proposal",
                  stages: makeStages(scripts, completed, null),
                  proposal: makeProposal(
                    domain,
                    prev.competitorsOverview?.searchKeyMissing ?? false,
                  ),
                },
              };
            }
            return {
              ...prev,
              competitorAddFlow: {
                ...prev.competitorAddFlow,
                stages: makeStages(scripts, completed, completed),
              },
            };
          });
        });
      });
    };

    return {
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
      checkCompetitor: startCheck,
      // Mock objects are pre-loaded with the dataset — nothing to fetch.
      ensureCompetitorDetail: () => undefined,
      markCompetitorSeen: (id) => {
        setState((prev) => {
          let next = updateRow(prev, id, (row) =>
            row.change?.unseen
              ? { ...row, change: { ...row.change, unseen: false } }
              : row,
          );
          next = updateObject(next, id, (object) =>
            object.changeUnseen ? { ...object, changeUnseen: false } : object,
          );
          return next;
        });
      },
      setCompetitorClassification: (id, value) => {
        setState((prev) => {
          let next = updateRow(prev, id, (row) => ({
            ...row,
            classification: value,
          }));
          next = updateObject(next, id, (object) => ({
            ...object,
            classification: value,
          }));
          return next;
        });
      },
      setCompetitorThreat: (id, value) => {
        setState((prev) => {
          let next = updateRow(prev, id, (row) => ({ ...row, threat: value }));
          next = updateObject(next, id, (object) => ({
            ...object,
            threat: value,
          }));
          return next;
        });
      },
      stopTracking: (id) => {
        setState((prev) => {
          const overview = prev.competitorsOverview;
          if (!overview) {
            return prev;
          }
          const rows = overview.rows.filter((row) => row.id !== id);
          const competitors = { ...prev.competitors };
          delete competitors[id];
          if (rows.length === 0) {
            return {
              ...prev,
              competitors,
              competitorsOverview: null,
              modules: {
                ...prev.modules,
                competitors: { ...prev.modules.competitors, populated: false },
              },
            };
          }
          return {
            ...prev,
            competitors,
            competitorsOverview: { ...overview, rows },
          };
        });
      },
      openAddFlow: () => {
        setState((prev) => ({
          ...prev,
          competitorAddFlow: { ...prev.competitorAddFlow, open: true },
        }));
      },
      closeAddFlow: () => {
        // Collapse hides the section without losing typed input — a running
        // research pipeline carries on and is restored on reopen.
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
      researchCompetitor: () => {
        const flow = stateRef.current.competitorAddFlow;
        const domain =
          flow.mode === "url"
            ? normaliseDomain(flow.draft)
            : flow.draft.trim()
              ? domainFromName(flow.draft)
              : null;
        if (!domain) {
          return;
        }
        runResearch(domain, flow.mode === "name" ? { neverFail: true } : {});
      },
      retryResearch: () => {
        const failure = stateRef.current.competitorAddFlow.failure;
        if (failure) {
          runResearch(failure.domain);
        }
      },
      researchByNameInstead: () => {
        const failure = stateRef.current.competitorAddFlow.failure;
        if (failure) {
          runResearch(failure.domain, { neverFail: true });
        }
      },
      startManualEntry: () => {
        clearFlowTimers();
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
        const domain =
          (url ? normaliseDomain(url) : null) ?? domainFromName(name);
        const row: CompetitorRow = {
          id: `competitor:${domain.split(".")[0] ?? domain}`,
          name,
          classification: "DIRECT",
          domain,
          threat: "watch",
          verifiedAgo: "added by hand · not yet verified",
          stale: false,
          verifiedOrder: Number.MAX_SAFE_INTEGER,
          unverified: true,
        };
        const object = deriveObjectFromRow(row);
        object.verifiedAgo = "added by hand · not yet verified";
        setState((prev) => addCompetitor(prev, row, object));
      },
      // Mock proposals live only in memory — nothing to persist on commit.
      commitProposalName: () => undefined,
      setProposalName: (name) => {
        setState((prev) =>
          prev.competitorAddFlow.proposal
            ? {
                ...prev,
                competitorAddFlow: {
                  ...prev.competitorAddFlow,
                  proposal: { ...prev.competitorAddFlow.proposal, name },
                },
              }
            : prev,
        );
      },
      toggleProposalClassification: () => {
        setState((prev) =>
          prev.competitorAddFlow.proposal
            ? {
                ...prev,
                competitorAddFlow: {
                  ...prev.competitorAddFlow,
                  proposal: {
                    ...prev.competitorAddFlow.proposal,
                    classification:
                      prev.competitorAddFlow.proposal.classification ===
                      "DIRECT"
                        ? "ADJACENT"
                        : "DIRECT",
                  },
                },
              }
            : prev,
        );
      },
      acceptProposal: () => {
        const proposal = stateRef.current.competitorAddFlow.proposal;
        if (!proposal) {
          return;
        }
        const row = rowFromProposal(proposal);
        const object = objectFromProposal(proposal);
        setState((prev) => addCompetitor(prev, row, object));
      },
      discardProposal: () => {
        setState((prev) => ({
          ...prev,
          competitorAddFlow: { ...initialAddFlow, open: true },
        }));
      },
      // Orphaned proposals are a live-mode concern; mocks have none.
      resumeProposal: () => undefined,
      trackOnboardingProposals: (ids) => {
        setState((prev) => {
          const seeds = (prev.onboardingProposals ?? []).filter((seed) =>
            ids.includes(seed.id),
          );
          if (seeds.length === 0) {
            return prev;
          }
          const rows = orderRows(seeds.map(rowFromProposalSeed));
          const competitors = { ...prev.competitors };
          for (const row of rows) {
            competitors[row.id] = deriveObjectFromRow(row);
          }
          const first = rows[0];
          return {
            ...prev,
            competitors,
            competitorsOverview: {
              lede: first
                ? [
                    { text: String(rows.length), tone: "mono" },
                    {
                      text: ` competitors are now tracked. First profiles are drafted and their sources are being watched — the next check runs on schedule.`,
                    },
                  ]
                : [],
              rows,
              view: "cards",
              searchKeyMissing: false,
            },
            modules: {
              ...prev.modules,
              competitors: { ...prev.modules.competitors, populated: true },
            },
            footer: {
              ...prev.footer,
              agents: "Agents · next competitor check Thu 09:00",
            },
            onboardingProposals: null,
          };
        });
      },
    };
  }, []);

  // Scenario switching (dev affordance).
  useEffect(() => {
    if (!requested || requested === stateRef.current.mockScenario) {
      return;
    }
    clearFlowTimers();
    clearCheckInterval();
    const next = withStoredView(makeAppState(requested));
    baseAgentsRef.current = next.footer.agents;
    setState(next);
    if (requested === "checking") {
      // Land mid-run: two agents already at work (spec 4.2).
      window.setTimeout(() => {
        actions.checkCompetitor("competitor:mixpanel");
        actions.checkCompetitor("competitor:posthog");
      }, 0);
    }
  }, [requested, actions]);

  // Stop the shared interval when nothing is being checked.
  useEffect(() => {
    const checking = state.competitorsOverview?.checking ?? [];
    if (checking.length === 0) {
      clearCheckInterval();
    }
  }, [state]);

  // Clear all timers on unmount.
  useEffect(
    () => () => {
      clearFlowTimers();
      clearCheckInterval();
      if (tintTimerRef.current !== null) {
        window.clearTimeout(tintTimerRef.current);
      }
    },
    [],
  );

  return (
    <AppStateBridge state={state} actions={actions}>
      {children}
    </AppStateBridge>
  );
}

// ---------------------------------------------------------------------------
// Mode selection — `?state=` present ⇒ mock harness, otherwise live API
// ---------------------------------------------------------------------------

/**
 * Once a `?state=` parameter has been seen, mock mode latches for the rest of
 * the session (in-app navigation drops query params; a full reload without
 * the parameter returns to live mode).
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const search = useSearch();
  const hasStateParam = new URLSearchParams(search).has("state");
  const [mockMode, setMockMode] = useState(hasStateParam);

  useEffect(() => {
    if (hasStateParam) {
      setMockMode(true);
    }
  }, [hasStateParam]);

  if (mockMode) {
    return <MockAppStateProvider>{children}</MockAppStateProvider>;
  }
  return <LiveAppStateProvider>{children}</LiveAppStateProvider>;
}

// Re-exports so existing imports keep working across the seam.
export { useAppActions, useAppState };
export type { AppActions };
