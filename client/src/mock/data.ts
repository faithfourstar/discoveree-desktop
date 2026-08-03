import type {
  AppState,
  CompetitorObject,
  DayOnePrompt,
  HomeBriefing,
} from "./types";

/**
 * Mock datasets for the two shell states in the 2a design reference:
 * the populated briefing and the day-one prompt. Content matches the mock
 * in docs/design/layout-direction-2a.html.
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

const mixpanel: CompetitorObject = {
  id: "competitor:mixpanel",
  name: "Mixpanel",
  classification: "DIRECT",
  domain: "mixpanel.com",
  sentiment: 66,
  reviewCount: 107,
  verifiedAgo: "4 h ago",
  summary:
    "Two things changed since you last looked. Session replay is now on the pricing page, and two G2 reviews complain about warehouse sync limits.",
  theyBeatYouOn: [
    "Warehouse-native modelling",
    "Free tier depth",
    "Session replay",
  ],
  youBeatThemOn: [
    "Time to first dashboard",
    "Governance",
    "Support responsiveness",
  ],
  openThread: {
    id: "thread:mixpanel-warehouse-native",
    status: "open",
    question: "Could we match warehouse-native modelling in two quarters?",
    answer:
      "Your inventory already covers ingestion and transform scheduling. What’s missing is reverse-ETL and a semantic layer, and both appear in your feedback under a different name.",
    evidence: [
      {
        id: "ev:thread-features",
        kind: "feature-inventory",
        label: "142 features",
        count: 142,
        objectId: "product:feature-inventory",
      },
      {
        id: "ev:thread-theme",
        kind: "theme",
        label: "theme: data plumbing",
        objectId: "theme:data-plumbing",
      },
      {
        id: "ev:thread-pillar",
        kind: "pillar",
        label: "pillar 2",
        objectId: "pillar:2",
      },
    ],
    fileUnderLabel: "File under Mixpanel",
    keepAskingLabel: "Keep asking",
  },
  filedThreads: [
    {
      id: "thread:mixpanel-replay-decision",
      title: "Replay: buy, partner or ignore",
      filedOn: "28 Jul",
    },
  ],
};

/** Populated state — the "briefing in a shell" mock. */
export const briefingState: AppState = {
  productName: "Analytics Platform Pro",
  scenario: "briefing",
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
  competitor: mixpanel,
};

/** Day-one state — chosen modules present but dimmed; the rest absent. */
export const dayOneState: AppState = {
  productName: "Discoveree",
  scenario: "day-one",
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
  competitor: null,
};
