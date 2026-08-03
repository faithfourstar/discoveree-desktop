/**
 * Competitor orchestration (ADR 002 §3): add/refresh/delete + enrichment
 * fan-out (summary → features), the updates scan write path, and active-run
 * detection.
 *
 * This is the SaaS `runInitialCompetitorAnalysis` (scheduler.ts:7325+)
 * reduced to the sprint-2 summary+features orchestration, plus the
 * competitorUpdates scheduler section (scheduler.ts:2510–2711) re-expressed
 * against profile-canonical storage.
 *
 * `competitor_profiles` is the single source of truth (ADR 002 §3): the
 * `products.competitors` jsonb is never written here; ported agent functions
 * that expect a competitors array are fed `profilesToCompetitorArray()`.
 */
import { randomUUID } from "node:crypto";
import type { CompetitorProfile, Product } from "@shared/schema";
import { runAgentBatch } from "../../lib/agents/batch.js";
import { trackAgentExecution, getAiAgentExecutionsByProduct } from "../../lib/agents/executions.js";
import { getAiAgent } from "../../lib/agents/registry.js";
import { AgentSlugs } from "../../lib/agents/slugs.js";
import { generateCompetitorSummary } from "./agents/summary.js";
import { getCompetitorFeatures } from "./agents/features.js";
import { scanCompetitorUpdates, type ScanCompetitor } from "./agents/updates.js";
import { probeProductReleaseSources } from "./agents/releaseSources.js";
import type { CompetitorSummaryResult, CompetitorFeaturesResult } from "./schemas.js";
import * as storage from "./storage.js";

// ── Inline near-dup helpers ─────────────────────────────────────────────────
// TODO(sprint-3): re-home into lib when segmentNormalization.ts ports for
// Customers (ADR 002 §5 — only mergeDifferentiators is touched by the
// summary save path; inlined per the extraction map).

/**
 * True when two free-text bullet points (e.g. key differentiators) make the same
 * point in different words. Compares token overlap after stripping citation
 * markers ([1][5]) and punctuation; 70%+ overlap of the smaller set counts as a
 * duplicate.
 */
export function isNearDuplicateText(a: string, b: string): boolean {
  const tokens = (t: string) => new Set(
    t.toLowerCase()
      .replace(/\[\d+\]/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2),
  );
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return a.toLowerCase().trim() === b.toLowerCase().trim();
  let shared = 0;
  ta.forEach(w => { if (tb.has(w)) shared++; });
  return shared / Math.min(ta.size, tb.size) >= 0.7;
}

/**
 * Merge new differentiator bullets into an existing list, dropping near-duplicate
 * paraphrases. Also self-heals: duplicates already present in `existing` collapse.
 */
export function mergeDifferentiators(existing: string[], incoming: string[]): string[] {
  const merged: string[] = [];
  for (const d of [...existing, ...incoming]) {
    if (d && !merged.some(kept => isNearDuplicateText(kept, d))) merged.push(d);
  }
  return merged;
}

// ── Projection helper (ADR 002 risk 1) ──────────────────────────────────────

/**
 * Read-only projection of profile rows into the `{name, url, type…}` array
 * shape that ported agent functions expect. Any ported code that *writes*
 * the jsonb shape must be rewritten to write the profile row instead.
 */
export function profilesToCompetitorArray(profiles: CompetitorProfile[]): ScanCompetitor[] {
  return profiles
    .filter(p => p.sourceCategory !== "own_product")
    .map(p => ({
      name: p.competitorName,
      type: p.sourceCategory === "adjacent" ? "adjacent" : "competitor",
      url: p.competitorUrl || undefined,
      helpCenterUrl: p.helpCenterUrl || undefined,
    }));
}

// ── Background task tracking (tests await settleBackgroundTasks) ────────────

const backgroundTasks = new Set<Promise<unknown>>();

function trackBackground<T>(promise: Promise<T>): Promise<T> {
  backgroundTasks.add(promise);
  void promise.finally(() => backgroundTasks.delete(promise)).catch(() => {});
  return promise;
}

/** Await every in-flight background enrichment (test helper). */
export async function settleBackgroundTasks(): Promise<void> {
  while (backgroundTasks.size > 0) {
    await Promise.allSettled([...backgroundTasks]);
  }
}

