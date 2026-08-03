/**
 * Competitor updates scan (dual-stream) — ported from the SaaS gemini.ts
 * 8627–9173: failure taxonomy, market-signals agent, product-signals agent,
 * shared filter/normalise pass, and the public `scanCompetitorUpdates`
 * entry-point that runs both streams in parallel.
 *
 * This is the deterministic-maintenance differentiator (brief §10a.2):
 * refresh detects CHANGE, it does not re-derive the world.
 *
 * Seam changes: multi-lingual search context stripped (deferred with
 * reviews/pricing per ADR 002 §1); every accepted update is Zod-parsed
 * (schemas.ts) before being returned to the write path.
 */
import { Type } from "@google/genai";
import { callLLM } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import { progressEmitter } from "../../../lib/progress.js";
import { buildProductReleaseSources } from "./releaseSources.js";
import { competitorUpdateSchema, type CompetitorUpdate } from "../schemas.js";

export type CompetitorUpdateFailureReason =
  | "no_sources_found"
  | "provider_timeout"
  | "all_urls_blocked"
  | "parse_error"
  | "no_competitors"
  | "unknown_error";

export interface CompetitorUpdatesResult {
  updates: CompetitorUpdate[];
  searchSummary: string;
  failureReason?: CompetitorUpdateFailureReason;
}

export interface ScanCompetitor {
  name: string;
  type?: string;
  url?: string;
  helpCenterUrl?: string;
}

// Lookback window for competitor signal scans (6 months)
const COMPETITOR_SCAN_LOOKBACK_DAYS = 180;

/**
 * MARKET SIGNALS agent — scans for strategic/market-level intelligence:
 * funding, M&A, leadership, analyst coverage, partnerships, market expansion.
 * Explicitly excludes product release notes.
 */
