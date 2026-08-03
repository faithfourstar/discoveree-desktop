import type {
  CompetitorObject,
  CompetitorProposal,
  CompetitorRow,
  EvidenceRef,
  ThreatWord,
} from "@/mock/types";

/**
 * Live API layer for the desktop server (binds 127.0.0.1:7317).
 *
 * In dev the Vite proxy forwards /api to the server; in a packaged build the
 * SPA is served by the same Express process, so relative URLs hold there too.
 * `VITE_API_BASE` overrides the base for any other arrangement.
 */

const API_BASE: string =
  (import.meta.env["VITE_API_BASE"] as string | undefined) ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** Error carrying the HTTP status and the server's JSON payload (if any). */
export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

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
    // Non-JSON body (proxy error page etc.) — payload stays null.
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

// ---------------------------------------------------------------------------
// Server payload shapes (mirrors server/modules/competitors/routes.ts)
// ---------------------------------------------------------------------------

export type ServerThreatLevel = "none" | "watch" | "competitive" | "big_threat";
export type EnrichmentStatus = "pending" | "enriching" | "completed" | "failed";

export interface ServerCompetitorCard {
  id: string;
  name: string;
  classification: "DIRECT" | "ADJACENT";
  domain: string | null;
  summary: string | null;
  threatLevel: ServerThreatLevel;
  enrichmentStatus: EnrichmentStatus;
  lastVerifiedAt: string | null;
  sentiment: number | null;
  reviewCount: number | null;
  /**
   * Review-before-save gate: POST creates a "proposed" row; /accept flips it
   * to "tracked". Proposed rows live only inside the add flow.
   */
  status: "proposed" | "tracked";
}

export interface ServerChange {
  id: string;
  changeType: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  detectedAt: string;
}

export interface ServerCompetitorDetail extends ServerCompetitorCard {
  keyDifferentiators: { text: string; sourceUrl: string | null }[];
  keyFeatures: { feature: string; sourceUrl: string | null }[];
  markets: { market: string; sourceUrl: string | null }[];
  summarySourceUrl: string | null;
}

export interface ServerActiveRun {
  active: boolean;
  competitorId?: string | null;
  competitorName?: string | null;
  agentLabel?: string;
  startedAt?: string | null;
}

export interface ServerProduct {
  id: string;
  name: string;
  url: string | null;
  description: string | null;
}

/** Feed changes carry the competitor name for attribution. */
export interface ServerFeedChange extends ServerChange {
  competitorName?: string;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  getProduct: () =>
    request<{ product: ServerProduct | null }>("/api/product"),
  listCompetitors: (includeProposed = false) =>
    request<{ competitors: ServerCompetitorCard[] }>(
      includeProposed ? "/api/competitors?include=proposed" : "/api/competitors",
    ),
  getCompetitor: (id: string) =>
    request<{
      competitor: ServerCompetitorDetail;
      changes: ServerChange[];
      openThread: null;
      filedThreads: [];
    }>(`/api/competitors/${encodeURIComponent(id)}`),
  createCompetitor: (body: {
    name: string;
    url?: string;
    classification: "DIRECT" | "ADJACENT";
  }) =>
    request<{ competitor: ServerCompetitorCard }>("/api/competitors", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchCompetitor: (
    id: string,
    body: {
      classification?: "DIRECT" | "ADJACENT";
      threatLevel?: ServerThreatLevel;
      url?: string;
      /** Valid only while the row is proposed (400 on tracked; 409 on collision). */
      name?: string;
    },
  ) =>
    request<{ competitor: ServerCompetitorCard }>(
      `/api/competitors/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteCompetitor: (id: string) =>
    request<void>(`/api/competitors/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  refreshCompetitor: (id: string) =>
    request<{ runId: string }>(
      `/api/competitors/${encodeURIComponent(id)}/refresh`,
      { method: "POST" },
    ),
  acceptCompetitor: (id: string) =>
    request<{ competitor: ServerCompetitorCard }>(
      `/api/competitors/${encodeURIComponent(id)}/accept`,
      { method: "POST" },
    ),
  getActiveRun: () =>
    request<ServerActiveRun>("/api/competitors/runs/active"),
  listChanges: (limit = 50, offset = 0) =>
    request<{ changes: ServerFeedChange[]; total: number }>(
      `/api/changes?limit=${limit}&offset=${offset}`,
    ),
};

// ---------------------------------------------------------------------------
// Mapping — server shapes → the client's context shapes
// ---------------------------------------------------------------------------

const THREAT_FROM_SERVER: Record<ServerThreatLevel, ThreatWord> = {
  big_threat: "big threat",
  competitive: "competitive",
  watch: "watch",
  none: "quiet",
};

const THREAT_TO_SERVER: Record<ThreatWord, ServerThreatLevel> = {
  "big threat": "big_threat",
  competitive: "competitive",
  watch: "watch",
  quiet: "none",
};

export function threatFromServer(level: ServerThreatLevel): ThreatWord {
  return THREAT_FROM_SERVER[level] ?? "quiet";
}

export function threatToServer(word: ThreatWord): ServerThreatLevel {
  return THREAT_TO_SERVER[word] ?? "none";
}

const STALE_THRESHOLD_DAYS = 14;

const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" });

/** en-GB relative stamp: "just now", "12 m ago", "4 h ago", "3 d ago", "12 Jul". */
export function relativeStamp(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 90) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days <= STALE_THRESHOLD_DAYS * 2) {
    return `${days} d ago`;
  }
  return shortDate.format(new Date(iso));
}

