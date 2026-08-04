import type {
  AgentFrequency,
  AgentScheduleRow,
  LicenceNotice,
  LicenceState,
  LlmKeyRow,
  ModuleId,
  ProviderId,
  SettingsState,
} from "./types";

/**
 * Settings metadata, formatters and mock-dataset builders (settings-spec
 * parts 2–7 + Appendix A). The metadata tables here are shared with the live
 * provider; the `make*Settings` builders belong to the `?state=` harness.
 */

// ---------------------------------------------------------------------------
// Providers — fixed order and per-provider metadata (spec 2.1–2.3)
// ---------------------------------------------------------------------------

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  /** Renders the WEB SEARCH tag (spec 2.5). */
  webSearch: boolean;
  /** Provider-correct entry placeholder (spec 2.3). */
  placeholder: string;
  /** The provider's key page — the "Get key ↗" ghost link. */
  keyPageUrl: string;
  /** Scheme prefix used for locally built masks, e.g. "sk-ant-". */
  maskPrefix: string;
}

/**
 * Anthropic first (Claude-first customers are the wedge); OpenRouter last —
 * the one-key-for-everything alternative reads naturally as "or just this".
 */
export const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    webSearch: false,
    placeholder: "sk-ant-…",
    keyPageUrl: "https://console.anthropic.com",
    maskPrefix: "sk-ant-",
  },
  {
    id: "openai",
    name: "OpenAI",
    webSearch: true,
    placeholder: "sk-…",
    keyPageUrl: "https://platform.openai.com",
    maskPrefix: "sk-",
  },
  {
    id: "google",
    name: "Google",
    webSearch: true,
    placeholder: "AIza…",
    keyPageUrl: "https://aistudio.google.com",
    maskPrefix: "AIza",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    webSearch: true,
    placeholder: "pplx-…",
    keyPageUrl: "https://www.perplexity.ai",
    maskPrefix: "pplx-",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    webSearch: true,
    placeholder: "sk-or-…",
    keyPageUrl: "https://openrouter.ai/keys",
    maskPrefix: "sk-or-",
  },
];

export function providerMeta(id: ProviderId): ProviderMeta {
  const meta = PROVIDERS.find((provider) => provider.id === id);
  if (!meta) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return meta;
}

export function providerName(id: ProviderId): string {
  return providerMeta(id).name;
}

/** Scheme prefix + ellipsis + last four — the masked-key contract (2.2). */
export function makeMask(provider: ProviderId, key: string): string {
  const tail = key.length >= 4 ? key.slice(-4) : key;
  return `${providerMeta(provider).maskPrefix}…${tail}`;
}

export function hasAnyKey(rows: readonly LlmKeyRow[]): boolean {
  return rows.some((row) => row.saved !== undefined);
}

export function hasSearchKey(rows: readonly LlmKeyRow[]): boolean {
  return rows.some((row) => row.webSearch && row.saved !== undefined);
}

// ---------------------------------------------------------------------------
// The v1 agent set (spec 3.3) — UI names, gates, defaults
// ---------------------------------------------------------------------------

export interface AgentMeta {
  slug: string;
  name: string;
  module: ModuleId | "always";
  description: string;
  defaultFrequency: AgentFrequency;
  /** Set-level agents offer Run now; per-object agents point at the object. */
  runNow: boolean;
  /** Per-object rows carry the "nudge from its own page" ghost note (3.2). */
  perObject?: boolean;
  weeklyAt?: { day: string; time: string };
}

