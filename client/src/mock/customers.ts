import type {
  CustomersOverview,
  EvidenceRef,
  FeedbackItemRef,
  FitWord,
  OnboardingCompetitorProposal,
  RichSegment,
  RichText,
  SegmentAdoptionProposal,
  SegmentObject,
  SegmentRow,
  ThemeLifecycle,
  ThemeObject,
  ThemeRow,
} from "./types";

/**
 * Mock data + pure helpers for the Customers module. Ordering, the lede's
 * priority ladder and the lifecycle formulas live here (data-side, as the
 * server will own them) so components stay dumb. Sentiment and mention
 * figures are data — the client never invents a number.
 */

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

const lifecycleRank: Record<ThemeLifecycle, number> = {
  forming: 0,
  established: 1,
  fading: 2,
};

const fitRank: Record<FitWord, number> = {
  "strong fit": 0,
  "moderate fit": 1,
  "weak fit": 2,
};

/** Lifecycle → mentions descending; stale rows rise within their band. */
export function orderThemes(rows: readonly ThemeRow[]): readonly ThemeRow[] {
  return [...rows].sort(
    (a, b) =>
      lifecycleRank[a.lifecycle] - lifecycleRank[b.lifecycle] ||
      Number(b.stale) - Number(a.stale) ||
      b.mentionCount - a.mentionCount ||
      a.name.localeCompare(b.name),
  );
}

/** Fit descending (unrated last), then staleness, then name. */
export function orderSegments(
  rows: readonly SegmentRow[],
): readonly SegmentRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.fit ? fitRank[a.fit] : 3) - (b.fit ? fitRank[b.fit] : 3) ||
      Number(b.stale) - Number(a.stale) ||
      a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle — observed from the evidence, never set by hand (spec 4.2)
// ---------------------------------------------------------------------------

export interface LifecycleInputs {
  mentionCount: number;
  firstHeardDaysAgo: number;
  lastMentionDaysAgo: number;
  sourceKindCount: number;
  segmentCount: number;
}

/**
 * The fixed, documented rules: fading — no new mention in 45 days;
 * established — 5+ mentions across 2+ source kinds or 2+ segments;
 * forming — fewer than 5 mentions, or first heard within 14 days.
 */
export function computeLifecycle(inputs: LifecycleInputs): ThemeLifecycle {
  if (inputs.lastMentionDaysAgo > 45) {
    return "fading";
  }
  if (
    inputs.mentionCount >= 5 &&
    (inputs.sourceKindCount >= 2 || inputs.segmentCount >= 2) &&
    inputs.firstHeardDaysAgo > 14
  ) {
    return "established";
  }
  return "forming";
}

/** Mono ordinal for the filing result line: 1st, 2nd, 3rd, 12th… */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// ---------------------------------------------------------------------------
// The lede — priority ladder (spec 1.2)
// ---------------------------------------------------------------------------

export interface CustomersLedeOptions {
  /** Rung 1 detail: where most of the forming theme's mentions come from. */
  formingFrom?: { id: string; name: string };
  /** Rung 2: a sentiment move past the fixed threshold. */
  sentimentMove?: {
    themeId: string;
    themeName: string;
    from: number;
    to: number;
    since: string;
  };
  /** Rung 3 figures. */
  arrivedThisMonth?: number;
}

export function buildCustomersLede(
  themes: readonly ThemeRow[],
  segments: readonly SegmentRow[],
  options: CustomersLedeOptions = {},
): RichText {
  const segs: RichSegment[] = [];
  const forming = themes.find((theme) => theme.lifecycle === "forming");

  if (forming) {
    segs.push({ text: "A new theme is forming: " });
    segs.push({ text: forming.name, tone: "link", objectId: forming.id });
    segs.push({ text: " — " });
    segs.push({ text: String(forming.mentionCount), tone: "mono" });
    segs.push({ text: " mentions in a fortnight" });
    if (options.formingFrom) {
      segs.push({ text: ", most of them from " });
      segs.push({
        text: options.formingFrom.name,
        tone: "link",
        objectId: options.formingFrom.id,
      });
    }
    segs.push({ text: "." });
  } else if (options.sentimentMove) {
    const move = options.sentimentMove;
    segs.push({ text: "Sentiment on " });
    segs.push({ text: move.themeName, tone: "link", objectId: move.themeId });
    segs.push({ text: ` has ${move.to < move.from ? "slipped" : "risen"} from ` });
    segs.push({ text: String(move.from), tone: "mono" });
    segs.push({ text: " to " });
    segs.push({ text: String(move.to), tone: "mono" });
    segs.push({ text: ` since ${move.since}.` });
  } else if (themes.length > 0) {
    segs.push({ text: "Nothing new is forming across your " });
    segs.push({ text: String(themes.length), tone: "mono" });
    segs.push({ text: " themes" });
    if (options.arrivedThisMonth !== undefined) {
      segs.push({ text: " — " });
      segs.push({ text: String(options.arrivedThisMonth), tone: "mono" });
      segs.push({
        text: " pieces of feedback arrived this month and all of them filed under existing themes",
      });
    }
    segs.push({ text: "." });
  }

  for (const segment of segments.filter((row) => row.stale)) {
    if (segs.length > 0) {
      segs.push({ text: " " });
    }
    segs.push({ text: segment.name, tone: "stale", objectId: segment.id });
    segs.push({ text: " hasn’t been verified in " });
    segs.push({ text: String(segment.staleDays ?? 31), tone: "mono" });
    segs.push({ text: " days." });
  }

  return segs;
}