export function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return 0;
  }
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

export function shortDateOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : shortDate.format(date);
}

/** "since Thursday" within a week, else "since 12 Jul". */
export function freshSinceLabel(iso: string | null): string {
  if (!iso) {
    return "the last check";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "the last check";
  }
  return daysSince(iso) < 7 ? weekday.format(date) : shortDate.format(date);
}

/** The honest lede clause for a change record, generated from its type. */
export function changeClause(changeType: string): string {
  switch (changeType) {
    case "pricing":
      return "changed its pricing";
    case "feature":
      return "shipped a feature change";
    case "announcement":
      return "made an announcement";
    default:
      return "shipped an update";
  }
}

function changeEvidence(change: ServerFeedChange): readonly EvidenceRef[] {
  return [
    {
      id: `ev:change:${change.id}`,
      kind: "source",
      label: "1 source",
      count: 1,
      objectId: `change:${change.id}`,
      ...(change.sourceUrl ? { href: change.sourceUrl } : {}),
    },
  ];
}

export interface RowMappingInputs {
  card: ServerCompetitorCard;
  /** Newest feed change for this competitor, if any. */
  latestChange?: ServerFeedChange | undefined;
  /** Change ids the user has already seen (persisted client-side). */
  seenChangeIds: ReadonlySet<string>;
}

export function rowFromCard({
  card,
  latestChange,
  seenChangeIds,
}: RowMappingInputs): CompetitorRow {
  const verified = card.lastVerifiedAt;
  const stale =
    verified !== null && daysSince(verified) > STALE_THRESHOLD_DAYS;
  const row: CompetitorRow = {
    id: card.id,
    name: card.name,
    classification: card.classification,
    domain: card.domain ?? "",
    threat: threatFromServer(card.threatLevel),
    verifiedAgo: verified ? relativeStamp(verified) : "",
    stale,
    verifiedOrder: verified
      ? Math.max(0, Math.floor((Date.now() - new Date(verified).getTime()) / 3_600_000))
      : Number.MAX_SAFE_INTEGER,
  };
  if (card.sentiment !== null) {
    row.sentiment = card.sentiment;
  }
  if (card.reviewCount !== null) {
    row.reviewCount = card.reviewCount;
  }
  if (stale && verified) {
    row.staleDays = daysSince(verified);
  }
  if (verified === null) {
    // Never verified — the stamp must never render a bare "verified".
    row.unverified = true;
    if (card.enrichmentStatus === "failed") {
      row.lastRunFailed = {
        at: "",
        reason: "couldn’t complete the first check",
      };
      row.unverifiedLabel = "not yet verified";
    } else {
      // Pending/enriching with nothing verified yet.
      row.unverifiedLabel = "profile being drafted · not yet verified";
    }
  } else if (card.enrichmentStatus === "failed") {
    row.lastRunFailed = { at: "", reason: "couldn’t complete the last check" };
  }
  if (latestChange) {
    row.change = {
      line: latestChange.title,
      evidence: changeEvidence(latestChange),
      unseen: !seenChangeIds.has(latestChange.id),
    };
  } else if (verified) {
    row.confirmedQuietSince = shortDateOf(verified);
  }
  return row;
}

/** Strip [n] citation markers — provenance is carried by sourceUrl instead. */
export function stripCitationMarkers(text: string): string {
  return text.replace(/\s*\[\d+\]/g, "").trim();
}