async function scanMarketSignals(
  productName: string,
  competitors: ScanCompetitor[],
  organizationId: string,
  trustedNewsSources: Array<{ name: string; url: string }>,
  productId?: string,
): Promise<CompetitorUpdatesResult> {
  const competitorNames = competitors.map(c => c.name);
  const lookbackDays = COMPETITOR_SCAN_LOOKBACK_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  const competitorDetails = competitors.map(c => {
    let d = `- ${c.name}`;
    if (c.url) d += ` (Website: ${c.url})`;
    return d;
  }).join("\n");

  const trustedSourcesSection = trustedNewsSources.length > 0
    ? `\nTRUSTED NEWS SOURCES — search these first:\n${trustedNewsSources.map(s => `- ${s.name}: ${s.url}`).join("\n")}\n` : "";

  const prompt = `You are a competitive intelligence analyst focused on MARKET-LEVEL signals only.

Search for STRATEGIC / MARKET NEWS about these competitors of "${productName}" published after ${cutoffStr} (last 6 months):

COMPETITORS:
${competitorDetails}

${trustedSourcesSection}
SEARCH STRATEGY:
1. Search trusted news sources above for each competitor name.
2. Open web: "[competitor name]" site:techcrunch.com OR site:venturebeat.com OR site:forbes.com OR site:wsj.com OR site:ft.com OR site:businesswire.com OR site:prnewswire.com
3. Search: "[competitor name]" funding OR acquisition OR partnership OR "leadership" OR "CEO" OR "appoints" ${new Date().getFullYear()}

INCLUDE ONLY market-level signals:
- Funding rounds (Series A/B/C, debt, IPO, SPAC)
- Mergers & acquisitions (buying or being acquired)
- Leadership changes (CEO, CTO, key hires/departures)
- Analyst coverage / ratings (Gartner, Forrester, IDC)
- Strategic partnerships and major integrations
- Market expansion (new region, new vertical, major deal)
- Company milestones (headcount, revenue announcements)

EXCLUDE product release content:
- Changelog entries, release notes, version bumps
- Feature launches, product updates
- Help documentation
- Marketing landing pages

DATE RULES:
- Only include items with an explicit publication date found in the source.
- Do NOT assign today's date to undated content.
- Reject items without a year in their date.

VALIDATION:
- Every item must have a real, working sourceUrl (not guessed).
- competitorName must exactly match one from the list above.
- Return an empty array rather than include unverified items.

Respond ONLY with valid JSON (no markdown):
{
  "updates": [
    {"competitorName": "Name", "changeType": "announcement", "changeTitle": "Title", "changeDescription": "Details", "sourceUrl": "https://...", "publishedDate": "2025-01-15", "stream": "market"}
  ],
  "searchSummary": "Which strategies produced results and how many items per strategy"
}`;

  try {
    console.log("[Competitor Market Signals] Scanning for:", competitorNames);
    const response = await callLLM({
      organizationId,
      productId,
      agentSlug: AgentSlugs.COMPETITOR_UPDATES,
      prompt,
      useWebSearch: true,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          updates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                competitorName: { type: Type.STRING },
                changeType: { type: Type.STRING },
                changeTitle: { type: Type.STRING },
                changeDescription: { type: Type.STRING },
                sourceUrl: { type: Type.STRING },
                publishedDate: { type: Type.STRING, nullable: true },
                stream: { type: Type.STRING },
              },
              required: ["competitorName", "changeType", "changeTitle", "changeDescription", "sourceUrl", "stream"],
            },
          },
          searchSummary: { type: Type.STRING },
        },
        required: ["updates", "searchSummary"],
      },
    });

    let parsed: { updates: any[]; searchSummary: string };
    try {
      parsed = JSON.parse(sanitizeJsonResponse(response.text) || '{"updates":[],"searchSummary":"No results"}') as { updates: any[]; searchSummary: string };
    } catch (parseErr) {
      console.error(`[Competitor Market Signals] JSON parse error:`, parseErr instanceof Error ? parseErr.message : parseErr);
      return { updates: [], searchSummary: "Market signals scan failed: parse_error", failureReason: "parse_error" };
    }

    const rawUpdates = parsed.updates || [];
    const valid = filterAndNormaliseUpdates(rawUpdates, competitorNames, "market");

    if (rawUpdates.length > 0 && valid.length === 0) {
      console.warn(`[Competitor Market Signals] all_urls_blocked — ${rawUpdates.length} raw items dropped by URL filter`);
      return { updates: [], searchSummary: parsed.searchSummary || "All results blocked by URL filter", failureReason: "all_urls_blocked" };
    }
    if (rawUpdates.length === 0) {
      console.warn(`[Competitor Market Signals] no_sources_found — LLM returned no updates`);
      return { updates: [], searchSummary: parsed.searchSummary || "No market signals found", failureReason: "no_sources_found" };
    }

    console.log(`[Competitor Market Signals] ${valid.length} valid market signals found`);
    return { updates: valid, searchSummary: parsed.searchSummary || `Found ${valid.length} market signals` };
  } catch (error) {
    const err = error as { message?: string; code?: string };
    const isTimeout = err?.message?.includes("timeout") || err?.code === "ETIMEDOUT";
    const failureReason: CompetitorUpdateFailureReason = isTimeout ? "provider_timeout" : "unknown_error";
    console.error(`[Competitor Market Signals] FAILURE reason=${failureReason}:`, err?.message || error);
    return { updates: [], searchSummary: `Market signals scan failed: ${failureReason}`, failureReason };
  }
}

/**
 * PRODUCT SIGNALS agent — scans for release-level intelligence:
 * changelog entries, feature launches, version releases.
 * Prefers structured release sources (changelog, release-notes, GitHub releases)
 * before falling back to open web search.
 *
 * @param confirmedReleaseSources Per-competitor map of pre-validated release URLs from cache.
 *   When provided, these are listed as CONFIRMED WORKING SOURCES in the prompt, avoiding
 *   re-probing on every scheduled run.
 */