// ---------------------------------------------------------------------------
// The feedback store — one record per verbatim (spec part 5)
// ---------------------------------------------------------------------------

const feedbackStore: readonly FeedbackItemRef[] = [
  // CSV export limits (forming)
  {
    id: "feedback:csv-1",
    text: "We hit the export cap every single month-end. Ten thousand rows is nothing for us.",
    provenance: { kind: "manual", label: "customer call · logged by you", date: "28 Jul" },
    segmentId: "segment:midmarket-ops",
    segmentName: "Mid-market ops teams",
    themeId: "theme:csv-export-limits",
    themeName: "CSV export limits",
  },
  {
    id: "feedback:csv-2",
    text: "Exports over 10k rows silently truncate. We found out during an audit. Not fun.",
    provenance: {
      kind: "review",
      label: "G2 review",
      detail: "★★☆",
      date: "24 Jul",
      minedOn: "2 Aug",
      sourceUrl: "https://www.g2.com/products/analytics-platform-pro/reviews",
    },
    segmentId: "segment:midmarket-ops",
    segmentName: "Mid-market ops teams",
    themeId: "theme:csv-export-limits",
    themeName: "CSV export limits",
  },
  {
    id: "feedback:csv-3",
    text: "Bulk CSV export, please. Every ops team I know scripts around this.",
    provenance: {
      kind: "import",
      label: "CSV import · support-export.csv",
      date: "21 Jul",
    },
    segmentId: "segment:midmarket-ops",
    segmentName: "Mid-market ops teams",
    themeId: "theme:csv-export-limits",
    themeName: "CSV export limits",
  },
  {
    id: "feedback:csv-4",
    text: "The export limit is the one thing stopping a full rollout to our agency clients.",
    provenance: {
      kind: "review",
      label: "Capterra review",
      detail: "★★★",
      // Undated mined item: the review carries no authored date — we say so,
      // and the gathered date stays a separate fact.
      minedOn: "4 Aug",
      sourceUrl: "https://www.capterra.com/p/analytics-platform-pro/reviews",
    },
    segmentId: "segment:agencies",
    segmentName: "Agencies",
    themeId: "theme:csv-export-limits",
    themeName: "CSV export limits",
  },
  // Slow dashboard load (established)
  {
    id: "feedback:dash-1",
    text: "Dashboards take 20+ seconds on Monday mornings. The team opens spreadsheets instead.",
    provenance: { kind: "manual", label: "support ticket · logged by you", date: "30 Jul" },
    segmentId: "segment:enterprise-data",
    segmentName: "Enterprise data teams",
    themeId: "theme:slow-dashboard-load",
    themeName: "Slow dashboard load",
  },
  {
    id: "feedback:dash-2",
    text: "Love the product, but the dashboard spinner is a running joke in our stand-up.",
    provenance: {
      kind: "review",
      label: "G2 review",
      detail: "★★★★",
      // Old-dated review, recently mined: said in February, gathered now.
      date: "11 Feb",
      minedOn: "2 Aug",
      sourceUrl: "https://www.g2.com/products/analytics-platform-pro/reviews",
    },
    themeId: "theme:slow-dashboard-load",
    themeName: "Slow dashboard load",
  },
  // Onboarding confusion (established, mixed)
  {
    id: "feedback:onb-1",
    text: "The guided setup is the best I've seen. We were live in an afternoon.",
    provenance: { kind: "review", label: "G2 review", detail: "★★★★★", date: "18 Jul", minedOn: "2 Aug", sourceUrl: "https://www.g2.com/products/analytics-platform-pro/reviews" },
    segmentId: "segment:agencies",
    segmentName: "Agencies",
    themeId: "theme:onboarding-confusion",
    themeName: "Onboarding confusion",
  },
  {
    id: "feedback:onb-2",
    text: "Setup assumes you know your event schema already. Our ops team stalled for two weeks.",
    provenance: { kind: "manual", label: "sales conversation · logged by you", date: "15 Jul" },
    segmentId: "segment:midmarket-ops",
    segmentName: "Mid-market ops teams",
    themeId: "theme:onboarding-confusion",
    themeName: "Onboarding confusion",
  },
  {
    id: "feedback:onb-3",
    text: "Onboarding emails arrive in the wrong order if you skip the demo call.",
    provenance: { kind: "import", label: "CSV import · support-export.csv", date: "9 Jul" },
    themeId: "theme:onboarding-confusion",
    themeName: "Onboarding confusion",
  },
  // Warehouse sync limits (established, crossover)
  {
    id: "feedback:wh-1",
    text: "We switched from Mixpanel because the exports kept failing — but your warehouse sync has its own row limits.",
    provenance: {
      kind: "review",
      label: "G2 review",
      detail: "★★★",
      date: "12 Jul",
      minedOn: "2 Aug",
      sourceUrl: "https://www.g2.com/products/analytics-platform-pro/reviews",
    },
    segmentId: "segment:enterprise-data",
    segmentName: "Enterprise data teams",
    themeId: "theme:warehouse-sync-limits",
    themeName: "Warehouse sync limits",
    competitorId: "competitor:mixpanel",
    competitorName: "Mixpanel",
  },
  {
    id: "feedback:wh-2",
    text: "Sync to Snowflake needs a per-table cap raise every quarter. Make it self-serve.",
    provenance: { kind: "manual", label: "customer call · logged by you", date: "8 Jul" },
    segmentId: "segment:enterprise-data",
    segmentName: "Enterprise data teams",
    themeId: "theme:warehouse-sync-limits",
    themeName: "Warehouse sync limits",
  },
  // Pricing surprise at renewal (established, stale theme)
  {
    id: "feedback:price-1",
    text: "Renewal came in 40% up with no warning. We nearly churned over the surprise, not the price.",
    provenance: { kind: "manual", label: "customer call · logged by you", date: "24 Jun" },
    segmentId: "segment:midmarket-ops",
    segmentName: "Mid-market ops teams",
    themeId: "theme:pricing-surprise",
    themeName: "Pricing surprise at renewal",
  },
  // Mobile dashboards (fading)
  {
    id: "feedback:mob-1",
    text: "A phone view of the exec dashboard would save me printing it. Not urgent.",
    provenance: { kind: "manual", label: "email · logged by you", date: "2 Jun" },
    themeId: "theme:mobile-dashboards",
    themeName: "Mobile dashboards",
  },
  // SSO setup friction (fading)
  {
    id: "feedback:sso-1",
    text: "Okta setup needed three support round-trips. Docs cover Azure only.",
    provenance: { kind: "import", label: "CSV import · support-export.csv", date: "19 May" },
    segmentId: "segment:enterprise-data",
    segmentName: "Enterprise data teams",
    themeId: "theme:sso-friction",
    themeName: "SSO setup friction",
  },
  // Unfiled pool
  {
    id: "feedback:unfiled-1",
    text: "Could the weekly digest email include the raw numbers, not just the chart?",
    provenance: { kind: "manual", label: "email · logged by you", date: "1 Aug" },
  },
  {
    id: "feedback:unfiled-2",
    text: "Is there a keyboard shortcut to duplicate a dashboard? Couldn't find one.",
    provenance: { kind: "manual", label: "support ticket · logged by you", date: "31 Jul" },
  },
  {
    id: "feedback:unfiled-3",
    text: "Your API rate limits reset at midnight UTC which is lunchtime for us in Sydney.",
    provenance: {
      kind: "review",
      label: "G2 review",
      detail: "★★★",
      minedOn: "3 Aug",
      sourceUrl: "https://www.g2.com/products/analytics-platform-pro/reviews",
    },
  },
];

