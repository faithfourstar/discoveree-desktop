import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearch } from "wouter";
import {
  AppStateBridge,
  useAppActions,
  useAppState,
  type AppActions,
} from "./appStateCore";
import { LiveAppStateProvider } from "./LiveAppStateProvider";
import { competitorsViewKey } from "@/lib/storageKeys";
import { parseProductId, productBase } from "@/lib/productUrl";
import {
  domainFromName,
  formatElapsed,
  initialAddFlow,
  insertionIndex,
  makeAdoptionProposal,
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
import { analyticsProduct, makeAppState, relayProduct } from "@/mock/data";
import type {
  AppState,
  CompetitorObject,
  CompetitorRow,
  MockScenarioKey,
  ProductRef,
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
 * `no-llm-key`, `multi-product`. The choice is sticky across navigation.
 * `multi-product` serves two products: switch to Relay Sync in the top bar
 * and research e.g. mixpanel.com to see the adoption proposal card.
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
  "multi-product",
];

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

function withStoredView(state: AppState, productId: string | null): AppState {
  const keyProduct = productId ?? state.products[0]?.id;
  const stored =
    typeof window === "undefined" || !keyProduct
      ? null
      : window.localStorage.getItem(competitorsViewKey(keyProduct));
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
  const [location, navigate] = useLocation();
  const requestedParam = new URLSearchParams(search).get("state");
  const requested = MOCK_SCENARIOS.find((key) => key === requestedParam);
  const activeProductId = parseProductId(location);

  /** Products created via "Add another product" this session. */
  const extraProductsRef = useRef<ProductRef[]>([]);

  /**
   * Dataset build: the scenario's state for the product in the URL, plus
   * any session-created products (which start empty — day-one competitors,
   * blank home).
   */
  const buildState = (
    scenario: MockScenarioKey,
    productId: string | null,
  ): AppState => {
    const base = makeAppState(scenario, productId ?? undefined);
    const extras = extraProductsRef.current;
    const products = [...base.products, ...extras];
    const extra = productId
      ? extras.find((candidate) => candidate.id === productId)
      : undefined;
    if (extra) {
      return withStoredView(
        {
          ...base,
          products,
          productName: extra.name,
          home: null,
          dayOne: null,
          competitorsOverview: null,
          competitors: {},
          competitorAddFlow: { ...initialAddFlow },
          onboardingProposals: null,
          modules: {
            ...base.modules,
            competitors: { enabled: true, populated: false },
          },
        },
        productId,
      );
    }
    return withStoredView({ ...base, products }, productId);
  };
  const buildStateRef = useRef(buildState);
  buildStateRef.current = buildState;

  const [state, setState] = useState<AppState>(() =>
    buildState(requested ?? "briefing", activeProductId),
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeProductIdRef = useRef(activeProductId);
  activeProductIdRef.current = activeProductId;
  /** The product the current dataset was built for. */
  const builtForProductRef = useRef<string | null>(activeProductId);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

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

      // Multi-product harness: researching from the second product a
      // competitor the first product already tracks short-circuits to the
      // adoption proposal — the entity exists in the org, its profile
      // renders instantly, nothing is re-researched (ADR 003 §2.3).
      if (
        current.mockScenario === "multi-product" &&
        activeProductIdRef.current === relayProduct.id
      ) {
        const stem = domain.split(".")[0] ?? domain;
        const alreadyHere = current.competitorsOverview?.rows.some(
          (row) => (row.domain.split(".")[0] ?? row.domain) === stem,
        );
        const adoption = alreadyHere
          ? null
          : makeAdoptionProposal(domain, analyticsProduct.name);
        if (adoption) {
          setState((prev) => ({
            ...prev,
            competitorAddFlow: {
              ...prev.competitorAddFlow,
              open: true,
              phase: "proposal",
              stages: [],
              proposal: adoption,
            },
          }));
          return;
        }
      }

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

    const persistView = (view: "cards" | "table") => {
      const productId =
        activeProductIdRef.current ?? stateRef.current.products[0]?.id;
      if (productId) {
        window.localStorage.setItem(competitorsViewKey(productId), view);
      }
    };

    return {
      setCompetitorsView: (view) => {
        persistView(view);
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
        persistView(view);
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
        const stem = domain.split(".")[0] ?? domain;
        const name = stem.charAt(0).toUpperCase() + stem.slice(1);
        const taken = new Set([
          ...stateRef.current.products.map((product) => product.id),
          ...extraProductsRef.current.map((product) => product.id),
        ]);
        let id = stem;
        let suffix = 2;
        while (taken.has(id)) {
          id = `${stem}-${suffix}`;
          suffix += 1;
        }
        const product: ProductRef = { id, name };
        extraProductsRef.current = [...extraProductsRef.current, product];
        setState((prev) => ({
          ...prev,
          products: [...prev.products, product],
          productCreate: { pending: false, error: null },
        }));
        navigateRef.current(productBase(id));
      },
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
                      text:
                        rows.length === 1
                          ? ` competitor is now tracked. Its first profile is drafted and its sources are being watched — the next check runs on schedule.`
                          : ` competitors are now tracked. First profiles are drafted and their sources are being watched — the next check runs on schedule.`,
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

  // The initial dataset is built in the state initialiser, so a direct
  // landing on ?state=checking needs its mid-run agents started here
  // (spec 4.2); scenario *switches* start them in the effect below.
  useEffect(() => {
    if (stateRef.current.mockScenario === "checking") {
      window.setTimeout(() => {
        actions.checkCompetitor("competitor:mixpanel");
        actions.checkCompetitor("competitor:posthog");
      }, 0);
    }
  }, [actions]);

  // Scenario switching (dev affordance) and product switching (ADR 003:
  // the dataset follows the product in the URL; switching swaps it cleanly).
  useEffect(() => {
    const scenario = requested ?? stateRef.current.mockScenario;
    const scenarioChanged = scenario !== stateRef.current.mockScenario;
    const productChanged =
      activeProductId !== null &&
      activeProductId !== builtForProductRef.current;
    if (!scenarioChanged && !productChanged) {
      return;
    }
    clearFlowTimers();
    clearCheckInterval();
    const next = buildStateRef.current(scenario, activeProductId);
    builtForProductRef.current = activeProductId;
    baseAgentsRef.current = next.footer.agents;
    setState(next);
    if (scenario === "checking") {
      // Land mid-run: two agents already at work (spec 4.2). Re-kicked on
      // any rebuild so the URL-guard redirect cannot strand a quiet state.
      window.setTimeout(() => {
        actions.checkCompetitor("competitor:mixpanel");
        actions.checkCompetitor("competitor:posthog");
      }, 0);
    }
  }, [requested, activeProductId, actions]);

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