export const AGENT_CATALOGUE: readonly AgentMeta[] = [
  {
    slug: "competitor-check",
    name: "Competitor check",
    module: "competitors",
    description:
      "Verifies each competitor profile against their site, changelog and reviews.",
    defaultFrequency: "fortnightly",
    runNow: false,
    perObject: true,
  },
  {
    // Server label (authoritative) — the spec's 3.3 table said "Changelog
    // watch"; the serving agent is "Competitor feature watch".
    slug: "competitor-feature-watch",
    name: "Competitor feature watch",
    module: "competitors",
    description: "Confirms each watched changelog, even when nothing changed.",
    defaultFrequency: "weekly",
    runNow: false,
    perObject: true,
  },
  {
    slug: "feedback-gathering",
    name: "Feedback gathering",
    module: "customers",
    description:
      "Collects new feedback from your sources and reads its sentiment.",
    defaultFrequency: "weekly",
    runNow: true,
  },
  {
    slug: "theme-aggregation",
    name: "Theme aggregation",
    module: "customers",
    description: "Groups fresh feedback into themes after each gathering.",
    defaultFrequency: "after-gathering",
    runNow: false,
  },
  {
    slug: "segment-persona-refresh",
    name: "Segment & persona refresh",
    module: "customers",
    description: "Re-checks segments and personas against recent evidence.",
    defaultFrequency: "monthly",
    runNow: true,
  },
  {
    slug: "product-inventory",
    name: "Your product’s inventory",
    module: "always",
    description:
      "Re-reads your help centre, releases and changelog into the feature inventory.",
    defaultFrequency: "monthly",
    runNow: true,
  },
  {
    slug: "roadmap-poll",
    name: "Roadmap poll",
    module: "roadmap",
    description: "Reads roadmap items from Jira or Linear.",
    defaultFrequency: "daily",
    runNow: true,
  },
  {
    slug: "weekly-roadmap-review",
    name: "Weekly roadmap review",
    module: "roadmap",
    description:
      "Scores the roadmap against strategy, feedback and competitor moves; drafts suggestions for you.",
    defaultFrequency: "weekly",
    runNow: true,
    weeklyAt: { day: "Sun", time: "21:00" },
  },
  {
    slug: "market-review",
    name: "Market review",
    module: "strategy",
    description: "Refreshes the market picture behind your strategy narrative.",
    defaultFrequency: "monthly",
    runNow: true,
  },
];

export function agentMeta(slug: string): AgentMeta | undefined {
  return AGENT_CATALOGUE.find((agent) => agent.slug === slug);
}

/** Rows a per-object note applies to — the scheduler owns the set (3.2). */
export const PER_OBJECT_NOTE = "Nudge a single profile from its own page.";

// ---------------------------------------------------------------------------
// Next-run display (spec 3.3): daily → time; longer → day + time, or a date
// when further out.
// ---------------------------------------------------------------------------

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayTimeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

export function nextRunStamp(atMs: number, frequency: AgentFrequency): string {
  const date = new Date(atMs);
  if (frequency === "daily") {
    return timeFormat.format(date);
  }
  const daysAway = (atMs - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysAway <= 6.5) {
    // "Thu 09:00" — en-GB gives "Thu, 09:00"; strip the comma.
    return dayTimeFormat.format(date).replace(",", "");
  }
  return dateFormat.format(date);
}

const FREQUENCY_DAYS: Record<
  Exclude<AgentFrequency, "after-gathering" | "off">,
  number
> = {
  daily: 1,
  "every-3-days": 3,
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
};

/** Mono display words for the frequency select ("every 3 days", "off"). */
export const FREQUENCY_LABELS: Record<AgentFrequency, string> = {
  daily: "daily",
  "every-3-days": "every 3 days",
  weekly: "weekly",
  fortnightly: "fortnightly",
  monthly: "monthly",
  off: "off",
  "after-gathering": "after gathering",
};

/** The six editable values of the server contract, in rhythm order. */
export const EDITABLE_FREQUENCIES: readonly Exclude<
  AgentFrequency,
  "after-gathering"
>[] = ["daily", "every-3-days", "weekly", "fortnightly", "monthly", "off"];

/** Recompute a next run from now — the stamp is the feedback (3.2). */
export function nextRunFrom(
  frequency: AgentFrequency,
  now = Date.now(),
): { nextRun: string; nextRunSortKey: number } | null {
  if (frequency === "after-gathering" || frequency === "off") {
    return null;
  }
  const at = new Date(now + FREQUENCY_DAYS[frequency] * 24 * 60 * 60 * 1000);
  // Agents run in the quiet hours by default.
  at.setHours(frequency === "daily" ? 21 : 9, 0, 0, 0);
  return {
    nextRun: nextRunStamp(at.getTime(), frequency),
    nextRunSortKey: at.getTime(),
  };
}

/** The soonest scheduled run across unpaused rows — feeds lede and footer. */
export function earliestNextRun(
  rows: readonly AgentScheduleRow[],
): AgentScheduleRow | undefined {
  return rows
    .filter(
      (row) => row.frequency !== "off" && row.nextRun && row.nextRunSortKey,
    )
    .sort((a, b) => (a.nextRunSortKey ?? 0) - (b.nextRunSortKey ?? 0))[0];
}

