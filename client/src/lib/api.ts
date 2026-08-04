import { displayDateFormat } from "@/lib/locale";
import { countNoun } from "@/lib/text";
import { nextRunStamp, providerMeta } from "@/mock/settings";
import type {
  AboutInfo,
  AgentFrequency,
  AgentScheduleRow,
  CompetitorObject,
  CompetitorProposal,
  CompetitorRow,
  EvidenceRef,
  LlmKeyRow,
  ModuleId,
  ProviderId,
  RichSegment,
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
  /**
   * ADR 003 §2.5: the card keeps the facet id as `id` and gains the
   * org-level entity id it points at. Optional until the entity-join
   * payload lands server-side.
   */
  entityId?: string;
  /**
   * ADR 003 §2.3/§2.5 adoption + cross-product linking: the org's OTHER
   * products holding a tracked facet on the same entity. Non-empty on a
   * proposed row means this proposal is an adoption — the entity was
   * researched once already and nothing is re-researched.
   */
  alsoTrackedBy?: { productId: string; productName: string }[];
}

export interface ServerChange {
  id: string;
  changeType: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  detectedAt: string;
}

/** ADR 004 §6.4 — the review block on the competitor detail payload. */
export interface ServerCompetitorReviews {
  averageRating: number | null;
  totalCount: number | null;
  platforms: string[];
  positiveThemes: string[];
  negativeThemes: string[];
  quotes: {
    text: string;
    source: string;
    sourceUrl: string | null;
    sentiment?: number | null;
    date: string | null;
    /** Unverifiable quotes are stored but flagged — never dressed up. */
    verified?: boolean;
  }[];
}

