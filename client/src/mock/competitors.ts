import type {
  AddFlowState,
  AddStage,
  CompetitorObject,
  CompetitorProposal,
  CompetitorRow,
  CompetitorsOverview,
  EvidenceRef,
  OnboardingCompetitorProposal,
  RichSegment,
  RichText,
  ThreatWord,
} from "./types";

/**
 * Mock data + pure helpers for the Competitors module. Ordering and the
 * lede's priority ladder live here (data-side, per Appendix A: rows arrive
 * pre-ordered and the lede pre-composed) so the future server provider owns
 * the same jobs and components stay dumb.
 */

// ---------------------------------------------------------------------------
// Ordering — threat descending, stale rows rise within their band, then name
// ---------------------------------------------------------------------------

export const threatRank: Record<ThreatWord, number> = {
  "big threat": 0,
  competitive: 1,
  watch: 2,
  quiet: 3,
};

function compareRows(a: CompetitorRow, b: CompetitorRow): number {
  return (
    threatRank[a.threat] - threatRank[b.threat] ||
    Number(b.stale) - Number(a.stale) ||
    a.name.localeCompare(b.name)
  );
}

export function orderRows(
  rows: readonly CompetitorRow[],
): readonly CompetitorRow[] {
  return [...rows].sort(compareRows);
}

/**
 * Where a newly accepted row belongs (its threat position). Existing rows do
 * not reshuffle during a session — only insertion respects the ordering.
 */
export function insertionIndex(
  rows: readonly CompetitorRow[],
  row: CompetitorRow,
): number {
  const index = rows.findIndex((existing) => compareRows(row, existing) < 0);
  return index === -1 ? rows.length : index;
}

/** Live elapsed counter display, e.g. "0:34" — the mono figures do the work. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Routing helpers — /competitors/:slug where slug is the id's local part
// ---------------------------------------------------------------------------

export function competitorSlug(id: string): string {
  const parts = id.split(":");
  return parts[parts.length - 1] ?? id;
}

export function competitorPath(id: string): string {
  return `/competitors/${competitorSlug(id)}`;
}

// ---------------------------------------------------------------------------
// The lede — the module mini-briefing, composed on the priority ladder
// ---------------------------------------------------------------------------

const NUMBER_WORDS = [
  "None",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
] as const;

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export interface LedeHighlight {
  /** Competitor name — rendered as an object link. */
  name: string;
  id: string;
  /** Plain-prose clause, e.g. "put session replay on its pricing page". */
  clause: string;
}

/**
 * Priority ladder (spec 1.2): changes first, else verified stillness; a
 * staleness clause appends to either — and a profile that has *never* been
 * verified is the extreme of stale, so its clause outranks the all-quiet
 * claim. "Every profile is current" is only ever said when every profile has
 * at least one successful verification and none is stale. The live
 * "Checking … now — " prefix is view-side (derived from `checking`), so it
 * never reflows the stored lede.
 */