// ---------------------------------------------------------------------------
// Licence key validation (spec 6.4) — format check is local and shared.
// Offline signed validation is the licensing sprint's; until it lands, a
// well-formed key honestly "didn't validate".
// ---------------------------------------------------------------------------

const LICENCE_KEY_RE = /^DSCV(-[A-Z0-9]{4}){4}$/;

export function normaliseLicenceKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isWellFormedLicenceKey(key: string): boolean {
  return LICENCE_KEY_RE.test(key);
}

/**
 * Mock-harness validation script: `DSCV-GOOD-…` activates, `DSCV-EXPD-…`
 * reads as an expired key, any other well-formed key fails its signature.
 */
export function mockValidateLicenceKey(raw: string): LicenceNotice {
  const key = normaliseLicenceKey(raw);
  if (!isWellFormedLicenceKey(key)) {
    return { kind: "malformed" };
  }
  if (key.startsWith("DSCV-GOOD-")) {
    return { kind: "valid", expires: "14 Mar 2027" };
  }
  if (key.startsWith("DSCV-EXPD-")) {
    return { kind: "expired", expiredOn: "2 Jan 2026" };
  }
  return { kind: "invalid" };
}

// ---------------------------------------------------------------------------
// Mock dataset builders (the `?state=` harness)
// ---------------------------------------------------------------------------

function keyRow(
  provider: ProviderId,
  saved?: LlmKeyRow["saved"],
): LlmKeyRow {
  const row: LlmKeyRow = {
    provider,
    webSearch: providerMeta(provider).webSearch,
  };
  if (saved) {
    row.saved = saved;
  }
  return row;
}

/** Anthropic + Perplexity saved — the healthy pair of the spec's examples. */
function makeHealthyKeys(): LlmKeyRow[] {
  return [
    keyRow("anthropic", {
      mask: "sk-ant-…R4kQ",
      addedAt: "3 Aug",
      lastUsedAgo: "14 min ago",
      verified: true,
    }),
    keyRow("openai"),
    keyRow("google"),
    keyRow("perplexity", {
      mask: "pplx-…9dQ2",
      addedAt: "3 Aug",
      lastUsedAgo: "2 h ago",
      verified: true,
    }),
    keyRow("openrouter"),
  ];
}

/** Anthropic only — agents can think but not search (spec 2.5). */
function makeThinkOnlyKeys(): LlmKeyRow[] {
  return [
    keyRow("anthropic", {
      mask: "sk-ant-…R4kQ",
      addedAt: "3 Aug",
      lastUsedAgo: "26 min ago",
      verified: true,
    }),
    keyRow("openai"),
    keyRow("google"),
    keyRow("perplexity"),
    keyRow("openrouter"),
  ];
}

function makeNoKeys(): LlmKeyRow[] {
  return PROVIDERS.map((provider) => keyRow(provider.id));
}

function scheduleRow(
  slug: string,
  overrides: Partial<AgentScheduleRow> = {},
): AgentScheduleRow {
  const meta = agentMeta(slug);
  if (!meta) {
    throw new Error(`Unknown agent slug: ${slug}`);
  }
  const next = nextRunFrom(meta.defaultFrequency);
  const row: AgentScheduleRow = {
    id: meta.slug,
    name: meta.name,
    module: meta.module,
    description: meta.description,
    frequency: meta.defaultFrequency,
    runNow: meta.runNow,
    ...(meta.weeklyAt ? { weeklyAt: { ...meta.weeklyAt } } : {}),
    ...(next ?? {}),
  };
  return { ...row, ...overrides };
}

function makeScheduleRows(): AgentScheduleRow[] {
  return [
    scheduleRow("competitor-check", {
      lastRun: { at: "Tue 14:02", findings: 2 },
    }),
    scheduleRow("competitor-feature-watch", {
      lastRun: { at: "Mon 09:00", findings: 0 },
    }),
    scheduleRow("feedback-gathering", {
      lastRun: { at: "Thu 09:01", findings: 12 },
    }),
    scheduleRow("theme-aggregation", {
      lastRun: { at: "Thu 09:04", findings: 3 },
    }),
    scheduleRow("segment-persona-refresh", {
      lastRun: { at: "28 Jul", findings: 0 },
    }),
    scheduleRow("product-inventory", {
      lastRun: { at: "14 Jul", findings: 6 },
    }),
    scheduleRow("roadmap-poll", {
      lastRun: { at: "08:00", findings: 0 },
    }),
    scheduleRow("weekly-roadmap-review", {
      nextRun: "Sun 21:00",
      lastRun: { at: "Sun 21:00", findings: 3 },
    }),
    scheduleRow("market-review", {
      lastRun: { at: "8 Jul", findings: 1 },
    }),
  ];
}