// ── Active-run detection (routes.ts:7877–7944 port) ─────────────────────────

const COMPETITOR_AGENT_SLUGS = new Set<string>([
  AgentSlugs.COMPETITOR_SUMMARY,
  AgentSlugs.COMPETITOR_FEATURES,
  AgentSlugs.COMPETITOR_UPDATES,
]);

const COMPETITOR_SLUG_TO_LABEL: Record<string, string> = {
  [AgentSlugs.COMPETITOR_SUMMARY]: "Competitor Profile",
  [AgentSlugs.COMPETITOR_FEATURES]: "Features",
  [AgentSlugs.COMPETITOR_UPDATES]: "Competitor Updates",
};

const COMPETITOR_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface ActiveCompetitorExecution {
  competitorName: string | null;
  agentLabel: string;
  startedAt: string | null;
}

/**
 * Finds the first non-stale running execution for the given productId that
 * belongs to a competitor enrichment agent. When competitorName is provided,
 * only executions matching that competitor are considered.
 */
export async function findActiveExecutionForCompetitor(
  productId: string,
  competitorName?: string | null,
): Promise<ActiveCompetitorExecution | null> {
  const executions = await getAiAgentExecutionsByProduct(productId, 20);
  const staleThreshold = new Date(Date.now() - COMPETITOR_STALE_THRESHOLD_MS);
  const runningExecutions = executions.filter(
    (e) => e.status === "running" && e.startedAt != null && e.startedAt > staleThreshold,
  );
  for (const execution of runningExecutions) {
    const agent = execution.agentSlug
      ? { slug: execution.agentSlug }
      : await getAiAgent(execution.agentId);
    if (!agent || !agent.slug || !COMPETITOR_AGENT_SLUGS.has(agent.slug)) continue;
    const params = execution.inputParameters;
    let execCompetitorName: string | null = null;
    if (params && typeof params === "object" && !Array.isArray(params)) {
      const rawName = (params as Record<string, unknown>)["competitorName"];
      execCompetitorName = typeof rawName === "string" ? rawName : null;
    }
    if (competitorName != null && execCompetitorName !== competitorName) continue;
    return {
      competitorName: execCompetitorName,
      agentLabel: COMPETITOR_SLUG_TO_LABEL[agent.slug] ?? "Competitor Profile",
      startedAt: execution.startedAt ? new Date(execution.startedAt).toISOString() : null,
    };
  }
  return null;
}

// ── Enrichment write paths (merge, don't replace) ───────────────────────────

/** Save a validated summary result onto the profile row. */
async function applySummaryResult(
  productId: string,
  profile: CompetitorProfile,
  sr: CompetitorSummaryResult,
): Promise<void> {
  const cachedProfile = await storage.getCompetitorProfileById(profile.id);
  const profileUpdate: Record<string, unknown> = {
    productId,
    competitorName: profile.competitorName,
    description: sr.summary,
    descriptionSourceUrl: sr.sourceUrl || "",
  };

  // Only adopt the AI-discovered website URL when the user did not set one.
  if (sr.websiteUrl && (!cachedProfile?.competitorUrl || cachedProfile?.competitorUrlSource === "ai-discovered")) {
    profileUpdate["competitorUrl"] = sr.websiteUrl;
    profileUpdate["competitorUrlSource"] = "ai-discovered";
  }

  if (sr.keyDifferentiators && sr.keyDifferentiators.length > 0) {
    const existingDiffs = (cachedProfile?.keyDifferentiators as string[] | null) || [];
    profileUpdate["keyDifferentiators"] = mergeDifferentiators(existingDiffs, sr.keyDifferentiators);
  }

  if (sr.markets && sr.markets.length > 0) {
    const existingMarkets = (cachedProfile?.markets as Array<{ market?: string; sourceUrl?: string }> | null) || [];
    const marketSet = new Set<string>(existingMarkets.map(m => (m.market || "").toLowerCase().trim()));
    const mergedMarkets = [...existingMarkets];
    for (const m of sr.markets) {
      const normalized = m.toLowerCase().trim();
      if (normalized && !marketSet.has(normalized)) {
        marketSet.add(normalized);
        mergedMarkets.push({ market: m, sourceUrl: sr.sourceUrl || undefined });
      }
    }
    profileUpdate["markets"] = mergedMarkets;
  }

  if (sr.citations && sr.citations.length > 0) {
    profileUpdate["summaryCitations"] = sr.citations;
  }

  await storage.upsertCompetitorProfile(profileUpdate as Parameters<typeof storage.upsertCompetitorProfile>[0]);
}