export function itemsForTheme(themeId: string): readonly FeedbackItemRef[] {
  return feedbackStore.filter((item) => item.themeId === themeId);
}

export function itemsForSegment(
  segmentId: string,
): readonly FeedbackItemRef[] {
  return feedbackStore.filter((item) => item.segmentId === segmentId);
}

export function unfiledItems(): readonly FeedbackItemRef[] {
  return feedbackStore.filter((item) => !item.themeId);
}

/** The crossover record (spec part 5): one ID, cited from both modules. */
export const crossoverFeedbackId = "feedback:wh-1";

// ---------------------------------------------------------------------------
// Theme rows
// ---------------------------------------------------------------------------

const mentionChip = (
  themeId: string,
  count: number,
): EvidenceRef => ({
  id: `ev:${themeId}-mentions`,
  kind: "feedback",
  label: `${count} mentions`,
  count,
  objectId: themeId,
});

const csvTheme: ThemeRow = {
  id: "theme:csv-export-limits",
  name: "CSV export limits",
  lifecycle: computeLifecycle({
    mentionCount: 9,
    firstHeardDaysAgo: 10,
    lastMentionDaysAgo: 1,
    sourceKindCount: 3,
    segmentCount: 2,
  }), // → forming (first heard 10 days ago)
  mentionCount: 9,
  sentiment: 41,
  trend: "rising",
  sourceKindCount: 3,
  refreshedAgo: "2 d ago",
  stale: false,
  change: {
    line: "Nine mentions in a fortnight — the pace doubled after the June pricing change.",
    evidence: [
      mentionChip("theme:csv-export-limits", 9),
      {
        id: "ev:csv-reviews",
        kind: "source",
        label: "2 reviews",
        count: 2,
        objectId: "feedback:csv-2",
      },
    ],
    unseen: true,
  },
};

