import {
  apiUrl,
  daysSince,
  relativeStamp,
  shortDateOf,
  ApiError,
} from "@/lib/api";
import {
  buildCustomersLede,
  computeLifecycle,
  orderSegments,
  orderThemes,
} from "@/mock/customers";
import type {
  CustomersOverview,
  EvidenceBasis,
  EvidenceRef,
  FeedbackItemRef,
  FitWord,
  NeedRow,
  PersonaBlock,
  SegmentObject,
  SegmentRow,
  ThemeObject,
  ThemeRow,
} from "@/mock/types";

/**
 * Live API layer + mappers for the Customers module (ADR 004 §6, verified
 * against server/modules/customers/routes.ts). Figures rendered by the
 * client are computed — mention counts from the server's computed columns,
 * lifecycle from the documented formulas over member entries, sentiment only
 * where its basis exists. Per-segment feedback counts are NOT claimed: the
 * server's evidence pool is product-wide (no feedback→segment linkage yet),
 * so segment rows omit feedbackCount rather than dress the pool as linkage.
 */

// ---------------------------------------------------------------------------
// Server payload shapes (mirrors routes.ts serialisers)
// ---------------------------------------------------------------------------

export interface ServerEvidenceStatus {
  count: number;
  distinctSources: number;
  newestAt: string | null;
  thresholds: { persona: number; insights: number };
  sufficientFor: string[];
}

export type ServerSegmentType =
  | "customer_segment"
  | "industry_vertical"
  | "primary_persona"
  | "partnership";

export interface ServerSegmentCard {
  id: string; // facet id — the stable segment id
  entityId: string;
  name: string;
  segmentType: ServerSegmentType;
  status: "proposed" | "tracked";
  provenance: string;
  isIcp: boolean;
  icpFit: "strong" | "moderate" | "weak" | null;
  personaCount: number;
  evidenceStatus: ServerEvidenceStatus;
  enrichmentStatus: "pending" | "enriching" | "completed" | "failed";
  lastEnrichedAt: string | null;
}

export interface ServerEvidenceRef {
  kind: string;
  id?: string;
  url?: string;
  source?: string;
  note?: string;
}

export interface ServerEvidenceClaim {
  text: string;
  evidenceRefs?: ServerEvidenceRef[];
}

export interface ServerJobsToBeDone {
  coreJob?: ServerEvidenceClaim | null;
  summary?: string | null;
  functionalJobs?: ServerEvidenceClaim[];
  emotionalJobs?: ServerEvidenceClaim[];
  socialJobs?: ServerEvidenceClaim[];
  desiredOutcomes?: ServerEvidenceClaim[];
}

export interface ServerNeedClaim {
  need: string;
  importance?: number | null;
  evidenceRefs?: ServerEvidenceRef[];
}

export interface ServerPersonaView {
  id: string;
  facetId: string;
  title: string;
  description: string | null;
  demographics: {
    role?: string | null;
    industry?: string | null;
    companySize?: string | null;
    experience?: string | null;
  } | null;
  behaviours: string[] | null;
  goals: ServerEvidenceClaim[] | null;
  painPoints: ServerEvidenceClaim[] | null;
  jobsToBeDone: ServerJobsToBeDone | null;
  facetStatus: string;
  provenance: string;
}

export interface ServerSegmentQuote {
  text?: string;
  source?: string;
  sourceUrl?: string;
  attribution?: string;
  date?: string;
}

export interface ServerSegmentDetail extends ServerSegmentCard {
  description: string | null;
  needsSummary: string | null;
  needs: ServerNeedClaim[] | null;
  jobsToBeDone: ServerJobsToBeDone | null;
  overallSatisfaction: number | null;
  csatScore: number | null;
  npsScore: number | null;
  quotes: ServerSegmentQuote[] | null;
  researchItems:
    | { title?: string; notes?: string; url?: string; addedAt?: string }[]
    | null;
  segmentInsights: { text: string; evidenceRefs?: ServerEvidenceRef[] } | null;
  personas: ServerPersonaView[];
}