/** Save validated features onto the profile row, merged by feature name. */
async function applyFeaturesResult(
  productId: string,
  profile: CompetitorProfile,
  fr: CompetitorFeaturesResult,
): Promise<void> {
  const cachedProfile = await storage.getCompetitorProfileById(profile.id);
  const existing = (cachedProfile?.keyFeatures as Array<{ feature?: string; description?: string; sourceUrl?: string | null }> | null) || [];
  const byName = new Map<string, { feature: string; description?: string; sourceUrl?: string | null }>();
  for (const f of existing) {
    if (f.feature) byName.set(f.feature.toLowerCase().trim(), { feature: f.feature, description: f.description, sourceUrl: f.sourceUrl ?? null });
  }
  for (const f of fr.features) {
    const key = f.name.toLowerCase().trim();
    const prior = byName.get(key);
    byName.set(key, {
      feature: f.name,
      description: f.description || prior?.description,
      sourceUrl: f.documentationUrl || prior?.sourceUrl || null,
    });
  }

  await storage.upsertCompetitorProfile({
    productId,
    competitorName: profile.competitorName,
    keyFeatures: [...byName.values()],
  } as Parameters<typeof storage.upsertCompetitorProfile>[0]);
}

/**
 * Run the summary + features agents for one profile and persist the results.
 * Each agent runs under trackAgentExecution (execution rows carry
 * competitorName so the active-run poll can attribute them).
 */
export async function enrichCompetitor(
  organizationId: string,
  product: Product,
  profileId: string,
): Promise<boolean> {
  const profile = await storage.getCompetitorProfileById(profileId);
  if (!profile) return false;

  await storage.updateCompetitorProfile(profile.id, { enrichmentStatus: "enriching" });

  let anySucceeded = false;
  const sourceCategory = profile.sourceCategory === "adjacent" ? "adjacent" : "competitor";

  // Summary
  try {
    await trackAgentExecution(
      {
        agentSlug: AgentSlugs.COMPETITOR_SUMMARY,
        triggerType: "api",
        productId: product.id,
        inputData: { competitorName: profile.competitorName },
      },
      async () => {
        const sr = await generateCompetitorSummary(
          profile.competitorName,
          profile.competitorUrl || "",
          product.name,
          product.description || undefined,
          organizationId,
          undefined,
          product.id,
        );
        if (sr?.summary) {
          await applySummaryResult(product.id, profile, sr);
          anySucceeded = true;
        }
        return sr;
      },
    );
  } catch (err) {
    console.error(`[Competitors] Summary enrichment failed for ${profile.competitorName}:`, err instanceof Error ? err.message : err);
  }

  // Features
  try {
    await trackAgentExecution(
      {
        agentSlug: AgentSlugs.COMPETITOR_FEATURES,
        triggerType: "api",
        productId: product.id,
        inputData: { competitorName: profile.competitorName },
      },
      async () => {
        const fresh = await storage.getCompetitorProfileById(profileId);
        const fr = await getCompetitorFeatures(
          profile.competitorName,
          fresh?.competitorUrl || profile.competitorUrl || "",
          fresh?.helpCenterUrl || undefined,
          organizationId,
          undefined,
          product.id,
        );
        if (fr && fr.features.length > 0) {
          await applyFeaturesResult(product.id, profile, fr);

          // Record the discovery in the change feed (evidence-cited)
          await storage.createCompetitorChange({
            productId: product.id,
            competitorName: profile.competitorName,
            sourceCategory,
            changeType: "feature",
            changeTitle: `${profile.competitorName}: ${fr.features.length} key features identified`,
            changeDescription: fr.features.slice(0, 3).map(f => f.name).join(", "),
            sourceUrl: fr.features[0]?.documentationUrl || profile.competitorUrl || "",
            sourceType: "agent",
          });
          anySucceeded = true;
        }
        return fr;
      },
    );
  } catch (err) {
    console.error(`[Competitors] Features enrichment failed for ${profile.competitorName}:`, err instanceof Error ? err.message : err);
  }

  await storage.updateCompetitorProfile(profile.id, {
    enrichmentStatus: anySucceeded ? "completed" : "failed",
    lastEnrichedAt: anySucceeded ? new Date() : undefined,
  });

  return anySucceeded;
}