const slowDashboardTheme: ThemeRow = {
  id: "theme:slow-dashboard-load",
  name: "Slow dashboard load",
  lifecycle: computeLifecycle({
    mentionCount: 41,
    firstHeardDaysAgo: 120,
    lastMentionDaysAgo: 4,
    sourceKindCount: 3,
    segmentCount: 2,
  }), // → established
  mentionCount: 41,
  sentiment: 44,
  trend: "steady",
  sourceKindCount: 3,
  refreshedAgo: "1 d ago",
  stale: false,
  change: {
    line: "Six new mentions this month, all from enterprise accounts on Monday mornings.",
    evidence: [mentionChip("theme:slow-dashboard-load", 41)],
    unseen: false,
  },
};

const onboardingTheme: ThemeRow = {
  id: "theme:onboarding-confusion",
  name: "Onboarding confusion",
  lifecycle: computeLifecycle({
    mentionCount: 23,
    firstHeardDaysAgo: 90,
    lastMentionDaysAgo: 6,
    sourceKindCount: 3,
    segmentCount: 2,
  }), // → established
  mentionCount: 23,
  sentimentMixed: true,
  trend: "steady",
  sourceKindCount: 3,
  refreshedAgo: "3 d ago",
  stale: false,
  change: {
    line: "Agencies praise the guided setup; ops teams report it as a blocker.",
    evidence: [mentionChip("theme:onboarding-confusion", 23)],
    unseen: false,
  },
};

const warehouseTheme: ThemeRow = {
  id: "theme:warehouse-sync-limits",
  name: "Warehouse sync limits",
  lifecycle: computeLifecycle({
    mentionCount: 12,
    firstHeardDaysAgo: 60,
    lastMentionDaysAgo: 9,
    sourceKindCount: 2,
    segmentCount: 1,
  }), // → established
  mentionCount: 12,
  sentiment: 38,
  trend: "rising",
  sourceKindCount: 2,
  refreshedAgo: "2 d ago",
  stale: false,
  quietSince: "23 Jul",
};

const pricingTheme: ThemeRow = {
  id: "theme:pricing-surprise",
  name: "Pricing surprise at renewal",
  lifecycle: computeLifecycle({
    mentionCount: 8,
    firstHeardDaysAgo: 150,
    lastMentionDaysAgo: 20,
    sourceKindCount: 2,
    segmentCount: 1,
  }), // → established
  mentionCount: 8,
  sentiment: 31,
  sourceKindCount: 2,
  refreshedAgo: "9 d ago",
  stale: true,
  staleDays: 9,
};

const mobileTheme: ThemeRow = {
  id: "theme:mobile-dashboards",
  name: "Mobile dashboards",
  lifecycle: computeLifecycle({
    mentionCount: 6,
    firstHeardDaysAgo: 200,
    lastMentionDaysAgo: 62,
    sourceKindCount: 2,
    segmentCount: 1,
  }), // → fading
  mentionCount: 6,
  sentiment: 55,
  sourceKindCount: 2,
  refreshedAgo: "5 d ago",
  stale: false,
  quietSince: "2 Jun",
};