export interface ServerFeedbackEntry {
  id: string;
  isCompetitor: boolean;
  competitorEntityId: string | null;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: string;
  verified: boolean;
  topic: string | null;
  quotedText: string;
  sentiment: number | null;
  reviewerName: string | null;
  collectedAt: string | null;
  /** Authored-at-source; null = undated ("date unknown"). */
  sourceCreatedAt: string | null;
  archivedAt: string | null;
}

export interface ServerTheme {
  id: string;
  themeName: string;
  aliases: string[];
  summary: string | null;
  status: string;
  priority: string | null;
  mentionCount: number;
  averageSentiment: number | null;
  /** Both figures computed server-side over the member entries. */
  evidence: { count: number; distinctSources: number };
  confidence: number | null;
  coherence: number | null;
  feedbackEntryIds: string[];
  consolidationSuggested: boolean;
  lastUpdatedAt: string | null;
}

/** The customers run-status payload (competitors runs/active pattern). */
export interface ServerCustomersActiveRun {
  active: boolean;
  kind?: "collect" | "aggregate" | "enrich";
  /** Segment facet id — enrich runs only. */
  targetId?: string;
  agentLabel?: string;
  startedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) {
    return undefined as T;
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body — payload stays null.
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, payload);
  }
  return payload as T;
}

function productApi(productId: string, path: string): string {
  return `/api/products/${encodeURIComponent(productId)}${path}`;
}