const HEALTHY_CONNECTIONS = {
  serving: [
    { name: "Claude", queriesThisWeek: 118 },
    { name: "Cursor", queriesThisWeek: 22 },
  ],
  checking: [{ name: "Jira", cadence: "daily", polledAgo: "2 h ago" }],
} as const;

const HEALTHY_ABOUT = {
  dataDir: "~/Library/Application Support/Discoveree",
  dbSizeOnDisk: "42 MB",
  version: "1.0.3",
  updateState: "current",
  canReveal: true,
} as const;

const LICENSED: LicenceState = {
  kind: "licensed",
  email: "faith@discoveree.com",
  expires: "14 Mar 2027",
  keyMask: "DSCV-••••-••••-9F2K",
  enteredOn: "3 Aug 2026",
  renewalDue: false,
};

/** Fully populated, licensed — matches the briefing scenarios' footer. */
export function makeHealthySettings(): SettingsState {
  return {
    llmKeys: makeHealthyKeys(),
    schedules: { pausedAll: false, rows: makeScheduleRows() },
    capabilities: { runNow: true, perAgentPause: true, editWeeklyAt: true },
    connections: {
      serving: [...HEALTHY_CONNECTIONS.serving],
      checking: [...HEALTHY_CONNECTIONS.checking],
    },
    licence: { ...LICENSED },
    about: { ...HEALTHY_ABOUT },
  };
}

export type SettingsVariant =
  | "healthy"
  | "no-llm-key"
  | "no-search-key"
  | "trial"
  | "trial-ending"
  | "reading-only"
  | "paused"
  | "minimal"
  | "day-one";

export function makeSettings(variant: SettingsVariant): SettingsState {
  const settings = makeHealthySettings();
  switch (variant) {
    case "healthy":
      return settings;
    case "no-llm-key":
      return { ...settings, llmKeys: makeNoKeys() };
    case "no-search-key":
      // Think-only keys, plus the failed-run row grammar (spec 3.2).
      return {
        ...settings,
        llmKeys: makeThinkOnlyKeys(),
        schedules: {
          ...settings.schedules,
          rows: settings.schedules.rows.map((row) =>
            row.id === "roadmap-poll"
              ? {
                  ...row,
                  lastRun: {
                    at: "Tue 14:02",
                    failed: { reason: "couldn’t reach jira.example.com" },
                  },
                }
              : row,
          ),
        },
      };
    case "trial":
      return {
        ...settings,
        licence: { kind: "trial", daysLeft: 9 },
        about: { ...HEALTHY_ABOUT, updateState: "ready" },
      };
    case "trial-ending":
      return { ...settings, licence: { kind: "trial", daysLeft: 2 } };
    case "reading-only":
      return {
        ...settings,
        licence: { kind: "readingOnly", endedOn: "12 Aug", reason: "trial" },
      };
    case "paused":
      return {
        ...settings,
        schedules: { ...settings.schedules, pausedAll: true },
        about: {
          ...HEALTHY_ABOUT,
          updateState: { failedAt: "Tue 14:02" },
        },
      };
    case "minimal":
      // Only job 5 chosen: the inventory agent is the one scheduled row
      // (spec 3.5); nothing connected yet; trial licence.
      return {
        ...settings,
        licence: { kind: "trial", daysLeft: 12 },
        connections: { serving: [], checking: [] },
      };
    case "day-one":
      return {
        ...settings,
        llmKeys: [
          keyRow("anthropic", {
            mask: "sk-ant-…R4kQ",
            addedAt: "today",
            verified: true,
          }),
          keyRow("openai"),
          keyRow("google"),
          keyRow("perplexity"),
          keyRow("openrouter"),
        ],
        licence: { kind: "trial", daysLeft: 14 },
        connections: { serving: [], checking: [] },
        about: {
          ...HEALTHY_ABOUT,
          dbSizeOnDisk: "6 MB",
        },
      };
  }
}