const ssoTheme: ThemeRow = {
  id: "theme:sso-friction",
  name: "SSO setup friction",
  lifecycle: computeLifecycle({
    mentionCount: 4,
    firstHeardDaysAgo: 180,
    lastMentionDaysAgo: 77,
    sourceKindCount: 1,
    segmentCount: 1,
  }), // → fading
  mentionCount: 4,
  sourceKindCount: 1,
  refreshedAgo: "6 d ago",
  stale: false,
  quietSince: "19 May",
};

const briefingThemes = orderThemes([
  csvTheme,
  slowDashboardTheme,
  onboardingTheme,
  warehouseTheme,
  pricingTheme,
  mobileTheme,
  ssoTheme,
]);

// ---------------------------------------------------------------------------
// Segment rows
// ---------------------------------------------------------------------------

const midmarketRow: SegmentRow = {
  id: "segment:midmarket-ops",
  entityId: "entity:midmarket-ops",
  name: "Mid-market ops teams",
  fit: "strong fit",
  personaCount: 2,
  feedbackCount: 21,
  sentiment: 58,
  jtbdLine:
    "They hire you to close the month-end books faster; their top unmet need is bulk CSV export.",
  verifiedAgo: "12 d ago",
  stale: false,
};

const agenciesRow: SegmentRow = {
  id: "segment:agencies",
  entityId: "entity:agencies",
  name: "Agencies",
  type: "vertical",
  fit: "moderate fit",
  personaCount: 1,
  feedbackCount: 9,
  sentiment: 71,
  jtbdLine:
    "They hire you to prove campaign impact to their clients without building dashboards by hand.",
  verifiedAgo: "8 d ago",
  stale: false,
};

const enterpriseRow: SegmentRow = {
  id: "segment:enterprise-data",
  entityId: "entity:enterprise-data",
  name: "Enterprise data teams",
  fit: "weak fit",
  personaCount: 1,
  feedbackCount: 11,
  sentiment: 46,
  jtbdLine:
    "They hire you as the analytics front door on top of their warehouse — and hit your sync limits.",
  verifiedAgo: "34 d ago",
  stale: true,
  staleDays: 34,
};

const partnersRow: SegmentRow = {
  id: "segment:implementation-partners",
  entityId: "entity:implementation-partners",
  name: "Implementation partners",
  type: "partnership",
  personaCount: 1,
  feedbackCount: 2,
  verifiedAgo: "6 d ago",
  stale: false,
  // No jtbdLine: the row shows the quiet invitation (spec 1.4).
};

const briefingSegments = orderSegments([
  midmarketRow,
  agenciesRow,
  enterpriseRow,
  partnersRow,
]);

// ---------------------------------------------------------------------------
// Theme Objects
// ---------------------------------------------------------------------------

function baseThemeObject(row: ThemeRow): ThemeObject {
  const object: ThemeObject = {
    id: row.id,
    name: row.name,
    lifecycle: row.lifecycle,
    mentionCount: row.mentionCount,
    refreshedAgo: row.refreshedAgo,
    summary: row.change
      ? row.change.line
      : row.quietSince
        ? `No new mentions since ${row.quietSince} — holding at ${row.mentionCount}.`
        : `Holding at ${row.mentionCount} mentions.`,
    changeEvidence: row.change
      ? row.change.evidence
      : [mentionChip(row.id, row.mentionCount)],
    items: itemsForTheme(row.id),
    sources: [
      {
        id: `source:${row.id}-manual`,
        name: "Logged by you",
        feeds: "manual entries",
        stamp: "continuous",
      },
    ],
    openThread: null,
    filedThreads: [],
  };
  if (row.sentiment !== undefined) {
    object.sentiment = row.sentiment;
  }
  if (row.sentimentMixed) {
    object.sentimentMixed = true;
  }
  if (row.trend) {
    object.trend = row.trend;
  }
  if (row.stale) {
    object.stale = true;
  }
  if (row.staleDays !== undefined) {
    object.staleDays = row.staleDays;
  }
  if (row.change?.unseen) {
    object.changeUnseen = true;
  }
  return object;
}