export const customersApi = {
  listSegments: (productId: string, includeProposed = false) =>
    request<{ segments: ServerSegmentCard[] }>(
      productApi(
        productId,
        includeProposed ? "/segments?include=proposed" : "/segments",
      ),
    ),
  getSegment: (productId: string, id: string) =>
    request<{ segment: ServerSegmentDetail }>(
      productApi(productId, `/segments/${encodeURIComponent(id)}`),
    ),
  patchSegment: (
    productId: string,
    id: string,
    body: {
      name?: string;
      segmentType?: ServerSegmentType;
      icpFit?: "strong" | "moderate" | "weak" | null;
      csatScore?: number | null;
      npsScore?: number | null;
    },
  ) =>
    request<{ segment: ServerSegmentCard }>(
      productApi(productId, `/segments/${encodeURIComponent(id)}`),
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteSegment: (productId: string, id: string) =>
    request<void>(productApi(productId, `/segments/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  enrichSegment: (productId: string, id: string) =>
    request<{ runId: string }>(
      productApi(productId, `/segments/${encodeURIComponent(id)}/enrich`),
      { method: "POST" },
    ),
  listFeedback: (productId: string, limit = 200) =>
    request<{ feedback: ServerFeedbackEntry[] }>(
      productApi(productId, `/feedback?isCompetitor=false&limit=${limit}`),
    ),
  createFeedback: (
    productId: string,
    body: {
      quotedText: string;
      sourceName?: string;
      topic?: string;
      sourceCreatedAt?: string;
    },
  ) =>
    request<{ feedback: ServerFeedbackEntry }>(
      productApi(productId, "/feedback"),
      { method: "POST", body: JSON.stringify(body) },
    ),
  listThemes: (productId: string) =>
    request<{ themes: ServerTheme[]; unfiledCount: number }>(
      productApi(productId, "/themes"),
    ),
  patchTheme: (
    productId: string,
    themeId: string,
    body: { themeName?: string; status?: string },
  ) =>
    request<{ theme: ServerTheme }>(
      productApi(productId, `/themes/${encodeURIComponent(themeId)}`),
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  mergeThemes: (productId: string, survivorId: string, absorbThemeId: string) =>
    request<{ theme: ServerTheme }>(
      productApi(productId, `/themes/${encodeURIComponent(survivorId)}/merge`),
      { method: "POST", body: JSON.stringify({ absorbThemeId }) },
    ),
  aggregateThemes: (productId: string) =>
    request<{ runId: string }>(productApi(productId, "/themes/aggregate"), {
      method: "POST",
    }),
  getActiveRun: (productId: string) =>
    request<ServerCustomersActiveRun>(
      productApi(productId, "/customers/runs/active"),
    ),
};

// ---------------------------------------------------------------------------
// Mapping — feedback entries
// ---------------------------------------------------------------------------

/** The entry's honest date (server date discipline): authored-at, or entry
 * time for manual entries; mined-undated ⇒ null. */
export function effectiveEntryDate(entry: ServerFeedbackEntry): Date | null {
  if (entry.sourceCreatedAt) {
    return new Date(entry.sourceCreatedAt);
  }
  if (entry.sourceType === "manual" && entry.collectedAt) {
    return new Date(entry.collectedAt);
  }
  return null;
}

/** Resolves a competitor entity id to the client-side object id + name. */
export type CompetitorResolver = ReadonlyMap<
  string,
  { id: string; name: string }
>;

export function itemFromEntry(
  entry: ServerFeedbackEntry,
  themeByEntryId: ReadonlyMap<string, { id: string; name: string }>,
  competitorsByEntityId?: CompetitorResolver,
): FeedbackItemRef {
  const manual = entry.sourceType === "manual";
  const label = manual
    ? entry.sourceName && entry.sourceName !== "Manual"
      ? `${entry.sourceName.toLowerCase()} · logged by you`
      : "logged by you"
    : `${entry.sourceName} review`;
  const theme = themeByEntryId.get(entry.id);
  const item: FeedbackItemRef = {
    id: entry.id,
    text: entry.quotedText,
    provenance: {
      kind: manual ? "manual" : "review",
      label,
      ...(entry.sourceCreatedAt
        ? { date: shortDateOf(entry.sourceCreatedAt) }
        : manual && entry.collectedAt
          ? { date: shortDateOf(entry.collectedAt) }
          : {}),
      ...(!manual && entry.collectedAt
        ? { minedOn: shortDateOf(entry.collectedAt) }
        : {}),
      ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
    },
  };
  if (theme) {
    item.themeId = theme.id;
    item.themeName = theme.name;
  }
  // Crossover ruling (spec part 5): own-product feedback naming a tracked
  // competitor carries the competitor chip — one record, two doors.
  if (entry.competitorEntityId && !entry.isCompetitor) {
    const competitor = competitorsByEntityId?.get(entry.competitorEntityId);
    if (competitor) {
      item.competitorId = competitor.id;
      item.competitorName = competitor.name;
    }
  }
  return item;
}

// ---------------------------------------------------------------------------
// Mapping — themes
// ---------------------------------------------------------------------------

export interface ThemeMappingInputs {
  theme: ServerTheme;
  entriesById: ReadonlyMap<string, ServerFeedbackEntry>;
  seenEntryIds: ReadonlySet<string>;
  competitorsByEntityId?: CompetitorResolver;
}

const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;

export function rowFromTheme({
  theme,
  entriesById,
  seenEntryIds,
}: ThemeMappingInputs): ThemeRow {
  const members = theme.feedbackEntryIds
    .map((id) => entriesById.get(id))
    .filter((entry): entry is ServerFeedbackEntry => entry !== undefined);
  const dates = members
    .map(effectiveEntryDate)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const oldest = dates[0];
  const newest = dates[dates.length - 1];
  const now = Date.now();

  const lifecycle = computeLifecycle({
    mentionCount: theme.mentionCount,
    firstHeardDaysAgo: oldest
      ? Math.floor((now - oldest.getTime()) / 86_400_000)
      : 999,
    lastMentionDaysAgo: newest
      ? Math.floor((now - newest.getTime()) / 86_400_000)
      : 999,
    // Served computed over ALL member entries — never re-derived from a
    // capped feedback fetch.
    sourceKindCount: Math.max(theme.evidence.distinctSources, 1),
    segmentCount: 1, // no feedback→segment linkage server-side yet
  });

  // Sentiment honesty (spec 4.3): mean only from ≥3 mentions; a genuinely
  // bimodal spread (≥25% each side of 50, ≥4 scored) renders "mixed".
  const scores = members
    .map((entry) => entry.sentiment)
    .filter((score): score is number => typeof score === "number");
  const low = scores.filter((score) => score < 50).length;
  const high = scores.filter((score) => score > 50).length;
  const mixed =
    scores.length >= 4 &&
    low / scores.length >= 0.25 &&
    high / scores.length >= 0.25;

  const recent = dates.filter((date) => now - date.getTime() <= FORTNIGHT_MS);
  const recentIds = members
    .filter((entry) => {
      const at = effectiveEntryDate(entry);
      return at !== null && now - at.getTime() <= FORTNIGHT_MS;
    })
    .map((entry) => entry.id);
  const unseen = recentIds.some((id) => !seenEntryIds.has(id));

  const row: ThemeRow = {
    id: theme.id,
    name: theme.themeName,
    lifecycle,
    mentionCount: theme.mentionCount,
    refreshedAgo: theme.lastUpdatedAt
      ? relativeStamp(theme.lastUpdatedAt)
      : "",
    stale:
      theme.lastUpdatedAt !== null && daysSince(theme.lastUpdatedAt) > 7,
  };
  if (row.stale && theme.lastUpdatedAt) {
    row.staleDays = daysSince(theme.lastUpdatedAt);
  }
  if (theme.evidence.distinctSources > 0) {
    row.sourceKindCount = theme.evidence.distinctSources;
  }
  if (mixed) {
    row.sentimentMixed = true;
  } else if (theme.averageSentiment !== null && theme.mentionCount >= 3) {
    row.sentiment = Math.round(theme.averageSentiment);
  }
  if (recent.length > 0) {
    row.change = {
      line: `${recent.length} mention${recent.length === 1 ? "" : "s"} filed this fortnight.`,
      evidence: [
        {
          id: `ev:${theme.id}-recent`,
          kind: "feedback",
          label: `${recent.length} mention${recent.length === 1 ? "" : "s"}`,
          count: recent.length,
          objectId: theme.id,
        },
      ],
      unseen,
    };
  } else if (newest) {
    row.quietSince = shortDateOf(newest.toISOString());
  }
  return row;
}

export function objectFromTheme(
  inputs: ThemeMappingInputs,
): ThemeObject {
  const row = rowFromTheme(inputs);
  const { theme, entriesById } = inputs;
  const members = theme.feedbackEntryIds
    .map((id) => entriesById.get(id))
    .filter((entry): entry is ServerFeedbackEntry => entry !== undefined)
    .sort((a, b) => {
      const at = effectiveEntryDate(a)?.getTime() ?? 0;
      const bt = effectiveEntryDate(b)?.getTime() ?? 0;
      return bt - at;
    });
  const themeRef = { id: theme.id, name: theme.themeName };
  const themeByEntryId = new Map(members.map((entry) => [entry.id, themeRef]));
  const dates = members
    .map(effectiveEntryDate)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const sourceNames = [...new Set(members.map((entry) => entry.sourceName))];

  const object: ThemeObject = {
    id: theme.id,
    name: theme.themeName,
    lifecycle: row.lifecycle,
    mentionCount: theme.mentionCount,
    refreshedAgo: row.refreshedAgo,
    summary:
      theme.summary ??
      (row.change
        ? row.change.line
        : `Holding at ${theme.mentionCount} mention${theme.mentionCount === 1 ? "" : "s"}.`),
    changeEvidence: [
      {
        id: `ev:${theme.id}-mentions`,
        kind: "feedback",
        label: `${theme.evidence.count} mention${theme.evidence.count === 1 ? "" : "s"}`,
        count: theme.evidence.count,
        objectId: theme.id,
      },
    ],
    items: members.map((entry) =>
      itemFromEntry(entry, themeByEntryId, inputs.competitorsByEntityId),
    ),
    sources: sourceNames.map((name) => ({
      id: `source:${theme.id}:${name}`,
      name,
      feeds: name === "Manual" ? "manual entries" : "feedback",
      stamp: "continuous",
    })),
    openThread: null,
    filedThreads: [],
  };
  if (row.sentiment !== undefined) {
    object.sentiment = row.sentiment;
  }
  if (row.sentimentMixed) {
    object.sentimentMixed = true;
  }
  if (row.stale) {
    object.stale = true;
    if (row.staleDays !== undefined) {
      object.staleDays = row.staleDays;
    }
  }
  if (row.change?.unseen) {
    object.changeUnseen = true;
  }
  const oldestDate = dates[0];
  if (oldestDate) {
    object.firstHeard = shortDateOf(oldestDate.toISOString());
  }
  return object;
}

// ---------------------------------------------------------------------------
// Mapping — segments
// ---------------------------------------------------------------------------

const FIT_FROM_SERVER: Record<string, FitWord> = {
  strong: "strong fit",
  moderate: "moderate fit",
  weak: "weak fit",
};

export function fitToServer(
  fit: FitWord | null,
): "strong" | "moderate" | "weak" | null {
  if (fit === "strong fit") return "strong";
  if (fit === "moderate fit") return "moderate";
  if (fit === "weak fit") return "weak";
  return null;
}

function typeFromServer(
  segmentType: ServerSegmentType,
): SegmentRow["type"] {
  if (segmentType === "industry_vertical") return "vertical";
  if (segmentType === "partnership") return "partnership";
  return undefined;
}

export function typeToServer(
  type: "vertical" | "partnership" | null,
): ServerSegmentType {
  if (type === "vertical") return "industry_vertical";
  if (type === "partnership") return "partnership";
  return "customer_segment";
}

export function rowFromSegmentCard(card: ServerSegmentCard): SegmentRow {
  const verified = card.lastEnrichedAt;
  const stale = verified !== null && daysSince(verified) > 30;
  const row: SegmentRow = {
    id: card.id,
    entityId: card.entityId,
    name: card.name,
    verifiedAgo: verified ? relativeStamp(verified) : "",
    stale,
  };
  const type = typeFromServer(card.segmentType);
  if (type) {
    row.type = type;
  }
  if (card.icpFit) {
    const fit = FIT_FROM_SERVER[card.icpFit];
    if (fit) {
      row.fit = fit;
    }
  }
  if (card.personaCount > 0) {
    row.personaCount = card.personaCount;
  }
  if (stale && verified) {
    row.staleDays = daysSince(verified);
  }
  return row;
}

/** Refs → the client basis registers: feedback / quotes / owner. */
function basisFromRefs(
  refs: readonly ServerEvidenceRef[],
  ownerProvenance: boolean,
): EvidenceBasis {
  const feedback = new Set<string>();
  const quotes = new Set<string>();
  let owner = ownerProvenance;
  for (const ref of refs) {
    if (ref.kind === "feedback_entry" && ref.id) {
      feedback.add(ref.id);
    } else if (ref.kind === "quote") {
      quotes.add(ref.url ?? ref.source ?? "quote");
    } else if (ref.kind === "owner") {
      owner = true;
    }
  }
  const kinds =
    (feedback.size > 0 ? 1 : 0) + (quotes.size > 0 ? 1 : 0) + (owner ? 1 : 0);
  const total = feedback.size + quotes.size;
  const basis: EvidenceBasis = {
    thin: !owner && (total < 5 || kinds <= 1),
  };
  if (feedback.size > 0) {
    basis.feedbackCount = feedback.size;
  }
  if (quotes.size > 0) {
    basis.reviewCount = quotes.size;
  }
  if (owner) {
    basis.ownerProvided = "manual";
  }
  if (basis.thin && kinds === 1) {
    basis.singleSourceKind = true;
  }
  return basis;
}

function claimRefs(
  claims: readonly ServerEvidenceClaim[] | null | undefined,
): ServerEvidenceRef[] {
  return (claims ?? []).flatMap((claim) => claim.evidenceRefs ?? []);
}

function jtbdClaims(
  jtbd: ServerJobsToBeDone | null | undefined,
): ServerEvidenceClaim[] {
  if (!jtbd) {
    return [];
  }
  return [
    ...(jtbd.coreJob ? [jtbd.coreJob] : []),
    ...(jtbd.functionalJobs ?? []),
    ...(jtbd.emotionalJobs ?? []),
    ...(jtbd.socialJobs ?? []),
  ];
}

function personaFromView(view: ServerPersonaView): PersonaBlock | null {
  const identityParts = [
    view.demographics?.role,
    view.demographics?.industry,
    view.demographics?.companySize,
    ...(view.behaviours ?? []).slice(0, 2),
  ].filter((part): part is string => Boolean(part));
  const refs = [
    ...claimRefs(view.goals),
    ...claimRefs(view.painPoints),
    ...claimRefs(jtbdClaims(view.jobsToBeDone)),
  ];
  const basis = basisFromRefs(refs, view.provenance === "owner");
  // The 0.5 contract: a persona with an empty basis cannot render. Live
  // data that somehow violates it is dropped, never displayed.
  if (
    basis.feedbackCount === undefined &&
    basis.reviewCount === undefined &&
    !basis.ownerProvided
  ) {
    return null;
  }
  const goals = (view.goals ?? []).map((claim) => claim.text).join(" ");
  const pains = (view.painPoints ?? []).map((claim) => claim.text).join(" ");
  const block: PersonaBlock = {
    id: view.id,
    title: view.title,
    identityLine:
      identityParts.join(" · ") || view.description || "Identity not yet drafted.",
    basis,
  };
  if (goals) {
    block.goals = goals;
  }
  if (pains) {
    block.pains = pains;
  }
  return block;
}

export function objectFromSegmentDetail(
  detail: ServerSegmentDetail,
): SegmentObject {
  const row = rowFromSegmentCard(detail);
  const object: SegmentObject = {
    id: detail.id,
    entityId: detail.entityId,
    name: detail.name,
    verifiedAgo: row.verifiedAgo,
    personas: detail.personas
      .filter((persona) => persona.facetStatus !== "proposed")
      .map(personaFromView)
      .filter((persona): persona is PersonaBlock => persona !== null),
    recentItems: (detail.quotes ?? [])
      .filter((quote) => Boolean(quote.text))
      .slice(0, 3)
      .map((quote, index) => ({
        id: `quote:${detail.id}:${index}`,
        text: quote.text ?? "",
        provenance: {
          kind: "review" as const,
          label: quote.source ?? "Web",
          ...(quote.date ? { date: quote.date } : {}),
          ...(quote.sourceUrl ? { sourceUrl: quote.sourceUrl } : {}),
        },
      })),
    openThread: null,
    filedThreads: [],
  };
  if (row.type) {
    object.type = row.type;
  }
  if (row.fit) {
    object.fit = row.fit;
  }
  if (row.stale) {
    object.stale = true;
    if (row.staleDays !== undefined) {
      object.staleDays = row.staleDays;
    }
  }
  if (detail.overallSatisfaction !== null) {
    object.sentiment = detail.overallSatisfaction;
  }

  // Jobs to be done — the facet's claims with their computed basis.
  const jtbd = jtbdClaims(detail.jobsToBeDone);
  const jtbdItems = jtbd.map((claim) => claim.text);
  if (jtbdItems.length > 0) {
    object.jobsToBeDone = {
      items: jtbdItems,
      basis: basisFromRefs(claimRefs(jtbd), detail.provenance === "owner"),
    };
  }

  const needs = (detail.needs ?? []).filter((need) => Boolean(need.need));
  if (needs.length > 0) {
    const needRows: NeedRow[] = needs.map((need, index) => ({
      id: `need:${detail.id}:${index}`,
      text: need.need,
      ...(typeof need.importance === "number"
        ? { satisfied: `importance ${need.importance} of 5` }
        : {}),
    }));
    object.needs = {
      items: needRows,
      basis: basisFromRefs(
        needs.flatMap((need) => need.evidenceRefs ?? []),
        detail.provenance === "owner",
      ),
    };
  }

  if (detail.segmentInsights?.text) {
    object.summary = detail.segmentInsights.text;
    const refs = detail.segmentInsights.evidenceRefs ?? [];
    const evidence: EvidenceRef[] = refs.slice(0, 1).map(() => ({
      id: `ev:${detail.id}-insights`,
      kind: "feedback" as const,
      label: `${refs.length} evidence item${refs.length === 1 ? "" : "s"}`,
      count: refs.length,
      objectId: detail.id,
    }));
    object.changeEvidence = evidence;
  }

  if (detail.csatScore !== null || detail.npsScore !== null) {
    object.satisfaction = {
      ...(detail.csatScore !== null ? { csat: detail.csatScore } : {}),
      ...(detail.npsScore !== null ? { nps: detail.npsScore } : {}),
    };
  }

  const sources: { id: string; name: string; feeds: string; stamp: string }[] =
    [];
  if (detail.evidenceStatus.count > 0) {
    sources.push({
      id: `source:${detail.id}:evidence`,
      name: "Evidence pool",
      feeds: `${detail.evidenceStatus.count} items · ${detail.evidenceStatus.distinctSources} source${detail.evidenceStatus.distinctSources === 1 ? "" : "s"}`,
      stamp: detail.evidenceStatus.newestAt
        ? `newest ${shortDateOf(detail.evidenceStatus.newestAt)}`
        : "undated",
    });
  }
  if (detail.provenance === "owner") {
    sources.push({
      id: `source:${detail.id}:owner`,
      name: "Added by you",
      feeds: "segment identity",
      stamp: "owner",
    });
  }
  if (sources.length > 0) {
    object.sources = sources;
  }
  return object;
}

// ---------------------------------------------------------------------------
// Composition — the whole customers slice from server payloads
// ---------------------------------------------------------------------------

export interface CustomersServerData {
  segments: ServerSegmentCard[];
  themes: ServerTheme[];
  unfiledCount: number;
  entries: ServerFeedbackEntry[];
  /** Fetched detail per segment id (eager — segment sets are small). */
  details: ReadonlyMap<string, ServerSegmentDetail>;
  seenEntryIds: ReadonlySet<string>;
  /** For the part-5 crossover chip on own-product verbatims. */
  competitorsByEntityId?: CompetitorResolver;
}

export function composeCustomers(data: CustomersServerData): {
  overview: CustomersOverview;
  themes: Record<string, ThemeObject>;
  segments: Record<string, SegmentObject>;
} {
  const entriesById = new Map(data.entries.map((entry) => [entry.id, entry]));
  const activeThemes = data.themes.filter(
    (theme) => theme.status !== "dismissed",
  );
  const themeRows = orderThemes(
    activeThemes.map((theme) =>
      rowFromTheme({
        theme,
        entriesById,
        seenEntryIds: data.seenEntryIds,
      }),
    ),
  );
  const themeObjects: Record<string, ThemeObject> = {};
  for (const theme of activeThemes) {
    themeObjects[theme.id] = objectFromTheme({
      theme,
      entriesById,
      seenEntryIds: data.seenEntryIds,
      ...(data.competitorsByEntityId
        ? { competitorsByEntityId: data.competitorsByEntityId }
        : {}),
    });
  }

  const trackedCards = data.segments.filter(
    (card) => card.status !== "proposed",
  );
  const segmentRows = orderSegments(trackedCards.map(rowFromSegmentCard));
  const segmentObjects: Record<string, SegmentObject> = {};
  for (const card of trackedCards) {
    const detail = data.details.get(card.id);
    segmentObjects[card.id] = detail
      ? objectFromSegmentDetail(detail)
      : {
          id: card.id,
          entityId: card.entityId,
          name: card.name,
          verifiedAgo: rowFromSegmentCard(card).verifiedAgo,
          personas: [],
          recentItems: [],
          openThread: null,
          filedThreads: [],
        };
    // The row's JTBD line comes from the detail's facet summary.
    const jtbdLine =
      detail?.jobsToBeDone?.summary ?? detail?.jobsToBeDone?.coreJob?.text;
    const row = segmentRows.find((candidate) => candidate.id === card.id);
    if (row && jtbdLine) {
      row.jtbdLine = jtbdLine;
    }
  }

  return {
    overview: {
      lede: buildCustomersLede(themeRows, segmentRows, {}),
      themes: themeRows,
      segments: segmentRows,
      ...(data.unfiledCount > 0 ? { unfiledCount: data.unfiledCount } : {}),
      searchKeyMissing: false,
    },
    themes: themeObjects,
    segments: segmentObjects,
  };
}

/** Human-readable insufficient-evidence notice from the 422 payload. */
export function enrichNoticeFrom(status: ServerEvidenceStatus): string {
  return `Not enough evidence to enrich yet — ${status.count} item${status.count === 1 ? "" : "s"} from ${status.distinctSources} source${status.distinctSources === 1 ? "" : "s"}. Personas need ${status.thresholds.persona} items from 2 sources; insights need ${status.thresholds.insights}. Log feedback to firm it up.`;
}
