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
import { ordinal, orderSegments, segmentFromName } from "@/mock/customers";
import { analyticsProduct, makeAppState, relayProduct } from "@/mock/data";
import {
  agentMeta,
  hasAnyKey,
  hasSearchKey,
  makeMask,
  mockValidateLicenceKey,
  nextRunFrom,
} from "@/mock/settings";
import type {
  AgentScheduleRow,
  AppState,
  CompetitorObject,
  CompetitorRow,
  FeedbackItemRef,
  LlmKeyRow,
  LogFeedbackState,
  MockScenarioKey,
  ProductRef,
  ProviderId,
  RichText,
  SegmentObject,
  SegmentRow,
  SettingsState,
  ThemeObject,
  ThemeRow,
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
  "settings-trial",
  "settings-trial-ending",
  "settings-reading-only",
  "settings-paused",
  "settings-minimal",
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
  /** One shared ticker for settings elapsed counters (key tests, agent runs). */
  const settingsIntervalRef = useRef<number | null>(null);

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

  const clearSettingsInterval = () => {
    if (settingsIntervalRef.current !== null) {
      window.clearInterval(settingsIntervalRef.current);
      settingsIntervalRef.current = null;
    }
  };

  // ── Customers — refresh/check simulation (customers spec 7.1/7.4) ─────────
  const customersIntervalRef = useRef<number | null>(null);

  const clearCustomersInterval = () => {
    if (customersIntervalRef.current !== null) {
      window.clearInterval(customersIntervalRef.current);
      customersIntervalRef.current = null;
    }
  };

  /** One run settles: stamps to "just now", stale themes yield movement. */
  const settleCustomersCheck = (id: string) => {
    setState((prev) => {
      const overview = prev.customersOverview;
      if (!overview) {
        return prev;
      }
      const checking = prev.customersChecking.filter(
        (entry) => entry.id !== id,
      );
      let next: AppState = { ...prev, customersChecking: checking, justVerifiedId: id };

      if (id.startsWith("theme:")) {
        const row = overview.themes.find((theme) => theme.id === id);
        const movement = row?.stale === true;
        next = {
          ...next,
          customersOverview: {
            ...overview,
            themes: overview.themes.map((theme) => {
              if (theme.id !== id) {
                return theme;
              }
              const updated: ThemeRow = { ...theme, stale: false };
              delete updated.staleDays;
              if (movement) {
                updated.refreshedAgo = "just now";
                updated.mentionCount = theme.mentionCount + 2;
                updated.change = {
                  line: "Two new mentions filed while it slept — both about renewal terms.",
                  evidence: [
                    {
                      id: `ev:${id}-new-mentions`,
                      kind: "feedback",
                      label: "2 mentions",
                      count: 2,
                      objectId: id,
                    },
                  ],
                  unseen: true,
                };
                delete updated.quietSince;
              } else {
                updated.refreshedAgo = "just now · nothing new";
              }
              return updated;
            }),
          },
        };
        const object = prev.themes[id];
        if (object) {
          const updated: ThemeObject = {
            ...object,
            refreshedAgo: movement ? "just now" : "just now · nothing new",
          };
          delete updated.stale;
          delete updated.staleDays;
          if (movement) {
            updated.mentionCount = object.mentionCount + 2;
            updated.summary =
              "Two new mentions filed while it slept — both about renewal terms.";
            updated.changeUnseen = true;
          }
          next = { ...next, themes: { ...prev.themes, [id]: updated } };
        }
      } else {
        const row = overview.segments.find((segment) => segment.id === id);
        const movement = row?.stale === true;
        next = {
          ...next,
          customersOverview: {
            ...overview,
            segments: overview.segments.map((segment) => {
              if (segment.id !== id) {
                return segment;
              }
              const updated: SegmentRow = { ...segment, stale: false };
              delete updated.staleDays;
              updated.verifiedAgo = movement
                ? "just now"
                : "just now · nothing changed";
              return updated;
            }),
          },
        };
        const object = prev.segments[id];
        if (object) {
          const updated: SegmentObject = {
            ...object,
            verifiedAgo: movement ? "just now" : "just now · nothing changed",
          };
          delete updated.stale;
          delete updated.staleDays;
          if (movement) {
            updated.summary =
              "Verified against a month of new feedback — ten warehouse-sync mentions moved this segment's centre of gravity.";
            updated.changeUnseen = true;
          }
          next = { ...next, segments: { ...prev.segments, [id]: updated } };
        }
      }

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

  const customersTick = () => {
    const entries = stateRef.current.customersChecking;
    if (entries.length === 0) {
      clearCustomersInterval();
      return;
    }
    const finished = entries
      .filter((entry) => entry.elapsedS + 1 >= 6)
      .map((entry) => entry.id);
    setState((prev) => {
      const ticked = prev.customersChecking.map((entry) => ({
        ...entry,
        elapsedS: entry.elapsedS + 1,
      }));
      const longest = ticked.reduce(
        (max, entry) => Math.max(max, entry.elapsedS),
        0,
      );
      return {
        ...prev,
        customersChecking: ticked,
        footer: {
          ...prev.footer,
          agents: `Agents · reading feedback · ${formatElapsed(longest)}`,
          agentsLive: true,
        },
      };
    });
    for (const id of finished) {
      settleCustomersCheck(id);
    }
  };

  const startCustomersCheck = (id: string) => {
    if (stateRef.current.agentsPaused) {
      return; // Home owns the no-LLM-key message (customers spec 7.3).
    }
    if (stateRef.current.customersChecking.some((entry) => entry.id === id)) {
      return;
    }
    setState((prev) => ({
      ...prev,
      customersChecking: [...prev.customersChecking, { id, elapsedS: 0 }],
      footer: {
        ...prev.footer,
        agents: "Agents · reading feedback · 0:00",
        agentsLive: true,
      },
    }));
    if (customersIntervalRef.current === null) {
      customersIntervalRef.current = window.setInterval(customersTick, 1000);
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

    // ── Settings (mock harness for the Settings page) ─────────────────────

    const updateSettings = (
      update: (settings: SettingsState) => SettingsState,
    ) => {
      setState((prev) =>
        prev.settings ? { ...prev, settings: update(prev.settings) } : prev,
      );
    };

    const updateKeyRow = (
      provider: ProviderId,
      update: (row: LlmKeyRow) => LlmKeyRow,
    ) => {
      updateSettings((settings) => ({
        ...settings,
        llmKeys: settings.llmKeys.map((row) =>
          row.provider === provider ? update(row) : row,
        ),
      }));
    };

    const updateAgentRow = (
      id: string,
      update: (row: AgentScheduleRow) => AgentScheduleRow,
    ) => {
      updateSettings((settings) => ({
        ...settings,
        schedules: {
          ...settings.schedules,
          rows: settings.schedules.rows.map((row) =>
            row.id === id ? update(row) : row,
          ),
        },
      }));
    };

    /** Tick every in-flight settings counter; mirror agent runs in the footer. */
    const settingsTick = () => {
      const settings = stateRef.current.settings;
      if (!settings) {
        return;
      }
      const anyTesting = settings.llmKeys.some((row) => row.testing);
      const runningRows = settings.schedules.rows.filter((row) => row.running);
      if (!anyTesting && runningRows.length === 0) {
        clearSettingsInterval();
        return;
      }
      setState((prev) => {
        if (!prev.settings) {
          return prev;
        }
        const rows = prev.settings.schedules.rows.map((row) =>
          row.running
            ? { ...row, running: { elapsedS: row.running.elapsedS + 1 } }
            : row,
        );
        const running = rows.filter((row) => row.running);
        const next: AppState = {
          ...prev,
          settings: {
            ...prev.settings,
            llmKeys: prev.settings.llmKeys.map((row) =>
              row.testing
                ? { ...row, testing: { elapsedS: row.testing.elapsedS + 1 } }
                : row,
            ),
            schedules: { ...prev.settings.schedules, rows },
          },
        };
        if (running.length > 0) {
          const longest = running.reduce(
            (max, row) => Math.max(max, row.running?.elapsedS ?? 0),
            0,
          );
          next.footer = {
            ...next.footer,
            agents: `Agents · running ${running
              .map((row) => row.name)
              .join(" and ")} · ${formatElapsed(longest)}`,
            agentsLive: true,
          };
        }
        return next;
      });
    };

    const ensureSettingsTicker = () => {
      if (settingsIntervalRef.current === null) {
        settingsIntervalRef.current = window.setInterval(settingsTick, 1000);
      }
    };

    /**
     * Scripted key-test verdicts (mock only): a typed key containing
     * "invalid" is rejected by the provider; "unreach" makes the provider
     * unreachable (network — no verdict); "400" has the provider answer
     * with an error; "429" rate-limits the check; anything else answers.
     */
    const resolveKeyTest = (provider: ProviderId, typedKey: string | null) => {
      const scripted = typedKey ?? "";
      const outcome: NonNullable<LlmKeyRow["testResult"]> = scripted.includes(
        "invalid",
      )
        ? { kind: "invalid" }
        : scripted.includes("unreach")
          ? { kind: "unreachable" }
          : scripted.includes("400")
            ? { kind: "provider-error", detail: "HTTP 400 Bad Request" }
            : scripted.includes("429")
              ? { kind: "rate-limited" }
              : { kind: "works", answeredInS: 1.8 };
      const kind = outcome.kind;
      setState((prev) => {
        if (!prev.settings) {
          return prev;
        }
        let becameAble = false;
        const llmKeys = prev.settings.llmKeys.map((row) => {
          if (row.provider !== provider) {
            return row;
          }
          const next: LlmKeyRow = { ...row };
          delete next.testing;
          next.testResult = outcome;
          if (kind === "works") {
            if (next.saved) {
              next.saved = {
                ...next.saved,
                verified: true,
                lastUsedAgo: "just now",
              };
            }
            becameAble = true;
          } else if (next.saved) {
            // Everything else keeps the key saved and unverified: rejected
            // keys stay until the user acts (2.4); non-verdicts judge nothing.
            next.saved = { ...next.saved, verified: false };
          }
          return next;
        });
        let next: AppState = {
          ...prev,
          settings: { ...prev.settings, llmKeys },
        };
        if (becameAble) {
          // A working key unpauses agents / restores search-fed work.
          if (next.agentsPaused) {
            next = {
              ...next,
              agentsPaused: false,
              footer: {
                ...next.footer,
                agents: "Agents idle · next run 21:00",
              },
            };
          }
          if (next.competitorsOverview && hasSearchKey(llmKeys)) {
            next = {
              ...next,
              competitorsOverview: {
                ...next.competitorsOverview,
                searchKeyMissing: false,
              },
            };
          }
        }
        return next;
      });
      if (kind === "works") {
        // The ✓ settles back to the normal key line after 5 s (2.4).
        schedule(5000, () => {
          updateKeyRow(provider, (row) => {
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

    const finishAgentRun = (id: string) => {
      setState((prev) => {
        if (!prev.settings) {
          return prev;
        }
        const rows = prev.settings.schedules.rows.map((row) => {
          if (row.id !== id) {
            return row;
          }
          const recomputed =
            row.weeklyAt && row.frequency === "weekly"
              ? {
                  nextRun: `${row.weeklyAt.day} ${row.weeklyAt.time}`,
                  nextRunSortKey: Date.now() + 7 * 24 * 60 * 60 * 1000,
                }
              : nextRunFrom(row.frequency);
          const findings =
            id === "feedback-gathering" ? 12 : id === "competitor-check" ? 2 : 0;
          const next: AgentScheduleRow = {
            ...row,
            lastRun: { at: "just now", findings },
            ...(recomputed ?? {}),
          };
          delete next.running;
          return next;
        });
        const stillRunning = rows.some((row) => row.running);
        return {
          ...prev,
          settings: {
            ...prev.settings,
            schedules: { ...prev.settings.schedules, rows },
          },
          footer: stillRunning
            ? prev.footer
            : {
                ...prev.footer,
                agents: baseAgentsRef.current,
                agentsLive: false,
              },
        };
      });
    };

    const setAgentFrequency = (
      id: string,
      frequency: AgentScheduleRow["frequency"],
    ) => {
      updateAgentRow(id, (row) => {
        if (frequency === "off") {
          // Per-agent pause is frequency "off" (server contract); remember
          // what Resume should restore.
          const next: AgentScheduleRow = { ...row, frequency };
          if (row.frequency !== "off" && row.frequency !== "after-gathering") {
            next.pausedFrom = row.frequency;
          }
          delete next.nextRun;
          delete next.nextRunSortKey;
          return next;
        }
        const recomputed =
          row.weeklyAt && frequency === "weekly"
            ? {
                nextRun: `${row.weeklyAt.day} ${row.weeklyAt.time}`,
                nextRunSortKey: Date.now() + 7 * 24 * 60 * 60 * 1000,
              }
            : nextRunFrom(frequency);
        const next: AgentScheduleRow = {
          ...row,
          frequency,
          ...(recomputed ?? {}),
        };
        delete next.pausedFrom;
        return next;
      });
    };

    const settingsActions = {
      saveLlmKey: (provider: ProviderId, key: string) => {
        const typed = key.trim();
        if (!typed) {
          return;
        }
        updateKeyRow(provider, (row) => {
          const next: LlmKeyRow = {
            ...row,
            saved: {
              mask: makeMask(provider, typed),
              addedAt: todayShort(),
              verified: false,
            },
            testing: { elapsedS: 0 },
          };
          delete next.testResult;
          return next;
        });
        ensureSettingsTicker();
        schedule(2400, () => resolveKeyTest(provider, typed));
      },
      testLlmKey: (provider: ProviderId) => {
        const row = stateRef.current.settings?.llmKeys.find(
          (candidate) => candidate.provider === provider,
        );
        if (!row?.saved || row.testing) {
          return;
        }
        updateKeyRow(provider, (existing) => {
          const next: LlmKeyRow = { ...existing, testing: { elapsedS: 0 } };
          delete next.testResult;
          return next;
        });
        ensureSettingsTicker();
        // Stored keys answer in the harness; failures are scripted on entry.
        schedule(2100, () => resolveKeyTest(provider, null));
      },
      removeLlmKey: (provider: ProviderId) => {
        setState((prev) => {
          if (!prev.settings) {
            return prev;
          }
          const llmKeys = prev.settings.llmKeys.map((row) => {
            if (row.provider !== provider) {
              return row;
            }
            const next: LlmKeyRow = {
              provider: row.provider,
              webSearch: row.webSearch,
            };
            return next;
          });
          let next: AppState = {
            ...prev,
            settings: { ...prev.settings, llmKeys },
          };
          if (!hasAnyKey(llmKeys)) {
            // Home's amber notice takes over messaging (spec 2.6, home §B.1).
            next = {
              ...next,
              agentsPaused: true,
              footer: {
                ...next.footer,
                agents: "Agents paused · no LLM key",
              },
            };
          } else if (next.competitorsOverview && !hasSearchKey(llmKeys)) {
            next = {
              ...next,
              competitorsOverview: {
                ...next.competitorsOverview,
                searchKeyMissing: true,
              },
            };
          }
          return next;
        });
      },
      clearKeyTestResult: (provider: ProviderId) => {
        updateKeyRow(provider, (row) => {
          const next = { ...row };
          delete next.testResult;
          return next;
        });
      },
      setAgentFrequency,
      setAgentWeeklyAt: (id: string, weeklyAt: { day: string; time: string }) => {
        updateAgentRow(id, (row) => ({
          ...row,
          weeklyAt,
          nextRun: `${weeklyAt.day} ${weeklyAt.time}`,
          nextRunSortKey: Date.now() + 7 * 24 * 60 * 60 * 1000,
        }));
      },
      setAllAgentsPaused: (paused: boolean) => {
        setState((prev) => {
          if (!prev.settings) {
            return prev;
          }
          return {
            ...prev,
            settings: {
              ...prev.settings,
              schedules: { ...prev.settings.schedules, pausedAll: paused },
            },
            footer: {
              ...prev.footer,
              // Pausing is a choice, not a failure — default colouring (3.4).
              agents: paused
                ? "Agents · paused by you"
                : (baseAgentsRef.current ?? "Agents idle · next run 21:00"),
              agentsLive: false,
            },
          };
        });
      },
      setAgentPaused: (id: string, paused: boolean) => {
        const row = stateRef.current.settings?.schedules.rows.find(
          (candidate) => candidate.id === id,
        );
        if (!row) {
          return;
        }
        if (paused) {
          setAgentFrequency(id, "off");
        } else {
          setAgentFrequency(
            id,
            row.pausedFrom ?? agentMeta(id)?.defaultFrequency ?? "weekly",
          );
        }
      },
      runAgentNow: (id: string) => {
        const settings = stateRef.current.settings;
        const row = settings?.schedules.rows.find(
          (candidate) => candidate.id === id,
        );
        if (
          !settings ||
          !row ||
          settings.schedules.pausedAll ||
          row.frequency === "off"
        ) {
          return;
        }
        if (row.running) {
          return;
        }
        updateAgentRow(id, (existing) => ({
          ...existing,
          running: { elapsedS: 0 },
        }));
        setState((prev) => ({
          ...prev,
          footer: {
            ...prev.footer,
            agents: `Agents · running ${row.name} · 0:00`,
            agentsLive: true,
          },
        }));
        ensureSettingsTicker();
        schedule(6000, () => finishAgentRun(id));
      },
      enableModule: (id: keyof AppState["modules"]) => {
        setState((prev) => ({
          ...prev,
          modules: {
            ...prev.modules,
            [id]: { ...prev.modules[id], enabled: true },
          },
        }));
      },
      activateLicenceKey: (key: string) => {
        const notice = mockValidateLicenceKey(key);
        setState((prev) => {
          if (!prev.settings) {
            return prev;
          }
          if (notice.kind !== "valid") {
            return {
              ...prev,
              settings: { ...prev.settings, licenceNotice: notice },
            };
          }
          return {
            ...prev,
            settings: {
              ...prev.settings,
              licence: {
                kind: "licensed",
                email: "faith@discoveree.com",
                expires: notice.expires,
                keyMask: "DSCV-••••-••••-9F2K",
                enteredOn: new Intl.DateTimeFormat("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(new Date()),
                renewalDue: false,
              },
              licenceNotice: notice,
            },
            footer: {
              ...prev.footer,
              licence: `Licence to ${notice.expires}`,
              licenceAmber: false,
            },
          };
        });
        if (notice.kind === "valid") {
          // The quiet confirmation line lasts 5 s (6.4).
          schedule(5000, () => {
            updateSettings((settings) => {
              if (settings.licenceNotice?.kind !== "valid") {
                return settings;
              }
              const next = { ...settings };
              delete next.licenceNotice;
              return next;
            });
          });
        }
      },
      clearLicenceNotice: () => {
        updateSettings((settings) => {
          const next = { ...settings };
          delete next.licenceNotice;
          return next;
        });
      },
      checkForUpdates: () => {
        updateSettings((settings) =>
          settings.about
            ? {
                ...settings,
                about: { ...settings.about, updateState: "current" },
              }
            : settings,
        );
      },
    };

    return {
      ...settingsActions,
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
      // ── Customers — log feedback (customers spec part 2) ─────────────────
      openFeedbackFlow: (preset) => {
        setState((prev) => {
          const flow: LogFeedbackState = {
            ...prev.feedbackFlow,
            open: true,
          };
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
        // Typed input survives collapse; restored on reopen this session.
        setState((prev) => ({
          ...prev,
          feedbackFlow: { ...prev.feedbackFlow, open: false },
        }));
      },
      setFeedbackField: (field, value) => {
        setState((prev) => ({
          ...prev,
          feedbackFlow: { ...prev.feedbackFlow, [field]: value },
        }));
      },
      fileFeedback: () => {
        const flow = stateRef.current.feedbackFlow;
        const text = flow.draft.trim();
        if (!text) {
          return;
        }
        setState((prev) => {
          const today = new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
          }).format(new Date());
          const overview = prev.customersOverview;

          // Day one: the first filed item swaps the page to the standard
          // Overview with one honest band (spec 2.4).
          if (!overview) {
            return {
              ...prev,
              customersOverview: {
                lede: [
                  {
                    text: "One piece of feedback is in — a theme forms when the pattern does.",
                  },
                ],
                themes: [],
                segments: [],
                unfiledCount: 1,
                searchKeyMissing: false,
              },
              modules: {
                ...prev.modules,
                customers: { ...prev.modules.customers, populated: true },
              },
              footer: {
                ...prev.footer,
                agents: "Agents · next theme pass Thu 09:00",
              },
              segmentProposals: null,
              feedbackFlow: {
                open: false,
                draft: "",
                result: { kind: "unfiled", totalThemes: 0, unfiledCount: 1 },
              },
            };
          }

          // Agents paused: the verbatim files anyway — never blocked (2.3).
          if (prev.agentsPaused) {
            return {
              ...prev,
              customersOverview: {
                ...overview,
                unfiledCount: (overview.unfiledCount ?? 0) + 1,
              },
              feedbackFlow: { open: false, draft: "", result: { kind: "held" } },
            };
          }

          const lower = text.toLowerCase();
          const matched =
            overview.themes.find((theme) => theme.id === flow.presetThemeId) ??
            overview.themes.find((theme) =>
              theme.name
                .toLowerCase()
                .split(/\s+/)
                .some((word) => word.length > 3 && lower.includes(word)),
            );

          if (!matched) {
            const unfiledCount = (overview.unfiledCount ?? 0) + 1;
            return {
              ...prev,
              customersOverview: { ...overview, unfiledCount },
              feedbackFlow: {
                open: false,
                draft: "",
                result: {
                  kind: "unfiled",
                  totalThemes: overview.themes.length,
                  unfiledCount,
                },
              },
            };
          }

          const count = matched.mentionCount + 1;
          const item: FeedbackItemRef = {
            id: `feedback:manual-${Date.now()}`,
            text,
            provenance: {
              kind: "manual",
              label: flow.where
                ? `${flow.where.toLowerCase()} · logged by you`
                : "logged by you",
              date: flow.when?.trim() ? flow.when : today,
            },
            themeId: matched.id,
            themeName: matched.name,
            ...(flow.who?.trim() ? { segmentName: flow.who } : {}),
            ...(flow.presetSegmentId
              ? { segmentId: flow.presetSegmentId }
              : {}),
          };
          const object = prev.themes[matched.id];
          return {
            ...prev,
            customersOverview: {
              ...overview,
              themes: overview.themes.map((theme) =>
                theme.id === matched.id
                  ? { ...theme, mentionCount: count, refreshedAgo: "just now" }
                  : theme,
              ),
            },
            themes: object
              ? {
                  ...prev.themes,
                  [matched.id]: {
                    ...object,
                    mentionCount: count,
                    refreshedAgo: "just now",
                    items: [item, ...object.items],
                  },
                }
              : prev.themes,
            feedbackFlow: {
              open: false,
              draft: "",
              result: {
                kind: "matched",
                themeId: matched.id,
                themeName: matched.name,
                ordinal: ordinal(count),
              },
            },
          };
        });
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
      // ── Customers — themes (spec part 4) ─────────────────────────────────
      refreshTheme: startCustomersCheck,
      markThemeSeen: (id) => {
        setState((prev) => {
          const overview = prev.customersOverview;
          const object = prev.themes[id];
          let next = prev;
          if (overview) {
            next = {
              ...next,
              customersOverview: {
                ...overview,
                themes: overview.themes.map((theme) =>
                  theme.id === id && theme.change?.unseen
                    ? {
                        ...theme,
                        change: { ...theme.change, unseen: false },
                      }
                    : theme,
                ),
              },
            };
          }
          if (object && (object.changeUnseen || object.renamedFrom)) {
            const updated: ThemeObject = { ...object, changeUnseen: false };
            delete updated.renamedFrom;
            next = { ...next, themes: { ...next.themes, [id]: updated } };
          }
          return next;
        });
      },
      renameTheme: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) {
          return;
        }
        setState((prev) => {
          const overview = prev.customersOverview;
          const object = prev.themes[id];
          if (!overview || !object || object.name === trimmed) {
            return prev;
          }
          return {
            ...prev,
            customersOverview: {
              ...overview,
              themes: overview.themes.map((theme) =>
                theme.id === id ? { ...theme, name: trimmed } : theme,
              ),
            },
            themes: {
              ...prev.themes,
              [id]: { ...object, name: trimmed, renamedFrom: object.name },
            },
          };
        });
      },
      mergeThemes: (survivorId, absorbedId) => {
        setState((prev) => {
          const overview = prev.customersOverview;
          const survivor = prev.themes[survivorId];
          const absorbed = prev.themes[absorbedId];
          if (!overview || !survivor || !absorbed) {
            return prev;
          }
          const mentionCount = survivor.mentionCount + absorbed.mentionCount;
          const themes = { ...prev.themes };
          delete themes[absorbedId];
          themes[survivorId] = {
            ...survivor,
            mentionCount,
            summary: `Merged ${absorbed.name} in — its ${absorbed.mentionCount} mentions moved across with their sources kept intact.`,
            changeEvidence: [
              {
                id: `ev:${survivorId}-merge`,
                kind: "feedback",
                label: `${absorbed.mentionCount} mentions`,
                count: absorbed.mentionCount,
                objectId: survivorId,
              },
            ],
            changeUnseen: true,
            items: [...survivor.items, ...absorbed.items],
          };
          return {
            ...prev,
            customersOverview: {
              ...overview,
              themes: overview.themes
                .filter((theme) => theme.id !== absorbedId)
                .map((theme) =>
                  theme.id === survivorId
                    ? { ...theme, mentionCount }
                    : theme,
                ),
            },
            themes,
          };
        });
      },
      retireTheme: (id) => {
        setState((prev) => {
          const overview = prev.customersOverview;
          const object = prev.themes[id];
          if (!overview || !object) {
            return prev;
          }
          const themes = { ...prev.themes };
          delete themes[id];
          return {
            ...prev,
            customersOverview: {
              ...overview,
              themes: overview.themes.filter((theme) => theme.id !== id),
              unfiledCount: (overview.unfiledCount ?? 0) + object.mentionCount,
            },
            themes,
          };
        });
      },
      // ── Customers — segments (spec part 3) ───────────────────────────────
      checkSegment: startCustomersCheck,
      markSegmentSeen: (id) => {
        setState((prev) => {
          const object = prev.segments[id];
          if (!object?.changeUnseen) {
            return prev;
          }
          return {
            ...prev,
            segments: {
              ...prev.segments,
              [id]: { ...object, changeUnseen: false },
            },
          };
        });
      },
      setSegmentFit: (id, fit) => {
        setState((prev) => {
          const overview = prev.customersOverview;
          const object = prev.segments[id];
          if (!overview || !object) {
            return prev;
          }
          const updatedObject: SegmentObject = { ...object };
          if (fit) {
            updatedObject.fit = fit;
          } else {
            delete updatedObject.fit;
          }
          return {
            ...prev,
            customersOverview: {
              ...overview,
              segments: overview.segments.map((segment) => {
                if (segment.id !== id) {
                  return segment;
                }
                const updated: SegmentRow = { ...segment };
                if (fit) {
                  updated.fit = fit;
                } else {
                  delete updated.fit;
                }
                return updated;
              }),
            },
            segments: { ...prev.segments, [id]: updatedObject },
          };
        });
      },
      setSegmentType: (id, type) => {
        setState((prev) => {
          const overview = prev.customersOverview;
          const object = prev.segments[id];
          if (!overview || !object) {
            return prev;
          }
          const updatedObject: SegmentObject = { ...object };
          if (type) {
            updatedObject.type = type;
          } else {
            delete updatedObject.type;
          }
          return {
            ...prev,
            customersOverview: {
              ...overview,
              segments: overview.segments.map((segment) => {
                if (segment.id !== id) {
                  return segment;
                }
                const updated: SegmentRow = { ...segment };
                if (type) {
                  updated.type = type;
                } else {
                  delete updated.type;
                }
                return updated;
              }),
            },
            segments: { ...prev.segments, [id]: updatedObject },
          };
        });
      },
      removeSegment: (id) => {
        setState((prev) => {
          const overview = prev.customersOverview;
          if (!overview) {
            return prev;
          }
          const segments = { ...prev.segments };
          delete segments[id];
          return {
            ...prev,
            customersOverview: {
              ...overview,
              segments: overview.segments.filter(
                (segment) => segment.id !== id,
              ),
            },
            segments,
          };
        });
      },
      addSegmentProposals: (ids) => {
        setState((prev) => {
          const seeds = (prev.segmentProposals ?? []).filter((seed) =>
            ids.includes(seed.id),
          );
          if (seeds.length === 0) {
            return prev;
          }
          const created = seeds.map((seed) =>
            segmentFromName(seed.name, seed.id),
          );
          const segments = { ...prev.segments };
          for (const entry of created) {
            segments[entry.object.id] = entry.object;
          }
          return {
            ...prev,
            customersOverview: {
              lede: [
                { text: String(created.length), tone: "mono" },
                {
                  text:
                    created.length === 1
                      ? " segment is now set up — feedback will start linking to it as it files."
                      : " segments are now set up — feedback will start linking to them as it files.",
                },
              ],
              themes: [],
              segments: orderSegments(created.map((entry) => entry.row)),
              searchKeyMissing: false,
            },
            segments,
            modules: {
              ...prev.modules,
              customers: { ...prev.modules.customers, populated: true },
            },
            footer: {
              ...prev.footer,
              agents: "Agents · next theme pass Thu 09:00",
            },
            segmentProposals: null,
          };
        });
      },
      acceptSegmentAdoption: () => {
        setState((prev) => {
          const adoption = prev.segmentAdoption;
          if (!adoption) {
            return prev;
          }
          const slug = adoption.entityId.split(":").pop() ?? "segment";
          const id = `segment:${slug}`;
          const servedByProduct: ProductRef = {
            id: adoption.servedBy.id,
            name: adoption.servedBy.name,
          };
          const row: SegmentRow = {
            id,
            entityId: adoption.entityId,
            name: adoption.name,
            alsoServedBy: [servedByProduct],
            verifiedAgo: "just now",
            stale: false,
          };
          const object: SegmentObject = {
            id,
            entityId: adoption.entityId,
            name: adoption.name,
            verifiedAgo: "just now",
            personas: adoption.personas,
            recentItems: [],
            sources: [
              {
                id: `source:${slug}-shared`,
                name: "Shared entity",
                feeds: `identity from ${adoption.servedBy.name}`,
                stamp: `since ${adoption.servedBy.since}`,
              },
            ],
            sharedAcrossProducts: true,
            alsoServedBy: [servedByProduct],
            openThread: null,
            filedThreads: [],
          };
          const overview = prev.customersOverview ?? {
            lede: [
              { text: adoption.name, tone: "link" as const, objectId: id },
              {
                text: " is now part of this product's context. Its facet sections fill as evidence arrives.",
              },
            ],
            themes: [],
            segments: [],
            searchKeyMissing: false,
          };
          return {
            ...prev,
            customersOverview: {
              ...overview,
              segments: orderSegments([...overview.segments, row]),
            },
            segments: { ...prev.segments, [id]: object },
            modules: {
              ...prev.modules,
              customers: { ...prev.modules.customers, populated: true },
            },
            segmentAdoption: null,
          };
        });
      },
      dismissSegmentAdoption: () => {
        setState((prev) => ({ ...prev, segmentAdoption: null }));
      },
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
    clearSettingsInterval();
    clearCustomersInterval();
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
      clearSettingsInterval();
      clearCustomersInterval();
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