export function buildLede(
  rows: readonly CompetitorRow[],
  highlights: readonly LedeHighlight[],
  freshSince: string,
): RichText {
  const segments: RichSegment[] = [];
  const total = rows.length;
  const changedCount = rows.filter((row) => row.change).length;
  const neverVerified = rows.filter((row) => row.unverified);
  const verifiedRows = rows.filter((row) => !row.unverified);
  const staleRows = rows.filter((row) => row.stale && !row.unverified);

  if (changedCount > 0 && highlights.length > 0) {
    if (total > 1) {
      segments.push({ text: numberWord(changedCount), tone: "mono" });
      segments.push({
        text: ` of your ${numberWord(total).toLowerCase()} competitors moved this week. `,
      });
    }
    // A single competitor needs no "one of your one" arithmetic.
    highlights.forEach((highlight, index) => {
      if (index > 0) {
        segments.push({ text: ", and " });
      }
      segments.push({
        text: highlight.name,
        tone: "link",
        objectId: highlight.id,
      });
      segments.push({ text: ` ${highlight.clause}` });
    });
    segments.push({ text: "." });
  } else if (verifiedRows.length === 1 && total === 1) {
    const only = verifiedRows[0];
    if (only) {
      segments.push({ text: only.name, tone: "link", objectId: only.id });
      segments.push({ text: ` hasn’t changed since ${freshSince}.` });
      if (staleRows.length === 0) {
        segments.push({ text: " The profile is current." });
      }
    }
  } else if (verifiedRows.length > 0) {
    const allCurrent = neverVerified.length === 0 && staleRows.length === 0;
    segments.push({
      text: `Nothing has changed across your ${numberWord(total).toLowerCase()} competitors since ${freshSince}.${allCurrent ? " Every profile is current." : ""}`,
    });
  }
  // No verified profiles at all ⇒ no stillness claim; the clauses below
  // carry the whole lede.

  for (const staleRow of staleRows) {
    if (segments.length > 0) {
      segments.push({ text: " " });
    }
    segments.push({
      text: staleRow.name,
      tone: "stale",
      objectId: staleRow.id,
    });
    segments.push({ text: " hasn’t been verified in " });
    segments.push({ text: String(staleRow.staleDays ?? 15), tone: "mono" });
    segments.push({ text: " days." });
  }

  for (const row of neverVerified) {
    if (segments.length > 0) {
      segments.push({ text: " " });
    }
    segments.push({ text: row.name, tone: "stale", objectId: row.id });
    segments.push({
      text: row.lastRunFailed
        ? " hasn’t been verified yet — its first check couldn’t finish."
        : " hasn’t been verified yet — its first check is still running.",
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Shared evidence refs
// ---------------------------------------------------------------------------

const featureInventoryChip: EvidenceRef = {
  id: "ev:feature-inventory",
  kind: "feature-inventory",
  label: "142 features",
  count: 142,
  objectId: "product:feature-inventory",
};

// ---------------------------------------------------------------------------
// Rows — the briefing set (six competitors)
// ---------------------------------------------------------------------------

const mixpanelRow: CompetitorRow = {
  id: "competitor:mixpanel",
  name: "Mixpanel",
  classification: "DIRECT",
  domain: "mixpanel.com",
  threat: "big threat",
  sentiment: 66,
  reviewCount: 107,
  verifiedAgo: "4 h ago",
  stale: false,
  verifiedOrder: 4,
  change: {
    line: "Session replay is now on the pricing page — it touches pillar 2.",
    evidence: [
      {
        id: "ev:mixpanel-replay-sources",
        kind: "source",
        label: "2 sources",
        count: 2,
        objectId: "source:mixpanel-pricing-diff",
      },
      featureInventoryChip,
    ],
    unseen: true,
  },
};

const amplitudeRow: CompetitorRow = {
  id: "competitor:amplitude",
  name: "Amplitude",
  classification: "DIRECT",
  domain: "amplitude.com",
  threat: "big threat",
  sentiment: 61,
  reviewCount: 84,
  verifiedAgo: "6 h ago",
  stale: false,
  verifiedOrder: 6,
  change: {
    line: "Dropped the free-tier event cap from one million to 500k events a month.",
    evidence: [
      {
        id: "ev:amplitude-pricing-diff",
        kind: "source",
        label: "1 source",
        count: 1,
        objectId: "source:amplitude-pricing-diff",
      },
    ],
    unseen: false,
  },
};

const posthogRow: CompetitorRow = {
  id: "competitor:posthog",
  name: "PostHog",
  classification: "DIRECT",
  domain: "posthog.com",
  threat: "competitive",
  sentiment: 72,
  reviewCount: 41,
  verifiedAgo: "2 d ago",
  stale: false,
  verifiedOrder: 48,
  confirmedQuietSince: "24 Jul",
};

const heapRow: CompetitorRow = {
  id: "competitor:heap",
  name: "Heap",
  classification: "DIRECT",
  domain: "heap.io",
  threat: "watch",
  sentiment: 58,
  reviewCount: 37,
  verifiedAgo: "16 d ago",
  stale: true,
  staleDays: 16,
  verifiedOrder: 384,
};

const fullstoryRow: CompetitorRow = {
  id: "competitor:fullstory",
  name: "Fullstory",
  classification: "ADJACENT",
  domain: "fullstory.com",
  threat: "watch",
  sentiment: 63,
  reviewCount: 52,
  verifiedAgo: "3 d ago",
  stale: false,
  verifiedOrder: 72,
  lastRunFailed: { at: "Tue 14:02", reason: "couldn’t reach fullstory.com" },
  confirmedQuietSince: "21 Jul",
};

const juneRow: CompetitorRow = {
  id: "competitor:june",
  name: "June",
  classification: "ADJACENT",
  domain: "june.so",
  threat: "quiet",
  verifiedAgo: "1 d ago",
  stale: false,
  verifiedOrder: 24,
  confirmedQuietSince: "26 Jul",
};

const briefingRows = orderRows([
  mixpanelRow,
  amplitudeRow,
  posthogRow,
  heapRow,
  fullstoryRow,
  juneRow,
]);

const briefingHighlights: readonly LedeHighlight[] = [
  {
    name: "Mixpanel",
    id: "competitor:mixpanel",
    clause: "put session replay on its pricing page",
  },
  {
    name: "Amplitude",
    id: "competitor:amplitude",
    clause: "dropped its free-tier event cap",
  },
];

// ---------------------------------------------------------------------------
// Rows — the "many" set (eleven competitors, exercises "Also watching")
// ---------------------------------------------------------------------------

const pendoRow: CompetitorRow = {
  id: "competitor:pendo",
  name: "Pendo",
  classification: "DIRECT",
  domain: "pendo.io",
  threat: "competitive",
  sentiment: 64,
  reviewCount: 89,
  verifiedAgo: "8 h ago",
  stale: false,
  verifiedOrder: 8,
  confirmedQuietSince: "23 Jul",
};

const hotjarRow: CompetitorRow = {
  id: "competitor:hotjar",
  name: "Hotjar",
  classification: "ADJACENT",
  domain: "hotjar.com",
  threat: "watch",
  sentiment: 69,
  reviewCount: 120,
  verifiedAgo: "2 d ago",
  stale: false,
  verifiedOrder: 50,
  confirmedQuietSince: "22 Jul",
};

const logrocketRow: CompetitorRow = {
  id: "competitor:logrocket",
  name: "LogRocket",
  classification: "ADJACENT",
  domain: "logrocket.com",
  threat: "watch",
  sentiment: 60,
  reviewCount: 44,
  verifiedAgo: "5 h ago",
  stale: false,
  verifiedOrder: 5,
  change: {
    line: "Launched a free session-replay tier aimed squarely at product teams.",
    evidence: [
      {
        id: "ev:logrocket-launch",
        kind: "source",
        label: "1 source",
        count: 1,
        objectId: "source:logrocket-changelog",
      },
    ],
    unseen: false,
  },
};

const countlyRow: CompetitorRow = {
  id: "competitor:countly",
  name: "Countly",
  classification: "ADJACENT",
  domain: "countly.com",
  threat: "quiet",
  verifiedAgo: "3 d ago",
  stale: false,
  verifiedOrder: 70,
  confirmedQuietSince: "20 Jul",
};

const smartlookRow: CompetitorRow = {
  id: "competitor:smartlook",
  name: "Smartlook",
  classification: "ADJACENT",
  domain: "smartlook.com",
  threat: "quiet",
  sentiment: 55,
  reviewCount: 23,
  verifiedAgo: "1 h ago",
  stale: false,
  verifiedOrder: 1,
  change: {
    line: "Its pricing page now redirects to Cisco — the standalone plans have gone.",
    evidence: [
      {
        id: "ev:smartlook-redirect",
        kind: "source",
        label: "1 source",
        count: 1,
        objectId: "source:smartlook-pricing-diff",
      },
    ],
    unseen: true,
  },
};

const manyRows = orderRows([
  mixpanelRow,
  amplitudeRow,
  posthogRow,
  heapRow,
  fullstoryRow,
  juneRow,
  pendoRow,
  hotjarRow,
  logrocketRow,
  countlyRow,
  smartlookRow,
]);

const manyHighlights: readonly LedeHighlight[] = [
  {
    name: "Mixpanel",
    id: "competitor:mixpanel",
    clause: "put session replay on its pricing page",
  },
  {
    name: "Smartlook",
    id: "competitor:smartlook",
    clause: "lost its standalone pricing to the Cisco acquisition",
  },
];

// ---------------------------------------------------------------------------
// Rows — the "quiet" set (no changes, all fresh: ladder rung 2)
// ---------------------------------------------------------------------------

function quieten(row: CompetitorRow, confirmed: string): CompetitorRow {
  const { change: _change, lastRunFailed: _failed, ...rest } = row;
  return {
    ...rest,
    stale: false,
    verifiedAgo: "3 h ago",
    verifiedOrder: 3,
    confirmedQuietSince: confirmed,
  };
}

const quietRows = orderRows([
  quieten(mixpanelRow, "28 Jul"),
  quieten(amplitudeRow, "27 Jul"),
  quieten(posthogRow, "24 Jul"),
  quieten({ ...heapRow, staleDays: undefined }, "25 Jul"),
  quieten(fullstoryRow, "21 Jul"),
  quieten(juneRow, "26 Jul"),
]);

// ---------------------------------------------------------------------------
// Overview factories
// ---------------------------------------------------------------------------

export type OverviewVariant = "briefing" | "many" | "quiet";

export function makeOverview(
  variant: OverviewVariant,
  options?: { searchKeyMissing?: boolean },
): CompetitorsOverview {
  const rows =
    variant === "many" ? manyRows : variant === "quiet" ? quietRows : briefingRows;
  const highlights =
    variant === "many"
      ? manyHighlights
      : variant === "quiet"
        ? []
        : briefingHighlights;
  return {
    lede: buildLede(rows, highlights, "Thursday"),
    rows: rows.map((row) => ({ ...row })),
    view: "cards",
    searchKeyMissing: options?.searchKeyMissing ?? false,
  };
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

const mixpanelObject: CompetitorObject = {
  id: "competitor:mixpanel",
  name: "Mixpanel",
  classification: "DIRECT",
  domain: "mixpanel.com",
  threat: "big threat",
  sentiment: 66,
  reviewCount: 107,
  verifiedAgo: "4 h ago",
  summary:
    "Two things changed since you last looked. Session replay is now on the pricing page, and two G2 reviews complain about warehouse sync limits.",
  changeUnseen: true,
  changeEvidence: [
    {
      id: "ev:mixpanel-replay-sources",
      kind: "source",
      label: "2 sources",
      count: 2,
      objectId: "source:mixpanel-pricing-diff",
    },
    {
      id: "ev:mixpanel-g2-reviews",
      kind: "source",
      label: "2 reviews",
      count: 2,
      objectId: "source:mixpanel-g2",
    },
  ],
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
  featureCoverage: {
    covered: 31,
    inventoryTotal: 142,
    uniqueToThem: 9,
    theyHaveYouDont: [
      { id: "gap:session-replay", label: "Session replay", objectId: "gap:session-replay" },
      { id: "gap:warehouse-native", label: "Warehouse-native modelling", objectId: "gap:warehouse-native" },
      { id: "gap:reverse-etl", label: "Reverse ETL", objectId: "gap:reverse-etl" },
      { id: "gap:semantic-layer", label: "Semantic layer", objectId: "gap:semantic-layer" },
      { id: "gap:impact-analysis", label: "Automated impact analysis", objectId: "gap:impact-analysis" },
      { id: "gap:lexicon", label: "Tracking-plan lexicon", objectId: "gap:lexicon" },
      { id: "gap:borrowed-insights", label: "Borrowed board templates", objectId: "gap:borrowed-insights" },
      { id: "gap:anomaly-alerts", label: "Anomaly alerting", objectId: "gap:anomaly-alerts" },
      { id: "gap:signal-digests", label: "Signal digests", objectId: "gap:signal-digests" },
    ],
    youHaveTheyDont: [
      { id: "feature:governance", label: "Workspace governance", objectId: "feature:governance" },
      { id: "feature:audit-log", label: "Full audit log", objectId: "feature:audit-log" },
      { id: "feature:sso-scim", label: "SSO with SCIM", objectId: "feature:sso-scim" },
      { id: "feature:onboarding", label: "Guided first dashboard", objectId: "feature:onboarding" },
      { id: "feature:sla-support", label: "SLA-backed support", objectId: "feature:sla-support" },
    ],
  },
  reviewEvidence: {
    line: [
      { text: "Sentiment " },
      { text: "66", tone: "mono" },
      { text: " across " },
      { text: "107", tone: "mono" },
      { text: " reviews, drifting down since May." },
    ],
    quotes: [
      {
        id: "quote:mixpanel-warehouse",
        text: "Warehouse sync silently drops rows past a limit nobody tells you about until you hit it.",
        attribution: "G2 · 28 Jul · ★★☆",
        sourceId: "source:mixpanel-g2",
      },
      {
        id: "quote:mixpanel-replay",
        text: "Replay plus funnels in one place finally killed two tools for us.",
        attribution: "G2 · 24 Jul · ★★★★★",
        sourceId: "source:mixpanel-g2",
      },
      {
        id: "quote:mixpanel-pricing",
        text: "Pricing conversations start friendly and end with a 40% surprise at renewal.",
        attribution: "Capterra · 19 Jul · ★★★",
        sourceId: "source:mixpanel-capterra",
      },
    ],
  },
  sources: [
    {
      id: "source:mixpanel-site",
      name: "mixpanel.com",
      feeds: "site crawl",
      stamp: "checked 4 h ago",
    },
    {
      id: "source:mixpanel-changelog",
      name: "mixpanel.com/changelog",
      feeds: "watching for changes",
      stamp: "not confirmed in 9 d",
      stale: true,
    },
    {
      id: "source:mixpanel-g2",
      name: "G2",
      feeds: "review mining",
      stamp: "84 reviews · 12 Jul",
    },
    {
      id: "source:mixpanel-help",
      name: "help.mixpanel.com",
      feeds: "feature inventory",
      stamp: "214 articles · 21 Jul",
    },
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

const amplitudeObject: CompetitorObject = {
  id: "competitor:amplitude",
  name: "Amplitude",
  classification: "DIRECT",
  domain: "amplitude.com",
  threat: "big threat",
  sentiment: 61,
  reviewCount: 84,
  verifiedAgo: "6 h ago",
  summary:
    "One thing changed since you last looked. The free-tier event cap dropped from one million to 500k events a month — a squeeze on the self-serve motion you compete with.",
  changeEvidence: [
    {
      id: "ev:amplitude-pricing-diff",
      kind: "source",
      label: "1 source",
      count: 1,
      objectId: "source:amplitude-pricing-diff",
    },
  ],
  theyBeatYouOn: ["Experimentation suite", "Enterprise references"],
  youBeatThemOn: ["Setup time", "Pricing clarity"],
  reviewEvidence: {
    line: [
      { text: "Sentiment " },
      { text: "61", tone: "mono" },
      { text: " across " },
      { text: "84", tone: "mono" },
      { text: " reviews, steady since spring." },
    ],
    quotes: [
      {
        id: "quote:amplitude-cap",
        text: "The new event cap pushed us onto a paid plan two quarters early.",
        attribution: "G2 · 30 Jul · ★★★",
        sourceId: "source:amplitude-g2",
      },
      {
        id: "quote:amplitude-experiment",
        text: "Experiment is genuinely good — the rest of the suite is a learning curve.",
        attribution: "G2 · 15 Jul · ★★★★",
        sourceId: "source:amplitude-g2",
      },
    ],
  },
  sources: [
    {
      id: "source:amplitude-site",
      name: "amplitude.com",
      feeds: "site crawl",
      stamp: "checked 6 h ago",
    },
    {
      id: "source:amplitude-changelog",
      name: "amplitude.com/changelog",
      feeds: "watching for changes",
      stamp: "confirmed 2 d ago",
    },
    {
      id: "source:amplitude-g2",
      name: "G2",
      feeds: "review mining",
      stamp: "84 reviews · 30 Jul",
    },
  ],
  openThread: null,
  filedThreads: [],
};

const heapObject: CompetitorObject = {
  id: "competitor:heap",
  name: "Heap",
  classification: "DIRECT",
  domain: "heap.io",
  threat: "watch",
  sentiment: 58,
  reviewCount: 37,
  verifiedAgo: "16 d ago",
  stale: true,
  staleDays: 16,
  summary:
    "Last confirmed movement was 18 Jul, when the pricing page was reworked around sessions rather than events. Nothing has been verified since.",
  changeEvidence: [
    {
      id: "ev:heap-pricing-diff",
      kind: "source",
      label: "1 source",
      count: 1,
      objectId: "source:heap-pricing-diff",
    },
  ],
  theyBeatYouOn: ["Autocapture depth"],
  youBeatThemOn: ["Query speed", "Governance"],
  sources: [
    {
      id: "source:heap-site",
      name: "heap.io",
      feeds: "site crawl",
      stamp: "checked 16 d ago",
      stale: true,
    },
    {
      id: "source:heap-g2",
      name: "G2",
      feeds: "review mining",
      stamp: "37 reviews · 8 Jul",
    },
  ],
  openThread: null,
  filedThreads: [],
};

/** Minimal object derived from a row, for competitors without a rich mock. */
export function deriveObjectFromRow(row: CompetitorRow): CompetitorObject {
  const summary = row.change
    ? row.change.line
    : row.confirmedQuietSince
      ? `Nothing new since ${row.confirmedQuietSince} — pricing, changelog and reviews all confirmed.`
      : `The profile was drafted from ${row.domain} and is kept current by the site crawl.`;
  const changeEvidence: readonly EvidenceRef[] = row.change
    ? row.change.evidence
    : [
        {
          id: `ev:${row.id}-crawl`,
          kind: "source",
          label: "1 source",
          count: 1,
          objectId: `source:${competitorSlug(row.id)}-site`,
        },
      ];
  const object: CompetitorObject = {
    id: row.id,
    name: row.name,
    classification: row.classification,
    domain: row.domain,
    threat: row.threat,
    verifiedAgo: row.verifiedAgo,
    summary,
    changeEvidence,
    theyBeatYouOn: [],
    youBeatThemOn: [],
    sources: [
      {
        id: `source:${competitorSlug(row.id)}-site`,
        name: row.domain,
        feeds: "site crawl",
        stamp: `checked ${row.verifiedAgo}`,
        ...(row.stale ? { stale: true } : {}),
      },
    ],
    openThread: null,
    filedThreads: [],
  };
  if (row.sentiment !== undefined) {
    object.sentiment = row.sentiment;
  }
  if (row.reviewCount !== undefined) {
    object.reviewCount = row.reviewCount;
  }
  if (row.stale) {
    object.stale = true;
  }
  if (row.staleDays !== undefined) {
    object.staleDays = row.staleDays;
  }
  if (row.lastRunFailed) {
    object.lastRunFailed = row.lastRunFailed;
  }
  if (row.change?.unseen) {
    object.changeUnseen = true;
  }
  return object;
}

const richObjects: readonly CompetitorObject[] = [
  mixpanelObject,
  amplitudeObject,
  heapObject,
];

export function makeObjects(
  rows: readonly CompetitorRow[],
): Record<string, CompetitorObject> {
  const objects: Record<string, CompetitorObject> = {};
  for (const row of rows) {
    const rich = richObjects.find((object) => object.id === row.id);
    objects[row.id] = rich
      ? { ...rich, threat: row.threat, verifiedAgo: row.verifiedAgo }
      : deriveObjectFromRow(row);
  }
  return objects;
}

// ---------------------------------------------------------------------------
// Add flow — initial state, URL handling and the mock research pipeline
// ---------------------------------------------------------------------------

export const initialAddFlow: AddFlowState = {
  open: false,
  mode: "url",
  draft: "",
  phase: "input",
  stages: [],
};

/** Prepend https:// when missing; validate as URL. Returns the bare domain. */
export function normaliseDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) {
      return null;
    }
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function domainFromName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${slug || "competitor"}.com`;
}

function properName(domain: string): string {
  const stem = domain.split(".")[0] ?? domain;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

export interface ResearchStageScript {
  id: string;
  runningLabel: string;
  doneLabel: string;
  completedIn: string;
  skipped?: boolean;
  skippedLabel?: string;
}

/** The 2.3 stage set; rows skip with a stated reason when a stage cannot run. */
export function makeStageScripts(
  domain: string,
  searchKeyMissing: boolean,
): readonly ResearchStageScript[] {
  return [
    {
      id: "read",
      runningLabel: `Reading ${domain}…`,
      doneLabel: `Read ${domain}`,
      completedIn: "9 s",
    },
    {
      id: "changelog",
      runningLabel: "Looking for their changelog and help centre…",
      doneLabel: `Found changelog — ${domain}/changelog · watching for changes`,
      completedIn: "14 s",
    },
    {
      id: "reviews",
      runningLabel: "Mining reviews…",
      doneLabel: "Read 84 reviews · sentiment 61",
      completedIn: "41 s",
      ...(searchKeyMissing
        ? {
            skipped: true,
            skippedLabel: "Skipped reviews — needs a web-search key.",
          }
        : {}),
    },
    {
      id: "compare",
      runningLabel: "Comparing against your 142 features…",
      doneLabel: "Compared against your 142 features",
      completedIn: "22 s",
    },
    {
      id: "draft",
      runningLabel: "Drafting the profile…",
      doneLabel: "Drafted the profile",
      completedIn: "11 s",
    },
  ];
}

export const provenanceLine =
  "Everything found here is kept with its source — you can always see why Discoveree believes something.";

export function makeProposal(
  domain: string,
  searchKeyMissing: boolean,
): CompetitorProposal {
  const name = properName(domain);
  const evidence: EvidenceRef[] = [
    {
      id: `ev:proposal-${domain}-sources`,
      kind: "source",
      label: "4 sources",
      count: 4,
      objectId: `source:${domain}-crawl`,
    },
  ];
  if (!searchKeyMissing) {
    evidence.push({
      id: `ev:proposal-${domain}-reviews`,
      kind: "source",
      label: "84 reviews",
      count: 84,
      objectId: `source:${domain}-reviews`,
    });
  }
  evidence.push(featureInventoryChip);
  return {
    name,
    domain,
    classification: "DIRECT",
    suggestedThreat: "big threat",
    summaryLine: searchKeyMissing
      ? `Read ${domain} · 5 findings · 1 m 12 s`
      : `Read ${domain} · 5 findings · 84 reviews · 1 m 40 s`,
    summary: `${name} sells product analytics to product-led teams, led by self-serve onboarding and a deep free tier. The pricing page pushes annual plans hard, the changelog ships roughly weekly, and the positioning leans on being the “complete” data stack — which overlaps two of your strategy pillars.`,
    theyBeatYouOn: ["Free tier depth", "Experimentation", "Template gallery"],
    youBeatThemOn: ["Time to first dashboard", "Governance"],
    evidence,
    ...(searchKeyMissing
      ? {
          crawlOnlyNote:
            "Built from their site alone — add a web-search key and I’ll mine reviews too.",
        }
      : { sentiment: 61, reviewCount: 84 }),
  };
}

export function makeUnreachableFailure(domain: string): {
  domain: string;
  line: string;
} {
  return {
    domain,
    line: `We couldn’t reach ${domain} — the site didn’t answer.`,
  };
}

/** The row that materialises in the list when a proposal is accepted (2.4). */
export function rowFromProposal(proposal: CompetitorProposal): CompetitorRow {
  const id = `competitor:${competitorSlug(proposal.domain.split(".")[0] ?? proposal.domain)}`;
  return {
    id,
    name: proposal.name,
    classification: proposal.classification,
    domain: proposal.domain,
    threat: proposal.suggestedThreat,
    ...(proposal.sentiment !== undefined
      ? { sentiment: proposal.sentiment }
      : {}),
    ...(proposal.reviewCount !== undefined
      ? { reviewCount: proposal.reviewCount }
      : {}),
    verifiedAgo: "just now",
    stale: false,
    verifiedOrder: 0,
    change: {
      line: `Now tracking — the first profile is drafted and ${proposal.domain} is being watched.`,
      evidence: proposal.evidence,
      unseen: true,
    },
  };
}

export function objectFromProposal(
  proposal: CompetitorProposal,
): CompetitorObject {
  const row = rowFromProposal(proposal);
  const sources = [
    {
      id: `source:${proposal.domain}-crawl`,
      name: proposal.domain,
      feeds: "site crawl",
      stamp: "checked just now",
    },
    {
      id: `source:${proposal.domain}-changelog`,
      name: `${proposal.domain}/changelog`,
      feeds: "watching for changes",
      stamp: "confirmed just now",
    },
    ...(proposal.reviewCount !== undefined
      ? [
          {
            id: `source:${proposal.domain}-reviews`,
            name: "G2",
            feeds: "review mining",
            stamp: `${proposal.reviewCount} reviews · just now`,
          },
        ]
      : []),
  ];
  return {
    id: row.id,
    name: proposal.name,
    classification: proposal.classification,
    domain: proposal.domain,
    threat: proposal.suggestedThreat,
    ...(proposal.sentiment !== undefined
      ? { sentiment: proposal.sentiment }
      : {}),
    ...(proposal.reviewCount !== undefined
      ? { reviewCount: proposal.reviewCount }
      : {}),
    verifiedAgo: "just now",
    summary: proposal.summary,
    changeUnseen: true,
    changeEvidence: proposal.evidence,
    theyBeatYouOn: proposal.theyBeatYouOn,
    youBeatThemOn: proposal.youBeatThemOn,
    sources,
    openThread: null,
    filedThreads: [],
  };
}

// ---------------------------------------------------------------------------
// Day-one proposals (spec 2.5)
// ---------------------------------------------------------------------------

export const onboardingProposals: readonly OnboardingCompetitorProposal[] = [
  {
    id: "proposal:pendo",
    name: "Pendo",
    reason: "Named alongside you on comparison pages",
  },
  {
    id: "proposal:heap",
    name: "Heap",
    reason: "Appears in the same G2 category",
  },
  {
    id: "proposal:june",
    name: "June",
    reason: "Positions on the same three keywords",
  },
  {
    id: "proposal:smartlook",
    name: "Smartlook",
    reason: "Named twice in your own feedback",
  },
];

/** Rows created when day-one onboarding proposals are accepted. */
export function rowFromProposalSeed(
  seed: OnboardingCompetitorProposal,
): CompetitorRow {
  const domain = domainFromName(seed.name);
  return {
    id: `competitor:${competitorSlug(seed.id)}`,
    name: seed.name,
    classification: "DIRECT",
    domain,
    threat: "watch",
    verifiedAgo: "verified just now",
    stale: false,
    verifiedOrder: 0,
    change: {
      line: "Now tracking — the first profile has been drafted and its sources are being watched.",
      evidence: [
        {
          id: `ev:${seed.id}-crawl`,
          kind: "source",
          label: "1 source",
          count: 1,
          objectId: `source:${domain}-crawl`,
        },
      ],
      unseen: true,
    },
  };
}

export function makeStages(
  scripts: readonly ResearchStageScript[],
  completedCount: number,
  runningIndex: number | null,
): readonly AddStage[] {
  const stages: AddStage[] = [];
  scripts.forEach((script, index) => {
    if (index < completedCount) {
      if (script.skipped) {
        stages.push({
          id: script.id,
          label: script.skippedLabel ?? script.doneLabel,
          status: "skipped",
        });
      } else {
        stages.push({
          id: script.id,
          label: script.doneLabel,
          status: "done",
          completedIn: script.completedIn,
        });
      }
    } else if (index === runningIndex) {
      stages.push({
        id: script.id,
        label: script.runningLabel,
        status: "running",
      });
    }
  });
  return stages;
}