async function scanProductSignals(
  productName: string,
  competitors: ScanCompetitor[],
  organizationId: string,
  confirmedReleaseSources?: Record<string, string[]>,
  productId?: string,
): Promise<CompetitorUpdatesResult> {
  const competitorNames = competitors.map(c => c.name);
  const lookbackDays = COMPETITOR_SCAN_LOOKBACK_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  // Build per-competitor source list: confirmed (probed) first, then candidate paths
  const releaseSourcesByCompetitor = competitors
    .map(c => {
      const confirmed = confirmedReleaseSources?.[c.name] || [];
      const candidates = buildProductReleaseSources(c);
      if (confirmed.length === 0 && candidates.length === 0) return "";
      const lines: string[] = [];
      if (confirmed.length > 0) {
        lines.push(`  CONFIRMED WORKING SOURCES (check these first):`);
        confirmed.forEach(u => lines.push(`  - ${u}`));
      }
      if (candidates.length > 0) {
        lines.push(`  Additional candidate paths to try:`);
        candidates.slice(0, 5).forEach(s => lines.push(`  - ${s}`));
      }
      return `For ${c.name}:\n${lines.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const competitorDetails = competitors.map(c => {
    let d = `- ${c.name}`;
    if (c.url) d += ` (Website: ${c.url})`;
    if (c.helpCenterUrl) d += ` (Help Centre: ${c.helpCenterUrl})`;
    return d;
  }).join("\n");

  const prompt = `You are a competitive intelligence analyst focused on PRODUCT RELEASE signals only.

Search for PRODUCT UPDATES, CHANGELOG ENTRIES, and FEATURE LAUNCHES from these competitors of "${productName}" published after ${cutoffStr} (last 6 months):

COMPETITORS:
${competitorDetails}

=== PRIORITY SOURCES — check these structured release pages first ===
${releaseSourcesByCompetitor || "No structured release URLs known — proceed to open web search."}

=== FALLBACK — open web search (only if structured sources yield <3 items) ===
For each competitor search:
- site:[domain] changelog OR "release notes" OR "product update"
- "[competitor name]" "new feature" OR "now available" OR "we're launching" ${new Date().getFullYear()}
- "[competitor name]" changelog OR "release notes" ${new Date().getFullYear()}

INCLUDE ONLY product-release signals:
- Changelog entries (with version or date)
- Feature launches ("We're excited to announce…")
- Product updates / new capabilities
- Version releases (major or minor)
- API changes, integration announcements that are product-driven

For EACH item, classify severity:
- "major": new product line, complete UI redesign, AI feature launch, breaking API change, entirely new module
- "minor": incremental improvement, bug fix release, small enhancement, UI tweak

EXCLUDE market/strategic signals:
- Funding rounds, acquisitions, partnerships
- Leadership changes
- Analyst coverage
- Press releases about company milestones

DATE RULES:
- Only include items with an explicit publication date found in the source.
- Changelog URLs with version numbers count as a date signal — include the version in changeTitle.
- Do NOT assign today's date to undated content.

VALIDATION:
- Every item must have a real, working sourceUrl (not guessed).
- Prefer URLs from /changelog, /release-notes, /releases over blog posts.
- competitorName must exactly match one from the list above.
- Return an empty array rather than include unverified items.

Respond ONLY with valid JSON (no markdown):
{
  "updates": [
    {"competitorName": "Name", "changeType": "feature", "changeTitle": "v3.2 — Dark mode & CSV export", "changeDescription": "Details", "sourceUrl": "https://...", "publishedDate": "2025-03-10", "stream": "product", "severity": "minor"}
  ],
  "searchSummary": "Which sources were checked and how many items per source"
}`;

  try {
    console.log("[Competitor Product Signals] Scanning for:", competitorNames);
    const response = await callLLM({
      organizationId,
      productId,
      agentSlug: AgentSlugs.COMPETITOR_UPDATES,
      prompt,
      useWebSearch: true,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          updates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                competitorName: { type: Type.STRING },
                changeType: { type: Type.STRING },
                changeTitle: { type: Type.STRING },
                changeDescription: { type: Type.STRING },
                sourceUrl: { type: Type.STRING },
                publishedDate: { type: Type.STRING, nullable: true },
                stream: { type: Type.STRING },
                severity: { type: Type.STRING, nullable: true },
              },
              required: ["competitorName", "changeType", "changeTitle", "changeDescription", "sourceUrl", "stream"],
            },
          },
          searchSummary: { type: Type.STRING },
        },
        required: ["updates", "searchSummary"],
      },
    });

    let parsed: { updates: any[]; searchSummary: string };
    try {
      parsed = JSON.parse(sanitizeJsonResponse(response.text) || '{"updates":[],"searchSummary":"No results"}') as { updates: any[]; searchSummary: string };
    } catch (parseErr) {
      console.error(`[Competitor Product Signals] JSON parse error:`, parseErr instanceof Error ? parseErr.message : parseErr);
      return { updates: [], searchSummary: "Product signals scan failed: parse_error", failureReason: "parse_error" };
    }

    const rawUpdates = parsed.updates || [];
    const valid = filterAndNormaliseUpdates(rawUpdates, competitorNames, "product");

    if (rawUpdates.length > 0 && valid.length === 0) {
      console.warn(`[Competitor Product Signals] all_urls_blocked — ${rawUpdates.length} raw items dropped by URL filter`);
      return { updates: [], searchSummary: parsed.searchSummary || "All results blocked by URL filter", failureReason: "all_urls_blocked" };
    }
    if (rawUpdates.length === 0) {
      console.warn(`[Competitor Product Signals] no_sources_found — LLM returned no updates`);
      return { updates: [], searchSummary: parsed.searchSummary || "No product signals found", failureReason: "no_sources_found" };
    }

    console.log(`[Competitor Product Signals] ${valid.length} valid product signals found`);
    return { updates: valid, searchSummary: parsed.searchSummary || `Found ${valid.length} product signals` };
  } catch (error) {
    const err = error as { message?: string; code?: string };
    const isTimeout = err?.message?.includes("timeout") || err?.code === "ETIMEDOUT";
    const failureReason: CompetitorUpdateFailureReason = isTimeout ? "provider_timeout" : "unknown_error";
    console.error(`[Competitor Product Signals] FAILURE reason=${failureReason}:`, err?.message || error);
    return { updates: [], searchSummary: `Product signals scan failed: ${failureReason}`, failureReason };
  }
}

/**
 * Shared validation + normalisation pass applied by both market and product agents.
 * Filters out items without valid URLs, without a real date, or not matching a
 * known competitor — then Zod-parses each survivor (drop-and-log on failure).
 * Exported for unit tests.
 */
export function filterAndNormaliseUpdates(
  rawUpdates: any[],
  competitorNames: string[],
  defaultStream: "market" | "product",
): CompetitorUpdate[] {
  const featurePagePatterns = ["/product/", "/features/", "/all-features", "/pricing"];
  const surviving = rawUpdates.filter(update => {
    if (!update.sourceUrl || !update.sourceUrl.startsWith("http")) {
      console.log(`[Competitor Updates] Dropped — no valid URL: "${update.changeTitle}"`);
      return false;
    }
    if (featurePagePatterns.some(p => update.sourceUrl.toLowerCase().includes(p))) {
      console.log(`[Competitor Updates] Dropped — feature/marketing page: ${update.sourceUrl}`);
      return false;
    }
    const hasRealDate = update.publishedDate &&
      update.publishedDate !== "Unknown" &&
      update.publishedDate.trim() !== "" &&
      /\d{4}/.test(update.publishedDate);
    if (!hasRealDate) {
      console.log(`[Competitor Updates] Dropped — no real date: "${update.changeTitle}" (${update.publishedDate})`);
      return false;
    }
    if (!competitorNames.includes(update.competitorName)) {
      console.log(`[Competitor Updates] Dropped — unknown competitor: "${update.competitorName}"`);
      return false;
    }
    const validTypes = ["feature", "pricing", "announcement", "update"];
    if (!validTypes.includes(update.changeType)) update.changeType = "update";
    // Normalise stream
    if (!["market", "product"].includes(update.stream)) update.stream = defaultStream;
    // Product-stream items must carry a severity — default to "minor"
    if (update.stream === "product" && (!update.severity || !["major", "minor"].includes(update.severity))) {
      update.severity = "minor";
    }
    return true;
  });

  // Zod at the boundary: never let an unvalidated shape reach the write path.
  const validated: CompetitorUpdate[] = [];
  for (const item of surviving) {
    const parsed = competitorUpdateSchema.safeParse(item);
    if (parsed.success) {
      validated.push(parsed.data);
    } else {
      console.warn(`[Competitor Updates] Dropped — failed schema validation:`, parsed.error.issues);
    }
  }
  return validated;
}

/**
 * Public entry-point — runs the market-signals and product-signals agents in parallel
 * and merges their results into a single CompetitorUpdatesResult.
 */
export async function scanCompetitorUpdates(
  productName: string,
  competitors: ScanCompetitor[],
  organizationId?: string,
  trustedNewsSources?: Array<{ name: string; url: string }>,
  taskId?: string,
  confirmedReleaseSources?: Record<string, string[]>,
  productId?: string,
): Promise<CompetitorUpdatesResult> {
  const emitProgress = (step: string, message: string, progress: number) => {
    if (taskId) progressEmitter.emit(taskId, step, message, progress);
  };

  const competitorNames = competitors.map(c => c.name);
  if (competitorNames.length === 0) {
    if (taskId) progressEmitter.complete(taskId, "No competitors to scan");
    return { updates: [], searchSummary: "No competitors to scan", failureReason: "no_competitors" };
  }

  emitProgress("init", `Starting dual-stream scan for ${competitorNames.length} competitor(s)...`, 5);
  console.log(`[Competitor Updates] Starting market+product scan for: ${competitorNames.join(", ")}`);

  const orgId = organizationId || "";
  const sources = trustedNewsSources || [];

  emitProgress("searching", "Scanning market signals and product signals in parallel…", 20);

  const [marketResult, productResult] = await Promise.allSettled([
    scanMarketSignals(productName, competitors, orgId, sources, productId),
    scanProductSignals(productName, competitors, orgId, confirmedReleaseSources, productId),
  ]);

  const marketData = marketResult.status === "fulfilled"
    ? marketResult.value
    : { updates: [], searchSummary: "Market signals scan failed (promise rejected)", failureReason: "unknown_error" as CompetitorUpdateFailureReason };
  const productData = productResult.status === "fulfilled"
    ? productResult.value
    : { updates: [], searchSummary: "Product signals scan failed (promise rejected)", failureReason: "unknown_error" as CompetitorUpdateFailureReason };

  if (marketResult.status === "rejected") {
    console.error("[Competitor Updates] Market signals promise rejected:", marketResult.reason);
  }
  if (productResult.status === "rejected") {
    console.error("[Competitor Updates] Product signals promise rejected:", productResult.reason);
  }

  const allUpdates = [...marketData.updates, ...productData.updates];
  const summary = `Market signals: ${marketData.searchSummary} | Product signals: ${productData.searchSummary}`;

  console.log(`[Competitor Updates] Complete — ${marketData.updates.length} market + ${productData.updates.length} product = ${allUpdates.length} total`);

  emitProgress("processing", `Processing ${allUpdates.length} signals…`, 60);
  if (taskId) progressEmitter.complete(taskId, `Found ${allUpdates.length} competitor signal(s)`);

  // Report overall failure only when both streams failed
  const bothFailed = marketData.failureReason && productData.failureReason;
  return {
    updates: allUpdates,
    searchSummary: summary,
    ...(bothFailed ? { failureReason: marketData.failureReason } : {}),
  };
}