export function objectFromDetail(
  detail: ServerCompetitorDetail,
  changes: readonly ServerChange[],
  row: CompetitorRow,
): CompetitorObject {
  const summarySource: EvidenceRef[] = detail.summarySourceUrl
    ? [
        {
          id: `ev:${detail.id}-summary-source`,
          kind: "source",
          label: "1 source",
          count: 1,
          objectId: `source:${detail.id}-summary`,
          href: detail.summarySourceUrl,
        },
      ]
    : [];
  const object: CompetitorObject = {
    id: detail.id,
    name: detail.name,
    classification: detail.classification,
    domain: detail.domain ?? "",
    threat: threatFromServer(detail.threatLevel),
    verifiedAgo: row.verifiedAgo,
    summary:
      detail.summary ??
      "The profile is being drafted — the first enrichment run is reading their site now.",
    changeEvidence: summarySource,
    theyBeatYouOn: [],
    youBeatThemOn: [],
    differentiators: detail.keyDifferentiators.map((item) => ({
      text: stripCitationMarkers(item.text),
      sourceUrl: item.sourceUrl,
    })),
    keyFeatureList: detail.keyFeatures,
    marketList: detail.markets,
    changes: changes.map((change) => ({
      id: change.id,
      changeType: change.changeType,
      title: change.title,
      description: change.description,
      sourceUrl: change.sourceUrl,
      detectedOn: shortDateOf(change.detectedAt),
    })),
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

/**
 * The 2.4 proposal card, populated from the proposed row's real draft
 * (GET /:id). Nothing is invented: absent draft material renders absent,
 * and a failed first enrichment carries an honest failure note — accepting
 * anyway is the spec-5.1 save-unverified path.
 */
export function proposalFromDetail(
  detail: ServerCompetitorDetail,
): CompetitorProposal {
  const failed = detail.enrichmentStatus === "failed";
  const evidence: EvidenceRef[] = [];
  if (detail.summarySourceUrl) {
    evidence.push({
      id: `ev:${detail.id}-summary-source`,
      kind: "source",
      label: "1 source",
      count: 1,
      objectId: `source:${detail.id}-summary`,
      href: detail.summarySourceUrl,
    });
  }
  if (detail.keyFeatures.length > 0) {
    evidence.push({
      id: `ev:${detail.id}-features`,
      kind: "feature-inventory",
      label: `${detail.keyFeatures.length} features`,
      count: detail.keyFeatures.length,
      objectId: `competitor:${detail.id}:features`,
      ...(detail.keyFeatures[0]?.sourceUrl
        ? { href: detail.keyFeatures[0].sourceUrl }
        : {}),
    });
  }
  const summaryParts: string[] = [
    failed
      ? `${detail.name} · first check couldn’t finish`
      : `Read ${detail.domain ?? detail.name}`,
  ];
  if (!failed) {
    if (detail.keyDifferentiators.length > 0) {
      summaryParts.push(`${detail.keyDifferentiators.length} differentiators`);
    }
    if (detail.keyFeatures.length > 0) {
      summaryParts.push(`${detail.keyFeatures.length} features`);
    }
  }
  const proposal: CompetitorProposal = {
    id: detail.id,
    name: detail.name,
    domain: detail.domain ?? "",
    classification: detail.classification,
    suggestedThreat: threatFromServer(detail.threatLevel),
    summaryLine: summaryParts.join(" · "),
    summary:
      detail.summary ??
      "No draft profile yet — the first enrichment run didn’t produce one.",
    theyBeatYouOn: [],
    youBeatThemOn: [],
    differentiators: detail.keyDifferentiators.map((item) => ({
      text: stripCitationMarkers(item.text),
      sourceUrl: item.sourceUrl,
    })),
    evidence,
  };
  if (detail.sentiment !== null) {
    proposal.sentiment = detail.sentiment;
  }
  if (detail.reviewCount !== null) {
    proposal.reviewCount = detail.reviewCount;
  }
  if (failed) {
    proposal.failureNote =
      "The first check couldn’t finish. You can track them anyway — agents retry on the next check — or try again now.";
  }
  return proposal;
}

/** Minimal object for rows whose detail has not been fetched yet. */
export function objectFromRow(row: CompetitorRow): CompetitorObject {
  const object: CompetitorObject = {
    id: row.id,
    name: row.name,
    classification: row.classification,
    domain: row.domain,
    threat: row.threat,
    verifiedAgo: row.verifiedAgo,
    summary: row.change
      ? row.change.line
      : "The profile is loading from the local server.",
    changeEvidence: row.change ? row.change.evidence : [],
    theyBeatYouOn: [],
    youBeatThemOn: [],
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
