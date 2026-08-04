import {
  initialAddFlow,
  makeObjects,
  makeOverview,
  onboardingProposals,
} from "./competitors";
import {
  makeCustomers,
  makeSegmentAdoption,
  segmentOnboardingProposals,
} from "./customers";
import { makeSettings } from "./settings";
import type {
  AppState,
  DayOnePrompt,
  HomeBriefing,
  MockScenarioKey,
  ProductRef,
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

/** The single mock product every single-product scenario hangs off. */
export const analyticsProduct: ProductRef = {
  id: "analytics",
  name: "Analytics Platform Pro",
};

/** Second product of the multi-product scenario (ADR 003 harness). */
export const relayProduct: ProductRef = {
  id: "relay",
  name: "Relay Sync",
};

const dayOneProduct: ProductRef = { id: "discoveree", name: "Discoveree" };

/** Populated base — the "briefing in a shell" mock. */
function makePopulatedState(scenario: MockScenarioKey): AppState {
  return {
    productName: "Analytics Platform Pro",
    products: [analyticsProduct],
    productCreate: { pending: false, error: null },
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
    ...makeCustomersFields(makeCustomers()),
    settings: makeSettings("healthy"),
    agentsPaused: false,
    justVerifiedId: null,
  };
}

/** Spread helper: a customers dataset into the AppState field shape. */
function makeCustomersFields(dataset: ReturnType<typeof makeCustomers>): {
  customersOverview: AppState["customersOverview"];
  themes: AppState["themes"];
  segments: AppState["segments"];
  feedbackFlow: AppState["feedbackFlow"];
  customersChecking: AppState["customersChecking"];
  segmentProposals: AppState["segmentProposals"];
  segmentAdoption: AppState["segmentAdoption"];
} {
  return {
    customersOverview: dataset.overview,
    themes: dataset.themes,
    segments: dataset.segments,
    feedbackFlow: { open: false, draft: "" },
    customersChecking: [],
    segmentProposals: null,
    segmentAdoption: null,
  };
}

/** The empty customers slice (day-one and non-customers scenarios). */
function emptyCustomersFields(): ReturnType<typeof makeCustomersFields> {
  return {
    customersOverview: null,
    themes: {},
    segments: {},
    feedbackFlow: { open: false, draft: "" },
    customersChecking: [],
    segmentProposals: null,
    segmentAdoption: null,
  };
}

/** Day-one base — chosen modules present but dimmed; the rest absent. */
function makeDayOneState(scenario: MockScenarioKey): AppState {
  return {
    productName: "Discoveree",
    products: [dayOneProduct],
    productCreate: { pending: false, error: null },
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
    ...emptyCustomersFields(),
    settings: makeSettings("day-one"),
    agentsPaused: false,
    justVerifiedId: null,
  };
}

/** Home for the multi-product scenario's second product — quiet, current. */
const relayHome: HomeBriefing = {
  kicker: "Your context, this morning",
  lede: [
    { text: "Everything is current. Nothing moved against " },
    { text: "your two competitors", tone: "link", objectId: "module:competitors" },
    { text: " this week." },
  ],
  items: [],
  ideaPlaceholder: "Test a product idea, or ask about anything above…",
  serving: {
    consumers: [{ tool: "Claude", queriesThisWeek: 34 }],
    teammatesReading: 1,
  },
};

export function makeAppState(
  scenario: MockScenarioKey,
  activeProductId?: string,
): AppState {
  if (scenario === "day-one") {
    return makeDayOneState(scenario);
  }
  if (scenario === "proposals") {
    const state = makeDayOneState(scenario);
    state.onboardingProposals = [...onboardingProposals];
    return state;
  }

  const state = makePopulatedState(scenario);
  if (scenario === "settings-trial") {
    state.settings = makeSettings("trial");
    state.footer = { ...state.footer, licence: "Trial · 9 days left" };
  } else if (scenario === "settings-trial-ending") {
    state.settings = makeSettings("trial-ending");
    state.footer = {
      ...state.footer,
      licence: "Trial · 2 days left",
      licenceAmber: true,
    };
  } else if (scenario === "settings-reading-only") {
    state.settings = makeSettings("reading-only");
    state.footer = { ...state.footer, licence: "Reading only · trial ended" };
  } else if (scenario === "settings-paused") {
    state.settings = makeSettings("paused");
    state.footer = { ...state.footer, agents: "Agents · paused by you" };
  } else if (scenario === "settings-minimal") {
    // Only job 5 chosen: the inventory agent is the sole scheduled row
    // (settings spec 3.5) and Add capabilities lists the other four jobs.
    state.settings = makeSettings("minimal");
    state.modules = {
      ...state.modules,
      competitors: { enabled: false, populated: false },
      customers: { enabled: false, populated: false },
      strategy: { enabled: false, populated: false },
      roadmap: { enabled: false, populated: false },
    };
    state.home = {
      kicker: "Your context, this morning",
      lede: [{ text: "Your context is being served — nothing else is switched on yet." }],
      items: [],
      ideaPlaceholder: "Test a product idea…",
      serving: { consumers: [], teammatesReading: 0 },
    };
    state.competitorsOverview = null;
    Object.assign(state, emptyCustomersFields());
    state.footer = {
      ...state.footer,
      local: "Local · 6 MB on disk",
      agents: "Agents idle · next run 12 Aug",
      licence: "Trial · 12 days left",
    };
  }
  if (scenario === "multi-product") {
    // Two products; the dataset follows the product in the URL (ADR 003
    // §1.2 — the active product is URL state, nothing else).
    state.products = [analyticsProduct, relayProduct];
    if (activeProductId === relayProduct.id) {
      state.productName = relayProduct.name;
      state.home = relayHome;
      state.competitorsOverview = makeOverview("relay");
      Object.assign(state, emptyCustomersFields());
    } else {
      // The Analytics view shows the sharing markers (customers spec 3.2).
      Object.assign(
        state,
        makeCustomersFields(
          makeCustomers({ multiProduct: { otherProduct: relayProduct } }),
        ),
      );
    }
  } else if (scenario === "customers-day-one") {
    // Customers enabled but empty: the rail dims, the page invites (2.4).
    Object.assign(state, emptyCustomersFields());
    state.modules = {
      ...state.modules,
      customers: { enabled: true, populated: false },
    };
  } else if (scenario === "customers-proposals") {
    Object.assign(state, emptyCustomersFields());
    state.modules = {
      ...state.modules,
      customers: { enabled: true, populated: false },
    };
    state.segmentProposals = [...segmentOnboardingProposals];
  } else if (scenario === "customers-adoption") {
    // A second product reviewing an entity the first already serves (3.4).
    state.products = [analyticsProduct, relayProduct];
    state.productName = relayProduct.name;
    Object.assign(state, emptyCustomersFields());
    state.modules = {
      ...state.modules,
      customers: { enabled: true, populated: false },
    };
    state.segmentAdoption = makeSegmentAdoption(analyticsProduct);
  } else if (scenario === "many") {
    state.competitorsOverview = makeOverview("many");
  } else if (scenario === "quiet") {
    state.competitorsOverview = makeOverview("quiet");
  } else if (scenario === "no-search-key") {
    state.competitorsOverview = makeOverview("briefing", {
      searchKeyMissing: true,
    });
    Object.assign(
      state,
      makeCustomersFields(makeCustomers({ searchKeyMissing: true })),
    );
    state.settings = makeSettings("no-search-key");
  } else if (scenario === "no-llm-key") {
    state.agentsPaused = true;
    state.settings = makeSettings("no-llm-key");
    state.footer = { ...state.footer, agents: "Agents paused · no LLM key" };
  }
  if (state.competitorsOverview) {
    state.competitors = makeObjects(state.competitorsOverview.rows);
  }
  return state;
}

/** Populated state — kept as the default context value. */
export const briefingState: AppState = makeAppState("briefing");
