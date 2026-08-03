import {
  initialAddFlow,
  makeObjects,
  makeOverview,
  onboardingProposals,
} from "./competitors";
import type {
  AppState,
  DayOnePrompt,
  HomeBriefing,
  MockScenarioKey,
} from "./types";

/**
 * Mock datasets for the shell states. Content matches the mock in
 * docs/design/layout-direction-2a.html plus the competitors-module-spec
 * scenarios. `makeAppState` returns a fresh copy per call so in-session
 * mutations (mock agent runs, accepted proposals) never leak across the
 * `?state=` switch.
 */

const briefingHome: HomeBriefing = {
  kicker: "Your context, this morning",
  lede: [
    { text: "Everything is current except " },
    {
      text: "customer feedback",
      tone: "stale",
      objectId: "module:customers",
    },
    {
      text: ", last verified 19 days ago. Three things happened that touch your strategy.",
    },
  ],
  items: [
    {
      id: "briefing:mixpanel-replay",
      body: [
        {
          text: "Mixpanel put session replay on its pricing page. It touches ",
        },
        { text: "pillar 2", tone: "link", objectId: "pillar:2" },
        {
          text: ", and you already ship three of the five capabilities buyers name alongside it.",
        },
      ],
      evidence: [
        {
          id: "ev:mixpanel-replay-sources",
          kind: "source",
          label: "2 sources",
          count: 2,
          objectId: "source:mixpanel-pricing-diff",
        },
        {
          id: "ev:feature-inventory",
          kind: "feature-inventory",
          label: "142 features",
          count: 142,
          objectId: "product:feature-inventory",
        },
      ],
      action: { label: "Explore this", objectId: "competitor:mixpanel" },
    },
    {
      id: "briefing:slow-dashboard-theme",
      body: [
        {
          text: "“Slow dashboard load” reached 41 mentions with nothing on the roadmap against it. I’ve drafted a suggestion, unsent.",
        },
      ],
      evidence: [
        {
          id: "ev:slow-dashboard-feedback",
          kind: "feedback",
          label: "41 feedback items",
          count: 41,
          objectId: "theme:slow-dashboard-load",
        },
      ],
      action: {
        label: "Read the draft",
        objectId: "suggestion:slow-dashboard-load",
      },
    },
    {
      id: "briefing:q3-duplicates",
      body: [
        {
          text: "Two Q3 initiatives duplicate capability already in your feature inventory. Worth a look before planning closes.",
        },
      ],
      evidence: [
        {
          id: "ev:jira-initiatives",
          kind: "connection",
          label: "Jira · 27 initiatives",
          count: 27,
          objectId: "connection:jira",
        },
      ],
      action: { label: "See the review", objectId: "review:latest" },
    },
  ],
  ideaPlaceholder: "Test a product idea, or ask about anything above…",
  serving: {
    consumers: [
      { tool: "Claude", queriesThisWeek: 118 },
      { tool: "Cursor", queriesThisWeek: 22 },
    ],
    teammatesReading: 2,
  },
};

const dayOnePrompt: DayOnePrompt = {
  lede: "Give me your product’s URL and I’ll build the first draft of your context.",
  inputPlaceholder: "https://",
  cta: "Begin",
  helper:
    "Roughly four minutes: help centre, releases and changelog get read, then I’ll propose competitors for you to keep or drop. Step 1 of 5.",
};

/** Populated base — the "briefing in a shell" mock. */
function makePopulatedState(scenario: MockScenarioKey): AppState {
  return {
    productName: "Analytics Platform Pro",
    scenario: "briefing",
    mockScenario: scenario,
    modules: {
      home: { enabled: true, populated: true },
      competitors: { enabled: true, populated: true },
      customers: { enabled: true, populated: true },
      strategy: { enabled: true, populated: true },
      roadmap: { enabled: true, populated: true, badge: 3 },
      connections: { enabled: true, populated: true },
      settings: { enabled: true, populated: true },
    },
    footer: {
      local: "Local · 42 MB on disk",
      agents: "Agents idle · next run 21:00",
      mcp: "MCP serving :7317",
      offline: "Works offline",
      licence: "Licence to 14 Mar 2027",
    },
    home: briefingHome,
    dayOne: null,
    competitorsOverview: makeOverview("briefing"),
    competitors: {},
    competitorAddFlow: { ...initialAddFlow },
    onboardingProposals: null,
    agentsPaused: false,
    justVerifiedId: null,
  };
}

/** Day-one base — chosen modules present but dimmed; the rest absent. */
function makeDayOneState(scenario: MockScenarioKey): AppState {
  return {
    productName: "Discoveree",
    scenario: "day-one",
    mockScenario: scenario,
    modules: {
      home: { enabled: true, populated: true },
      competitors: { enabled: true, populated: false },
      customers: { enabled: false, populated: false },
      strategy: { enabled: true, populated: false },
      roadmap: { enabled: false, populated: false },
      connections: { enabled: true, populated: true },
      settings: { enabled: true, populated: true },
    },
    footer: {
      local: "Local · nothing sent anywhere",
      offline: "Works offline",
    },
    home: null,
    dayOne: dayOnePrompt,
    competitorsOverview: null,
    competitors: {},
    competitorAddFlow: { ...initialAddFlow },
    onboardingProposals: null,
    agentsPaused: false,
    justVerifiedId: null,
  };
}

export function makeAppState(scenario: MockScenarioKey): AppState {
  if (scenario === "day-one") {
    return makeDayOneState(scenario);
  }
  if (scenario === "proposals") {
    const state = makeDayOneState(scenario);
    state.onboardingProposals = [...onboardingProposals];
    return state;
  }

  const state = makePopulatedState(scenario);
  if (scenario === "many") {
    state.competitorsOverview = makeOverview("many");
  } else if (scenario === "quiet") {
    state.competitorsOverview = makeOverview("quiet");
  } else if (scenario === "no-search-key") {
    state.competitorsOverview = makeOverview("briefing", {
      searchKeyMissing: true,
    });
  } else if (scenario === "no-llm-key") {
    state.agentsPaused = true;
    state.footer = { ...state.footer, agents: "Agents paused · no LLM key" };
  }
  if (state.competitorsOverview) {
    state.competitors = makeObjects(state.competitorsOverview.rows);
  }
  return state;
}

/** Populated state — kept as the default context value. */
export const briefingState: AppState = makeAppState("briefing");