function makeThemeObjects(
  rows: readonly ThemeRow[],
): Record<string, ThemeObject> {
  const objects: Record<string, ThemeObject> = {};
  for (const row of rows) {
    objects[row.id] = baseThemeObject(row);
  }
  const csv = objects["theme:csv-export-limits"];
  if (csv) {
    csv.firstHeard = "25 Jul";
    csv.summary =
      "Nine mentions in a fortnight, from three source kinds — the pace doubled after the June pricing change.";
    csv.segmentBreakdown = [
      {
        segmentId: "segment:midmarket-ops",
        name: "Mid-market ops teams",
        mentions: 6,
        sentiment: 38,
      },
      { segmentId: "segment:agencies", name: "Agencies", mentions: 2 },
    ];
    csv.sources = [
      {
        id: "source:csv-manual",
        name: "Logged by you",
        feeds: "manual entries",
        stamp: "continuous",
      },
      {
        id: "source:csv-g2",
        name: "G2",
        feeds: "review mining",
        stamp: "84 reviews · 2 Aug",
      },
      {
        id: "source:csv-import",
        name: "support-export.csv",
        feeds: "CSV import",
        stamp: "120 rows · 21 Jul",
      },
    ];
  }
  const onboarding = objects["theme:onboarding-confusion"];
  if (onboarding) {
    onboarding.firstHeard = "6 May";
    onboarding.summary =
      "Genuinely split: agencies praise the guided setup; ops teams report it as a blocker. A quarter of mentions sit on each side of 50.";
    onboarding.segmentBreakdown = [
      {
        segmentId: "segment:midmarket-ops",
        name: "Mid-market ops teams",
        mentions: 9,
        sentiment: 33,
      },
      {
        segmentId: "segment:agencies",
        name: "Agencies",
        mentions: 8,
        sentiment: 74,
      },
    ];
  }
  const warehouse = objects["theme:warehouse-sync-limits"];
  if (warehouse) {
    warehouse.firstHeard = "4 Jun";
    warehouse.segmentBreakdown = [
      {
        segmentId: "segment:enterprise-data",
        name: "Enterprise data teams",
        mentions: 10,
        sentiment: 36,
      },
    ];
  }
  return objects;
}

// ---------------------------------------------------------------------------
// Segment Objects
// ---------------------------------------------------------------------------