/** Fire-and-forget enrichment used by POST /api/competitors. */
export function startEnrichment(
  organizationId: string,
  product: Product,
  profileId: string,
): Promise<boolean> {
  return trackBackground(
    enrichCompetitor(organizationId, product, profileId).catch((err) => {
      console.error(`[Competitors] Background enrichment error:`, err);
      return false;
    }),
  );
}

// ── Refresh (summary + features + updates scan for one competitor) ──────────

export async function refreshCompetitor(
  organizationId: string,
  product: Product,
  profileId: string,
): Promise<{ runId: string }> {
  const runId = randomUUID();
  trackBackground((async () => {
    const succeeded = await enrichCompetitor(organizationId, product, profileId);
    const profile = await storage.getCompetitorProfileById(profileId);
    if (profile) {
      await runUpdatesScan(organizationId, product, [profile]);
    }
    console.log(`[Competitors] Refresh ${runId} for profile ${profileId}: ${succeeded ? "success" : "failed"}`);
  })().catch((err) => {
    console.error(`[Competitors] Refresh ${runId} error:`, err);
  }));
  return { runId };
}

// ── Updates scan (scheduler.ts:2510–2711 reduced, profile-canonical) ────────

/**
 * Dual-stream market/product signal scan for the given profiles, writing new
 * `competitor_changes` rows (dedup by title + sourceUrl). Release-source URLs
 * are probed once and cached on the profile for 7 days.
 */