export interface ServerCompetitorDetail extends ServerCompetitorCard {
  keyDifferentiators: { text: string; sourceUrl: string | null }[];
  keyFeatures: { feature: string; sourceUrl: string | null }[];
  markets: { market: string; sourceUrl: string | null }[];
  summarySourceUrl: string | null;
  /** Absent until the reviews sprint's server serves it (ADR 004 §6.4). */
  reviews?: ServerCompetitorReviews | null;
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
// Server payload shapes — settings (org-scoped, sprint 3a/3b contracts)
// ---------------------------------------------------------------------------

/** The server's provider naming (claude/gemini) differs from the UI's. */
export type ServerLlmProvider =
  | "openai"
  | "gemini"
  | "perplexity"
  | "claude"
  | "openrouter";

export interface ServerLlmKeysView {
  /** Masked keys only — the server has no unmasked read path at all. */
  keys: Record<ServerLlmProvider, string | null>;
  llmKeyMode: "individual" | "openrouter";
}

export interface ServerKeyTestResult {
  ok: boolean;
  /** British-English, user-facing. Present only when ok is false. */
  error?: string;
  /** Structured verdict (added after mismatch #2); ok/error retained. */
  verdict?:
    | "valid"
    | "rejected"
    | "rate-limited"
    | "provider-error"
    | "network"
    | "timeout";
  /** Sanitised provider detail (e.g. the HTTP status line), when useful. */
  detail?: string;
}

export interface ServerAgentSchedule {
  slug: string;
  label: string;
  description: string;
  frequency: string;
  /** null for slugs without a presentation mapping — rendered ungated. */
  moduleGate: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface ServerAgentSchedules {
  pausedAll: boolean;
  agents: ServerAgentSchedule[];
}

export interface ServerAbout {
  dataDir: string;
  dbSizeBytes: number;
  appVersion: string;
  serverPort: number;
}

// ---------------------------------------------------------------------------
// Endpoints — product-scoped resources live under /api/products/:productId
// (ADR 003 §1.1; the singular /api/product convention is deleted, not
// aliased). Org-scoped resources stay flat.
// ---------------------------------------------------------------------------

function productApi(productId: string, path: string): string {
  return `/api/products/${encodeURIComponent(productId)}${path}`;
}

export const api = {
  listProducts: () =>
    request<{ products: ServerProduct[] }>("/api/products"),
  createProduct: (body: { name: string; url?: string }) =>
    request<{ product: ServerProduct }>("/api/products", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getProduct: (productId: string) =>
    request<{ product: ServerProduct }>(productApi(productId, "")),
  listCompetitors: (productId: string, includeProposed = false) =>
    request<{ competitors: ServerCompetitorCard[] }>(
      productApi(
        productId,
        includeProposed ? "/competitors?include=proposed" : "/competitors",
      ),
    ),
  getCompetitor: (productId: string, id: string) =>
    request<{
      competitor: ServerCompetitorDetail;
      changes: ServerChange[];
      openThread: null;
      filedThreads: [];
    }>(productApi(productId, `/competitors/${encodeURIComponent(id)}`)),
  createCompetitor: (
    productId: string,
    body: {
      name: string;
      url?: string;
      classification: "DIRECT" | "ADJACENT";
    },
  ) =>
    request<{ competitor: ServerCompetitorCard }>(
      productApi(productId, "/competitors"),
      { method: "POST", body: JSON.stringify(body) },
    ),
  patchCompetitor: (
    productId: string,
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
      productApi(productId, `/competitors/${encodeURIComponent(id)}`),
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteCompetitor: (productId: string, id: string) =>
    request<void>(
      productApi(productId, `/competitors/${encodeURIComponent(id)}`),
      { method: "DELETE" },
    ),
  refreshCompetitor: (productId: string, id: string) =>
    request<{ runId: string }>(
      productApi(productId, `/competitors/${encodeURIComponent(id)}/refresh`),
      { method: "POST" },
    ),
  acceptCompetitor: (productId: string, id: string) =>
    request<{ competitor: ServerCompetitorCard }>(
      productApi(productId, `/competitors/${encodeURIComponent(id)}/accept`),
      { method: "POST" },
    ),
  getActiveRun: (productId: string) =>
    request<ServerActiveRun>(productApi(productId, "/competitors/runs/active")),
  listChanges: (productId: string, limit = 50, offset = 0) =>
    request<{ changes: ServerFeedChange[]; total: number }>(
      productApi(productId, `/changes?limit=${limit}&offset=${offset}`),
    ),
  // Settings (org-scoped, flat — ADR 003 §1.1)
  getLlmKeys: () => request<ServerLlmKeysView>("/api/settings/llm-keys"),
  /** PUT semantics per field: omitted = unchanged, null = cleared. */
  putLlmKeys: (body: Record<string, string | null>) =>
    request<ServerLlmKeysView>("/api/settings/llm-keys", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testLlmKey: (body: { provider: ServerLlmProvider; apiKey?: string }) =>
    request<ServerKeyTestResult>("/api/settings/llm-keys/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getAgentSchedules: () =>
    request<ServerAgentSchedules>("/api/settings/agent-schedules"),
  putAgentSchedules: (body: {
    pausedAll?: boolean;
    agents?: { slug: string; frequency: string }[];
  }) =>
    request<ServerAgentSchedules>("/api/settings/agent-schedules", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getAbout: () => request<ServerAbout>("/api/settings/about"),
  // Display-locale preference (contract being built in parallel).
  getPreferences: () =>
    request<{ displayLocale?: string }>("/api/settings/preferences"),
  putPreferences: (body: { displayLocale: string }) =>
    request<{ displayLocale?: string }>("/api/settings/preferences", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
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

const shortDateOptions: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
};
const weekdayOptions: Intl.DateTimeFormatOptions = { weekday: "long" };

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
  return displayDateFormat(shortDateOptions).format(new Date(iso));
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
  return Number.isNaN(date.getTime()) ? "" : displayDateFormat(shortDateOptions).format(date);
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
  return daysSince(iso) < 7
    ? displayDateFormat(weekdayOptions).format(date)
    : displayDateFormat(shortDateOptions).format(date);
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

  // ADR 004 §6.4 crossover: "What buyers say" lights up when the server
  // serves the reviews block. Unverified quotes are excluded from display
  // (stored server-side, never dressed as verifiable evidence).
  const reviews = detail.reviews;
  if (reviews && reviews.totalCount !== null && reviews.totalCount > 0) {
    const quotes = reviews.quotes
      .filter((quote) => quote.verified !== false)
      .slice(0, 3)
      .map((quote, index) => ({
        id: `review:${detail.id}:${index}`,
        text: quote.text,
        attribution: quote.date
          ? `${quote.source} · ${shortDateOf(quote.date) || quote.date}`
          : `${quote.source} · date unknown`,
        ...(quote.sourceUrl ? { sourceId: quote.sourceUrl } : {}),
      }));
    if (quotes.length > 0 || detail.sentiment !== null) {
      const line: RichSegment[] = [];
      if (detail.sentiment !== null) {
        line.push({ text: "Sentiment " });
        line.push({ text: String(detail.sentiment), tone: "mono" });
        line.push({ text: " across " });
        line.push({ text: String(reviews.totalCount), tone: "mono" });
        line.push({ text: " reviews" });
      } else {
        // The mean never renders without its basis; the count stands alone.
        line.push({ text: String(reviews.totalCount), tone: "mono" });
        line.push({ text: " reviews mined" });
      }
      if (reviews.platforms.length > 0) {
        line.push({ text: ` on ${joinNames(reviews.platforms)}` });
      }
      line.push({ text: "." });
      object.reviewEvidence = { line, quotes };
    }
  }
  return object;
}

/** "Product A", "Product A and Product B", "Product A, Product B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/**
 * The 2.4 proposal card, populated from the proposed row's real draft
 * (GET /:id). Nothing is invented: absent draft material renders absent,
 * and a failed first enrichment carries an honest failure note — accepting
 * anyway is the spec-5.1 save-unverified path.
 *
 * When the row's entity is already tracked by other products of the org
 * (`alsoTrackedBy`, ADR 003 §2.3), the card becomes its adoption variant:
 * the profile is the entity's existing one, rendered instantly.
 */
export function proposalFromDetail(
  detail: ServerCompetitorDetail,
): CompetitorProposal {
  const failed = detail.enrichmentStatus === "failed";
  const adoptedFrom = (detail.alsoTrackedBy ?? []).map(
    (product) => product.productName,
  );
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
      label: countNoun(detail.keyFeatures.length, "feature"),
      count: detail.keyFeatures.length,
      objectId: `competitor:${detail.id}:features`,
      ...(detail.keyFeatures[0]?.sourceUrl
        ? { href: detail.keyFeatures[0].sourceUrl }
        : {}),
    });
  }
  const summaryParts: string[] = [
    adoptedFrom.length > 0
      ? `Found in your organisation’s context — already tracked for ${joinNames(adoptedFrom)}`
      : failed
        ? `${detail.name} · first check couldn’t finish`
        : `Read ${detail.domain ?? detail.name}`,
  ];
  if (!failed) {
    if (detail.keyDifferentiators.length > 0) {
      summaryParts.push(
        countNoun(detail.keyDifferentiators.length, "differentiator"),
      );
    }
    if (detail.keyFeatures.length > 0) {
      summaryParts.push(countNoun(detail.keyFeatures.length, "feature"));
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
  if (adoptedFrom.length > 0) {
    proposal.adoption = { otherProductNames: adoptedFrom };
  }
  if (failed) {
    proposal.failureNote =
      "The first check couldn’t finish. You can track them anyway — agents retry on the next check — or try again now.";
  }
  return proposal;
}

// ---------------------------------------------------------------------------
// Mapping — settings (server shapes → the client's settings shapes)
// ---------------------------------------------------------------------------

const PROVIDER_TO_SERVER: Record<ProviderId, ServerLlmProvider> = {
  anthropic: "claude",
  openai: "openai",
  google: "gemini",
  perplexity: "perplexity",
  openrouter: "openrouter",
};

export function providerToServer(provider: ProviderId): ServerLlmProvider {
  return PROVIDER_TO_SERVER[provider];
}

/** The PUT /settings/llm-keys body field for a provider. */
export function providerKeyField(provider: ProviderId): string {
  return `${PROVIDER_TO_SERVER[provider]}ApiKey`;
}

/**
 * The server masks as `first4...last4`; the UI renders a typographic
 * ellipsis. (Spec 2.2 asks for the full scheme prefix — flagged as a
 * contract mismatch; the mask is rendered as served, never rebuilt.)
 */
function displayMask(mask: string): string {
  return mask.replace("...", "…");
}

/**
 * Masked view → provider rows. The live contract carries no added-on,
 * last-used or verified metadata (flagged); absent segments simply do not
 * render. `unverified` holds providers whose save-and-test could not verify
 * the key this session.
 */
export function llmKeyRowsFromServer(
  view: ServerLlmKeysView,
  unverified: ReadonlySet<ProviderId>,
): LlmKeyRow[] {
  return (
    [
      "anthropic",
      "openai",
      "google",
      "perplexity",
      "openrouter",
    ] as const
  ).map((provider) => {
    const mask = view.keys[PROVIDER_TO_SERVER[provider]];
    const row: LlmKeyRow = {
      provider,
      webSearch: providerMeta(provider).webSearch,
    };
    if (mask) {
      row.saved = {
        mask: displayMask(mask),
        verified: !unverified.has(provider),
      };
    }
    return row;
  });
}

/** A key-test outcome in the row's own vocabulary (LlmKeyRow.testResult). */
export type KeyTestOutcome =
  | { kind: "works" }
  | { kind: "invalid" }
  | { kind: "unreachable" }
  | { kind: "provider-error"; detail?: string; line?: string }
  | { kind: "rate-limited"; line?: string };

/**
 * Honest-verdict mapping (spec 2.4): "invalid" is claimed ONLY when the
 * provider actually rejected the key, and "couldn't reach / wasn't checked"
 * is ONLY for network/timeout. A provider that answered with an error WAS
 * reached — that renders as provider-error, with the sanitised detail as
 * served. Maps on the structured `verdict`; falls back to the legacy prose
 * matching only when verdict is absent (older server).
 */
export function classifyKeyTest(result: ServerKeyTestResult): KeyTestOutcome {
  switch (result.verdict) {
    case "valid":
      return { kind: "works" };
    case "rejected":
      return { kind: "invalid" };
    case "rate-limited":
      return {
        kind: "rate-limited",
        ...(result.error ? { line: result.error } : {}),
      };
    case "provider-error":
      return {
        kind: "provider-error",
        ...(result.detail ? { detail: result.detail } : {}),
        // Without a detail snippet, the server's sentence carries the HTTP
        // status — keep it rather than dropping the specifics.
        ...(!result.detail && result.error ? { line: result.error } : {}),
      };
    case "network":
    case "timeout":
      return { kind: "unreachable" };
    case undefined:
      break;
  }
  // Legacy prose fallback (no verdict field on the response).
  if (result.ok) {
    return { kind: "works" };
  }
  return result.error?.includes("rejected")
    ? { kind: "invalid" }
    : { kind: "unreachable" };
}

/** The server contract's six-value frequency vocabulary ("off" = paused). */
const AGENT_FREQUENCIES: readonly AgentFrequency[] = [
  "daily",
  "every-3-days",
  "weekly",
  "fortnightly",
  "monthly",
  "off",
];

/** Server moduleGate values → client module ids ("always" always renders). */
const MODULE_GATES: Record<string, ModuleId | "always"> = {
  "competitive-intelligence": "competitors",
  competitors: "competitors",
  "customer-insights": "customers",
  customers: "customers",
  strategy: "strategy",
  "roadmap-review": "roadmap",
  roadmap: "roadmap",
  connections: "connections",
  always: "always",
};

export function agentRowFromServer(agent: ServerAgentSchedule): AgentScheduleRow {
  const frequency =
    AGENT_FREQUENCIES.find((value) => value === agent.frequency) ?? "weekly";
  const module =
    (agent.moduleGate ? MODULE_GATES[agent.moduleGate] : undefined) ?? "always";
  const row: AgentScheduleRow = {
    id: agent.slug,
    name: agent.label,
    module,
    description: agent.description,
    frequency,
    runNow: false, // no run-now endpoint in the live contract (flagged)
  };
  if (agent.nextRunAt) {
    const atMs = new Date(agent.nextRunAt).getTime();
    if (!Number.isNaN(atMs)) {
      row.nextRun = nextRunStamp(atMs, frequency);
      row.nextRunSortKey = atMs;
    }
  }
  if (agent.lastRunAt) {
    const stamp = relativeStamp(agent.lastRunAt);
    if (stamp) {
      row.lastRun = { at: stamp };
    }
  }
  return row;
}

/** "42 MB" / "1.3 GB" — the same figure the footer shows. */
export function formatDbSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

export function aboutFromServer(about: ServerAbout): AboutInfo {
  // No updateState and no reveal seam on the live contract yet — the
  // version row renders alone and the reveal action stays absent (no dead
  // controls).
  return {
    dataDir: about.dataDir,
    dbSizeOnDisk: formatDbSize(about.dbSizeBytes),
    version: about.appVersion,
  };
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