function makeSegmentObjects(
  rows: readonly SegmentRow[],
): Record<string, SegmentObject> {
  const objects: Record<string, SegmentObject> = {};

  objects["segment:midmarket-ops"] = {
    id: "segment:midmarket-ops",
    entityId: "entity:midmarket-ops",
    name: "Mid-market ops teams",
    fit: "strong fit",
    feedbackCount: 21,
    sentiment: 58,
    verifiedAgo: "12 d ago",
    summary:
      "Eight new feedback items this month, six of them about exports — this segment now drives the CSV export limits theme.",
    changeEvidence: [
      {
        id: "ev:midmarket-feedback",
        kind: "feedback",
        label: "8 feedback items",
        count: 8,
        objectId: "segment:midmarket-ops",
      },
      {
        id: "ev:midmarket-theme",
        kind: "theme",
        label: "theme: CSV export limits",
        objectId: "theme:csv-export-limits",
      },
    ],
    changeUnseen: true,
    jobsToBeDone: {
      items: [
        "Close the month-end books faster than the finance calendar demands.",
        "Prove data accuracy to auditors without hand-built spreadsheets.",
        "Give every ops analyst self-serve numbers without a BI queue.",
      ],
      basis: {
        feedbackCount: 14,
        reviewCount: 6,
        thin: false,
      },
    },
    needs: {
      items: [
        { id: "need:bulk-export", text: "Bulk CSV export past the 10k-row cap", satisfied: "satisfied 1 of 5" },
        { id: "need:audit-trail", text: "An audit trail on edited dashboards", satisfied: "satisfied 3 of 5" },
        { id: "need:role-views", text: "Role-scoped views for analysts" },
      ],
      basis: {
        feedbackCount: 11,
        reviewCount: 4,
        thin: false,
      },
    },
    personas: [
      {
        id: "persona:ops-lead",
        title: "Ops lead",
        identityLine:
          "Runs a 4–10 person operations team; owns month-end; lives in spreadsheets and dashboards.",
        goals:
          "Close the books by working day three; stop being the human export pipeline.",
        pains:
          "Row caps at exactly the wrong moment; audit requests that mean rebuilding numbers by hand.",
        basis: {
          feedbackCount: 23,
          reviewCount: 12,
          ownerProvided: "interview",
          thin: false,
        },
      },
      {
        id: "persona:finance-analyst",
        title: "Finance analyst",
        identityLine:
          "Reconciles the ops numbers into the finance system; second pair of eyes on month-end.",
        goals:
          "Early signs suggest they want one export that matches the ledger without manual joins.",
        basis: {
          feedbackCount: 3,
          thin: true,
          singleSourceKind: true,
        },
      },
    ],
    recentItems: itemsForSegment("segment:midmarket-ops").slice(0, 3),
    satisfaction: {
      csat: 72,
      nps: 18,
      responses: 34,
      period: "Jun 2026",
    },
    sources: [
      {
        id: "source:midmarket-feedback",
        name: "Feedback",
        feeds: "21 linked items",
        stamp: "newest 28 Jul",
      },
      {
        id: "source:midmarket-interview",
        name: "Your interview",
        feeds: "segment identity",
        stamp: "answered 12 Mar",
      },
      {
        id: "source:midmarket-g2",
        name: "G2",
        feeds: "review mining",
        stamp: "84 reviews · 2 Aug",
      },
    ],
    openThread: null,
    filedThreads: [
      {
        id: "thread:midmarket-pricing",
        title: "Would usage pricing fit ops teams?",
        filedOn: "17 Jul",
      },
    ],
  };

  objects["segment:agencies"] = {
    id: "segment:agencies",
    entityId: "entity:agencies",
    name: "Agencies",
    type: "vertical",
    fit: "moderate fit",
    feedbackCount: 9,
    sentiment: 71,
    verifiedAgo: "8 d ago",
    summary:
      "Two new mentions this month, both warm — agencies keep praising the guided setup they resell to clients.",
    changeEvidence: [
      {
        id: "ev:agencies-feedback",
        kind: "feedback",
        label: "2 feedback items",
        count: 2,
        objectId: "segment:agencies",
      },
    ],
    // Owner-provided JTBD: the asserted register, never dressed as research.
    jobsToBeDone: {
      items: [
        "Prove campaign impact to their clients without building dashboards by hand.",
        "White-label reporting they can charge for.",
      ],
      basis: {
        ownerProvided: "interview",
        thin: false,
      },
    },
    personas: [
      {
        id: "persona:account-director",
        title: "Account director",
        identityLine:
          "Owns 6–10 client relationships; presents numbers monthly; allergic to raw SQL.",
        goals: "Walk into the client review with the story already visible.",
        pains: "Rebuilding the same report per client; export limits on client data.",
        basis: {
          ownerProvided: "interview",
          reviewCount: 4,
          thin: false,
        },
      },
    ],
    recentItems: itemsForSegment("segment:agencies").slice(0, 3),
    sources: [
      {
        id: "source:agencies-interview",
        name: "Your interview",
        feeds: "segment identity and jobs",
        stamp: "answered 12 Mar",
      },
      {
        id: "source:agencies-feedback",
        name: "Feedback",
        feeds: "9 linked items",
        stamp: "newest 18 Jul",
      },
    ],
    openThread: null,
    filedThreads: [],
  };

  objects["segment:enterprise-data"] = {
    id: "segment:enterprise-data",
    entityId: "entity:enterprise-data",
    name: "Enterprise data teams",
    fit: "weak fit",
    feedbackCount: 11,
    sentiment: 46,
    verifiedAgo: "34 d ago",
    stale: true,
    staleDays: 34,
    summary:
      "Last verified 1 Jul. Since then the warehouse sync limits theme has gained ten mentions from this segment.",
    changeEvidence: [
      {
        id: "ev:enterprise-theme",
        kind: "theme",
        label: "theme: warehouse sync limits",
        objectId: "theme:warehouse-sync-limits",
      },
    ],
    jobsToBeDone: {
      items: [
        "Put a friendly analytics front door on top of the warehouse they already govern.",
      ],
      basis: {
        feedbackCount: 7,
        thin: false,
      },
    },
    personas: [
      {
        id: "persona:data-platform-lead",
        title: "Data platform lead",
        identityLine:
          "Owns the warehouse and the tooling budget; measures everything in rows per second.",
        goals: "Keep analytics self-serve without losing governance.",
        pains: "Per-table sync caps; support round-trips for limit raises.",
        basis: {
          feedbackCount: 9,
          reviewCount: 2,
          thin: false,
        },
      },
    ],
    recentItems: itemsForSegment("segment:enterprise-data").slice(0, 3),
    sources: [
      {
        id: "source:enterprise-feedback",
        name: "Feedback",
        feeds: "11 linked items",
        stamp: "newest 30 Jul",
      },
    ],
    openThread: null,
    filedThreads: [],
  };

  objects["segment:implementation-partners"] = {
    id: "segment:implementation-partners",
    entityId: "entity:implementation-partners",
    name: "Implementation partners",
    type: "partnership",
    feedbackCount: 2,
    verifiedAgo: "6 d ago",
    // No summary/jobsToBeDone/needs: the JTBD invitation renders (3.5), and
    // with no linked feedback the section-7 invitation renders too.
    personas: [],
    recentItems: [],
    sources: [
      {
        id: "source:partners-manual",
        name: "Added by you",
        feeds: "segment identity",
        stamp: "created 29 Jul",
      },
    ],
    openThread: null,
    filedThreads: [],
  };

  // Only keep objects whose rows exist (mock hygiene).
  for (const key of Object.keys(objects)) {
    if (!rows.some((row) => row.id === key)) {
      delete objects[key];
    }
  }
  return objects;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export interface CustomersDataset {
  overview: CustomersOverview;
  themes: Record<string, ThemeObject>;
  segments: Record<string, SegmentObject>;
}

export function makeCustomers(options?: {
  searchKeyMissing?: boolean;
  /** Multi-product markers on the shared segment (spec 3.2). */
  multiProduct?: { otherProduct: { id: string; name: string } };
}): CustomersDataset {
  const themes = briefingThemes.map((row) => ({ ...row }));
  const segments = briefingSegments.map((row) => ({ ...row }));
  const segmentObjects = makeSegmentObjects(segments);

  if (options?.multiProduct) {
    const other = options.multiProduct.otherProduct;
    const shared = segments.find((row) => row.id === "segment:midmarket-ops");
    if (shared) {
      shared.alsoServedBy = [other];
    }
    const sharedObject = segmentObjects["segment:midmarket-ops"];
    if (sharedObject) {
      sharedObject.sharedAcrossProducts = true;
      sharedObject.alsoServedBy = [other];
    }
  }

  return {
    overview: {
      lede: buildCustomersLede(themes, segments, {
        formingFrom: {
          id: "segment:midmarket-ops",
          name: "Mid-market ops teams",
        },
      }),
      themes,
      segments,
      unfiledCount: unfiledItems().length,
      searchKeyMissing: options?.searchKeyMissing ?? false,
    },
    themes: makeThemeObjects(themes),
    segments: segmentObjects,
  };
}

/** Onboarding-proposed segments (day-one proposals variant, spec 2.4). */
export const segmentOnboardingProposals: readonly OnboardingCompetitorProposal[] =
  [
    {
      id: "proposal:midmarket-ops",
      name: "Mid-market ops teams",
      reason: "Your pricing page speaks to mid-market ops teams",
    },
    {
      id: "proposal:agencies",
      name: "Agencies",
      reason: "Your case studies all feature agency rollouts",
    },
    {
      id: "proposal:enterprise-data",
      name: "Enterprise data teams",
      reason: "Named twice in your interview",
    },
  ];

/** The adoption card (spec 3.4) — an existing org entity, reviewed here. */
export function makeSegmentAdoption(servedBy: {
  id: string;
  name: string;
}): SegmentAdoptionProposal {
  return {
    entityId: "entity:midmarket-ops",
    name: "Mid-market ops teams",
    servedBy: { ...servedBy, since: "Mar 2026" },
    sharedIdentity:
      "Operations teams of 4–10 people in 100–1,000-seat companies, owning month-end close and reporting. They buy tools that shorten the close and survive audits.",
    personas: [
      {
        id: "persona:ops-lead",
        title: "Ops lead",
        identityLine:
          "Runs a 4–10 person operations team; owns month-end; lives in spreadsheets and dashboards.",
        basis: {
          feedbackCount: 23,
          reviewCount: 12,
          ownerProvided: "interview",
          thin: false,
        },
      },
    ],
    evidence: [
      {
        id: "ev:adoption-feedback",
        kind: "feedback",
        label: "21 feedback items",
        count: 21,
        objectId: "segment:midmarket-ops",
      },
      {
        id: "ev:adoption-interview",
        kind: "source",
        label: "your interview · 12 Mar",
        objectId: "source:midmarket-interview",
      },
    ],
  };
}

/** Row + minimal object for a segment accepted from a proposal/adoption. */
export function segmentFromName(
  name: string,
  seedId: string,
): { row: SegmentRow; object: SegmentObject } {
  const slug = seedId.split(":").pop() ?? "segment";
  const id = `segment:${slug}`;
  const row: SegmentRow = {
    id,
    entityId: `entity:${slug}`,
    name,
    verifiedAgo: "just now",
    stale: false,
  };
  const object: SegmentObject = {
    id,
    entityId: `entity:${slug}`,
    name,
    verifiedAgo: "just now",
    personas: [],
    recentItems: [],
    sources: [
      {
        id: `source:${slug}-created`,
        name: "Added by you",
        feeds: "segment identity",
        stamp: "created just now",
      },
    ],
    openThread: null,
    filedThreads: [],
  };
  return { row, object };
}

export const initialFeedbackFlow = {
  open: false,
  draft: "",
} as const;