export async function runUpdatesScan(
  organizationId: string,
  product: Product,
  profiles?: CompetitorProfile[],
): Promise<{ savedCount: number; totalFound: number; summary: string; failureReason?: string }> {
  // Scheduled runs (no explicit profiles) skip PROPOSED competitors — they are
  // not tracked until the human accepts (spec 2.4 gate). Explicitly-passed
  // profiles (e.g. a single-competitor refresh) are honoured as given.
  const allProfiles = profiles
    ?? (await storage.getCompetitorProfilesByProduct(product.id)).filter(p => p.status !== "proposed");
  const competitors = profilesToCompetitorArray(allProfiles);
  if (competitors.length === 0) {
    return { savedCount: 0, totalFound: 0, summary: "No competitors to scan" };
  }

  // Fetch cached release sources; probe + persist when the cache is stale.
  const RELEASE_SOURCE_CACHE_TTL_DAYS = 7;
  const cacheExpiryCutoff = new Date();
  cacheExpiryCutoff.setDate(cacheExpiryCutoff.getDate() - RELEASE_SOURCE_CACHE_TTL_DAYS);

  const confirmedReleaseSources: Record<string, string[]> = {};

  await runAgentBatch(
    allProfiles.filter(p => p.sourceCategory !== "own_product"),
    async (profile) => {
      try {
        const cached = profile.validReleaseSources as { urls: string[]; checkedAt: string } | null | undefined;
        const cacheIsFresh = cached?.checkedAt && new Date(cached.checkedAt) >= cacheExpiryCutoff;

        if (cacheIsFresh && cached!.urls.length > 0) {
          console.log(`[Competitors] Using cached release sources for ${profile.competitorName} (${cached!.urls.length} URLs)`);
          confirmedReleaseSources[profile.competitorName] = cached!.urls;
        } else {
          // Probe release source URLs and persist results
          const confirmedUrls = await probeProductReleaseSources({
            name: profile.competitorName,
            url: profile.competitorUrl || undefined,
            helpCenterUrl: profile.helpCenterUrl || undefined,
          });
          confirmedReleaseSources[profile.competitorName] = confirmedUrls;
          await storage.updateCompetitorProfile(profile.id, {
            validReleaseSources: { urls: confirmedUrls, checkedAt: new Date().toISOString() },
          });
          console.log(`[Competitors] Cached ${confirmedUrls.length} release sources for ${profile.competitorName}`);
        }
      } catch (profileErr) {
        console.warn(`[Competitors] Release-source probe failed for ${profile.competitorName}: ${profileErr instanceof Error ? profileErr.message : profileErr}`);
      }
    },
    { label: "Competitors/updatesScan/probeReleaseSources", concurrency: 3 },
  );

  // NOTE: trusted news sources come from the Sources module — later sprint;
  // undefined here means the agent falls back to open web search.
  const result = await scanCompetitorUpdates(
    product.name,
    competitors,
    organizationId,
    undefined,
    undefined,
    confirmedReleaseSources,
    product.id,
  );

  if (result.failureReason) {
    console.warn(`[Competitors] Updates scan FAILURE for ${product.name}: reason=${result.failureReason} | ${result.searchSummary}`);
  }

  let savedCount = 0;
  const existingChanges = await storage.getCompetitorChangesByProduct(product.id, 200);
  // Dedupe key: title + source URL. Seeded from stored changes AND updated
  // within this batch — the SaaS loop only checked a pre-loop snapshot, so
  // the same item surfacing in both streams was written twice (fixed here;
  // "no silent duplicates" is the pitch).
  const seen = new Set(existingChanges.map(c => `${c.changeTitle}::${c.sourceUrl ?? ""}`));
  for (const update of result.updates) {
    const key = `${update.changeTitle}::${update.sourceUrl}`;
    const isDuplicate = seen.has(key);

    if (!isDuplicate) {
      seen.add(key);
      const competitor = competitors.find(c => c.name === update.competitorName);
      const sourceCategory = competitor?.type === "adjacent" ? "adjacent" : "competitor";

      await storage.createCompetitorChange({
        productId: product.id,
        competitorName: update.competitorName,
        sourceCategory,
        changeType: update.changeType,
        changeTitle: update.changeTitle,
        changeDescription: update.changeDescription,
        sourceUrl: update.sourceUrl,
        sourceType: "agent",
        stream: update.stream,
        severity: update.stream === "product" ? (update.severity || "minor") : null,
      });
      savedCount++;
    }
  }

  console.log(`[Competitors] Updates scan complete: ${savedCount} new updates saved (${result.updates.length} found)`);
  return { savedCount, totalFound: result.updates.length, summary: result.searchSummary, ...(result.failureReason ? { failureReason: result.failureReason } : {}) };
}

/**
 * Scheduled features refresh across all competitor profiles (the SaaS
 * competitorFeatures scheduler section, profile-canonical, with the same
 * 90-second per-competitor timeout and all-failed error for the breaker).
 */
export async function runFeaturesScanForProduct(
  organizationId: string,
  product: Product,
): Promise<{ processedCount: number; failedCount: number }> {
  const profiles = (await storage.getCompetitorProfilesByProduct(product.id))
    .filter(p => p.sourceCategory !== "own_product")
    // Scheduled scans never touch proposed competitors (spec 2.4 gate).
    .filter(p => p.status !== "proposed");
  let processedCount = 0;
  let failedCount = 0;

  for (const profile of profiles) {
    try {
      const competitorTimeoutMs = 90_000;
      const result = await Promise.race([
        getCompetitorFeatures(
          profile.competitorName,
          profile.competitorUrl || "",
          profile.helpCenterUrl || undefined,
          organizationId,
          undefined,
          product.id,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`[Competitors] Per-competitor timeout (${competitorTimeoutMs / 1000}s) fired for ${profile.competitorName}`)), competitorTimeoutMs),
        ),
      ]);

      if (result && result.features && result.features.length > 0) {
        await applyFeaturesResult(product.id, profile, result);
        processedCount++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Competitors] Failed to analyse features for ${profile.competitorName}: ${errMsg}`);
      failedCount++;
    }
  }

  console.log(`[Competitors] Features scan complete: ${processedCount} analysed, ${failedCount} failed`);
  const totalAttempted = processedCount + failedCount;
  if (failedCount > 0 && processedCount === 0 && totalAttempted > 0) {
    throw new Error(`Competitor Features Agent: all ${failedCount} competitor(s) failed — marking run as failed so the circuit breaker can fire`);
  }
  return { processedCount, failedCount };
}
