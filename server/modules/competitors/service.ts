/**
 * Competitor orchestration (ADR 002 §3, reshaped by ADR 003 §2):
 *
 * - The ADD flow is the dedup/adoption flow (§2.3): normalise + domain
 *   lookup across both tree levels; an existing node is ADOPTED (instant
 *   profile, facet-only enrichment); a new name creates entity + proposed
 *   facet together. Until the resolution agent ships (§2.9.3, additive),
 *   every new entity is a root node — correct, just less precise.
 * - Enrichment is split at the entity/facet seam: entity agents write facts
 *   about the competitor (summary facts, features — once per org); facet
 *   agents write "relative to our product" data (differentiators).
 * - Discard/GC is tree-aware (§2.3 steps 4–5): the last facet on a tree takes
 *   the tree and its change rows with it; other products' context is never
 *   collateral damage.
 * - The updates/features scans are ENTITY-scoped (§2.7): monitoring runs once
 *   per entity node regardless of how many products face it.
 */
import { randomUUID } from "node:crypto";
import type { AgentSchedule, CompetitorEntity, CompetitorProfile, Product } from "@shared/schema";
import { ConflictError } from "../../http/errors.js";
import { trackAgentExecution, getAiAgentExecutionsByProduct } from "../../lib/agents/executions.js";
import { getAiAgent } from "../../lib/agents/registry.js";
import { AgentSlugs } from "../../lib/agents/slugs.js";
import { frequencyToMs } from "../../scheduler/gates.js";
import { computeDefaultSchedules } from "../../scheduler/defaults.js";
import type { EntityAgentTarget } from "../../scheduler/registry.js";
import { getAllProducts, getProduct } from "../products/storage.js";
import { generateCompetitorSummary } from "./agents/summary.js";
import { getCompetitorFeatures } from "./agents/features.js";
import { scanCompetitorUpdates, type ScanCompetitor } from "./agents/updates.js";
import { probeProductReleaseSources } from "./agents/releaseSources.js";
import type { CompetitorSummaryResult, CompetitorFeaturesResult } from "./schemas.js";
import { classificationToSourceCategory, type Classification } from "./schemas.js";
import * as storage from "./storage.js";

// ── Identity helpers (dedup keys, ADR 003 §2.2) ─────────────────────────────

/** Dedup key: lower-cased, punctuation-stripped, whitespace-collapsed. */
export function normalizeCompetitorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Second lookup key: the registrable host of a URL, without www. */
export function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase() || null;
  } catch {
    return null;
  }
}

// ── Near-dup helpers — re-homed to lib/text.ts (ADR 004 §4; the ADR 002 §5
// TODO fell due this sprint). Re-exported for existing consumers.
import { isNearDuplicateText, mergeDifferentiators } from "../../lib/text.js";
export { isNearDuplicateText, mergeDifferentiators };

// ── Child→root fact fallback (ADR 003 §2.9.2) ───────────────────────────────

/**
 * Read view of an entity node with company-root fallback: anything the child
 * doesn't carry (description, monitoring URLs, …) falls back to the root's
 * value. For root nodes this is the identity function.
 */
export function entityFactsWithFallback(
  entity: CompetitorEntity,
  parent: CompetitorEntity | null,
): CompetitorEntity {
  if (!parent) return entity;
  const merged = { ...entity } as Record<string, unknown>;
  for (const [key, value] of Object.entries(parent)) {
    if (key === "id" || key === "name" || key === "normalizedName" || key === "parentEntityId") continue;
    const current = merged[key];
    const isEmpty = current === null || current === undefined
      || (Array.isArray(current) && current.length === 0);
    if (isEmpty && value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as unknown as CompetitorEntity;
}

// ── Projection helper (ported agent functions expect this array shape) ──────

export function entityToScanCompetitor(
  entity: CompetitorEntity,
  sourceCategory: string | null | undefined,
): ScanCompetitor {
  return {
    name: entity.name,
    type: sourceCategory === "adjacent" ? "adjacent" : "competitor",
    url: entity.url || undefined,
    helpCenterUrl: entity.helpCenterUrl || undefined,
  };
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

// ── The ADD flow: dedup + adoption (ADR 003 §2.3) ───────────────────────────

export interface AddCompetitorInput {
  name: string;
  url?: string | undefined;
  classification: Classification;
}

export interface AddCompetitorResult {
  profile: CompetitorProfile;
  entity: CompetitorEntity;
  /** True when an existing entity node was adopted (no entity re-research). */
  adopted: boolean;
}

export async function addCompetitor(
  organizationId: string,
  product: Product,
  input: AddCompetitorInput,
): Promise<AddCompetitorResult> {
  const normalizedName = normalizeCompetitorName(input.name);
  const domain = extractDomain(input.url);

  // Dedup lookup (§2.3 step 1): domain first, then normalised name — spans
  // both tree levels (sub-brand names are stored fully qualified).
  let entity = domain
    ? await storage.findCompetitorEntityByDomain(organizationId, domain)
    : undefined;
  if (!entity) {
    entity = await storage.findCompetitorEntityByNormalizedName(organizationId, normalizedName);
  }

  const adopted = !!entity;

  if (entity) {
    // Facet-grain 409 (§2.9.2): one facet per (product, entity node).
    const existingFacet = await storage.getCompetitorProfileByProductAndEntity(product.id, entity.id);
    if (existingFacet) {
      throw new ConflictError("A competitor with this name already exists.");
    }
  } else {
    // Company-grain default: every add creates a ROOT node until the
    // resolution agent ships (§2.9.4) — correct, just less precise.
    entity = await storage.createCompetitorEntity({
      organizationId,
      name: input.name,
      normalizedName,
      parentEntityId: null,
      url: input.url || null,
      urlSource: input.url ? "manual" : "ai-discovered",
      domain,
      enrichmentStatus: "pending",
    });
  }

  // The proposal gate applies at the facet (§2.3): nothing is tracked until
  // the human accepts.
  const profile = await storage.createCompetitorFacet({
    productId: product.id,
    entityId: entity.id,
    sourceCategory: classificationToSourceCategory(input.classification),
    status: "proposed",
    enrichmentStatus: "pending",
  });

  return { profile, entity, adopted };
}

// ── Discard / delete + entity lifecycle GC (ADR 003 §2.3 steps 4–5) ─────────

/**
 * Delete a facet and garbage-collect the entity tree it pointed into
 * (ADR 003 §2.3 steps 4–5, incl. the 4 Aug 2026 demote-not-delete ruling):
 * - No facet left anywhere on the tree → the whole tree (root + children,
 *   including identity-only siblings) and every change row observed on it are
 *   deleted. For a discarded proposal this preserves §9's "a proposal that
 *   was never accepted leaves no history"; for the last tracked facet it
 *   matches the sprint-2 delete semantics at entity grain.
 * - Facets remain elsewhere on the tree → the tree stays. The discarded
 *   node's draft change rows are purged; roots always survive; a now-unfaceted
 *   CHILD is DEMOTED to an identity-only row (enrichment cleared, name/url/
 *   parentEntityId kept) rather than deleted — the org's knowledge of the
 *   competitor's portfolio shape must not regress on a tracking decision. The
 *   demoted child joins the identity-only siblings, kept for matching, GC'd
 *   only with the whole tree. Another product's tracked context is never
 *   collateral damage.
 * Threat-level history goes with the facet in every path (it is facet data).
 */
export async function deleteFacetWithGc(profile: CompetitorProfile): Promise<void> {
  await storage.deleteCompetitorThreatLevelHistoryByProfile(profile.id);
  await storage.deleteCompetitorProfileById(profile.id);

  const node = await storage.getCompetitorEntityById(profile.entityId);
  if (!node) return;

  const root = node.parentEntityId
    ? await storage.getCompetitorEntityById(node.parentEntityId)
    : node;
  if (!root) return;
  const children = await storage.getChildCompetitorEntities(root.id);
  const treeIds = [root.id, ...children.map(c => c.id)];

  const facetsOnTree = await storage.countFacetsForEntities(treeIds);
  if (facetsOnTree === 0) {
    // Abandoned tree: root + all (unfaceted) children + their change rows go.
    await storage.deleteCompetitorChangesByEntities(treeIds);
    await storage.deleteCompetitorEntitiesByIds([...children.map(c => c.id), root.id]);
    return;
  }

  // Tree still carries context. Roots survive untouched; a now-unfaceted
  // CHILD is demoted to an identity-only row and its change rows are purged.
  if (node.parentEntityId) {
    const facetsOnNode = await storage.countFacetsForEntities([node.id]);
    if (facetsOnNode === 0) {
      await storage.deleteCompetitorChangesByEntities([node.id]);
      await storage.demoteCompetitorEntityToIdentity(node.id);
    }
  }
}

// ── Rename (ADR 003 §2.4: entity-row update; restriction lifted) ────────────

/**
 * Rename the competitor: with change history FK'd to the entity, rename is a
 * plain entity-row update — the sprint-2 "tracked competitors cannot be
 * renamed" 400 is lifted. Collision rule is org-wide (the entity dedup key).
 */
export async function renameCompetitor(
  organizationId: string,
  entity: CompetitorEntity,
  newName: string,
): Promise<CompetitorEntity> {
  const normalizedName = normalizeCompetitorName(newName);
  const collision = await storage.findCompetitorEntityByNormalizedName(organizationId, normalizedName);
  if (collision && collision.id !== entity.id) {
    throw new ConflictError("A competitor with this name already exists.");
  }
  return storage.renameCompetitorEntity(entity.id, newName, normalizedName);
}

// ── Active-run detection (routes.ts:7877–7944 port, unchanged semantics) ────

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

/**
 * Save a validated summary result: entity FACTS (description, url, markets,
 * citations) merge onto the entity node; differentiators — theirs vs US — are
 * facet data. In facet-only mode (adoption) entity facts are left untouched.
 */
async function applySummaryResult(
  entity: CompetitorEntity,
  profile: CompetitorProfile,
  sr: CompetitorSummaryResult,
  options: { facetOnly: boolean },
): Promise<void> {
  if (!options.facetOnly) {
    const cachedEntity = await storage.getCompetitorEntityById(entity.id);
    const entityUpdate: Record<string, unknown> = {
      description: sr.summary,
      descriptionSourceUrl: sr.sourceUrl || "",
    };

    // Only adopt the AI-discovered website URL when the user did not set one.
    if (sr.websiteUrl && (!cachedEntity?.url || cachedEntity?.urlSource === "ai-discovered")) {
      entityUpdate["url"] = sr.websiteUrl;
      entityUpdate["urlSource"] = "ai-discovered";
      entityUpdate["domain"] = extractDomain(sr.websiteUrl);
    }

    if (sr.markets && sr.markets.length > 0) {
      const existingMarkets = (cachedEntity?.markets as Array<{ market?: string; sourceUrl?: string }> | null) || [];
      const marketSet = new Set<string>(existingMarkets.map(m => (m.market || "").toLowerCase().trim()));
      const mergedMarkets = [...existingMarkets];
      for (const m of sr.markets) {
        const normalized = m.toLowerCase().trim();
        if (normalized && !marketSet.has(normalized)) {
          marketSet.add(normalized);
          mergedMarkets.push({ market: m, sourceUrl: sr.sourceUrl || undefined });
        }
      }
      entityUpdate["markets"] = mergedMarkets;
    }

    if (sr.citations && sr.citations.length > 0) {
      entityUpdate["summaryCitations"] = sr.citations;
    }

    await storage.mergeCompetitorEntityFacts(entity.id, entityUpdate);
  }

  if (sr.keyDifferentiators && sr.keyDifferentiators.length > 0) {
    const cachedProfile = await storage.getCompetitorProfileById(profile.id);
    const existingDiffs = (cachedProfile?.keyDifferentiators as string[] | null) || [];
    await storage.updateCompetitorProfile(profile.id, {
      keyDifferentiators: mergeDifferentiators(existingDiffs, sr.keyDifferentiators),
    });
  }
}

/**
 * Save validated features onto the ENTITY node, merged by feature name, and
 * apply the baseline-vs-diff rule (brief §10a.2 — "detecting change, not
 * re-deriving"; live-user ruling 4 Aug 2026):
 *
 * - FIRST successful observation (no prior feature baseline on the entity):
 *   store the inventory SILENTLY. The baseline is not a change — the Key
 *   Features section is its home; a change row would duplicate it.
 * - Subsequent scans: diff against the stored baseline and record only the
 *   ADDITIONS as one evidence-cited change row. Removals and modifications
 *   are deliberately NOT recorded: the merge never deletes (a sampled web
 *   scan cannot distinguish "removed" from "not sampled this run"), and
 *   description text is LLM-paraphrased every run, so "modified" would be
 *   pure noise. ("Newly released" vs "newly observed" semantics are deferred
 *   to the reviews sprint per the coordinator's note.)
 */
async function applyFeaturesResult(
  entity: CompetitorEntity,
  fr: CompetitorFeaturesResult,
  sourceCategory: string,
): Promise<{ isFirstObservation: boolean; newFeatureNames: string[] }> {
  const cachedEntity = await storage.getCompetitorEntityById(entity.id);
  const existing = (cachedEntity?.keyFeatures as Array<{ feature?: string; description?: string; sourceUrl?: string | null }> | null) || [];
  const isFirstObservation = existing.filter(f => f.feature).length === 0;
  const priorNames = new Set(
    existing.map(f => (f.feature || "").toLowerCase().trim()).filter(Boolean),
  );

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

  await storage.mergeCompetitorEntityFacts(entity.id, { keyFeatures: [...byName.values()] });

  const newFeatures = fr.features.filter(f => !priorNames.has(f.name.toLowerCase().trim()));
  const newFeatureNames = newFeatures.map(f => f.name);

  if (!isFirstObservation && newFeatures.length > 0) {
    await storage.createCompetitorChange({
      entityId: entity.id,
      sourceCategory,
      changeType: "feature",
      changeTitle: `${entity.name}: ${newFeatures.length} new feature${newFeatures.length === 1 ? "" : "s"} observed`,
      changeDescription: newFeatureNames.slice(0, 5).join(", "),
      sourceUrl: newFeatures[0]?.documentationUrl || entity.url || "",
      sourceType: "agent",
    });
  }

  return { isFirstObservation, newFeatureNames };
}

export interface EnrichmentOptions {
  /**
   * Adoption mode (§2.3 step 2): the entity node already carries researched
   * facts — only facet-scoped work runs (differentiators vs this product);
   * entity facts and entity enrichment state are untouched.
   */
  facetOnly?: boolean;
}

/**
 * Run the enrichment agents for one facet and persist the results. Each agent
 * runs under trackAgentExecution (execution rows carry competitorName so the
 * active-run poll can attribute them).
 */
export async function enrichCompetitor(
  organizationId: string,
  product: Product,
  profileId: string,
  options: EnrichmentOptions = {},
): Promise<boolean> {
  const facetOnly = options.facetOnly === true;
  const joined = await storage.getFacetWithEntityById(profileId);
  if (!joined) return false;
  const { profile, entity } = joined;

  await storage.updateCompetitorProfile(profile.id, { enrichmentStatus: "enriching" });
  if (!facetOnly) {
    await storage.updateCompetitorEntity(entity.id, { enrichmentStatus: "enriching" });
  }

  let anySucceeded = false;
  const sourceCategory = profile.sourceCategory === "adjacent" ? "adjacent" : "competitor";

  // Summary (entity facts + facet differentiators; facet-only in adoption mode)
  try {
    await trackAgentExecution(
      {
        agentSlug: AgentSlugs.COMPETITOR_SUMMARY,
        triggerType: "api",
        productId: product.id,
        entityId: entity.id,
        inputData: { competitorName: entity.name },
      },
      async () => {
        const sr = await generateCompetitorSummary(
          entity.name,
          entity.url || "",
          product.name,
          product.description || undefined,
          organizationId,
          undefined,
          product.id,
        );
        if (sr?.summary) {
          await applySummaryResult(entity, profile, sr, { facetOnly });
          anySucceeded = true;
        }
        return sr;
      },
    );
  } catch (err) {
    console.error(`[Competitors] Summary enrichment failed for ${entity.name}:`, err instanceof Error ? err.message : err);
  }

  // Features — entity research; skipped entirely in adoption mode.
  if (!facetOnly) {
    try {
      await trackAgentExecution(
        {
          agentSlug: AgentSlugs.COMPETITOR_FEATURES,
          triggerType: "api",
          productId: product.id,
          entityId: entity.id,
          inputData: { competitorName: entity.name },
        },
        async () => {
          const fresh = await storage.getCompetitorEntityById(entity.id);
          const fr = await getCompetitorFeatures(
            entity.name,
            fresh?.url || entity.url || "",
            fresh?.helpCenterUrl || undefined,
            organizationId,
            undefined,
            product.id,
          );
          if (fr && fr.features.length > 0) {
            // Baseline-vs-diff rule lives in applyFeaturesResult: the first
            // observation stores the inventory silently; later scans record
            // only additions as change rows (§10a.2 ruling).
            await applyFeaturesResult(entity, fr, sourceCategory);
            anySucceeded = true;
          }
          return fr;
        },
      );
    } catch (err) {
      console.error(`[Competitors] Features enrichment failed for ${entity.name}:`, err instanceof Error ? err.message : err);
    }
  }

  await storage.updateCompetitorProfile(profile.id, {
    enrichmentStatus: anySucceeded ? "completed" : "failed",
    lastEnrichedAt: anySucceeded ? new Date() : undefined,
  });
  if (!facetOnly) {
    await storage.updateCompetitorEntity(entity.id, {
      enrichmentStatus: anySucceeded ? "completed" : "failed",
      lastEnrichedAt: anySucceeded ? new Date() : undefined,
    });
  }

  return anySucceeded;
}

/** Fire-and-forget enrichment used by the POST add flow. */
export function startEnrichment(
  organizationId: string,
  product: Product,
  profileId: string,
  options: EnrichmentOptions = {},
): Promise<boolean> {
  return trackBackground(
    enrichCompetitor(organizationId, product, profileId, options).catch((err) => {
      console.error(`[Competitors] Background enrichment error:`, err);
      return false;
    }),
  );
}

// ── Refresh (entity + facet enrichment + updates scan for one entity) ───────

export async function refreshCompetitor(
  organizationId: string,
  product: Product,
  profileId: string,
): Promise<{ runId: string }> {
  const runId = randomUUID();
  trackBackground((async () => {
    const succeeded = await enrichCompetitor(organizationId, product, profileId);
    const joined = await storage.getFacetWithEntityById(profileId);
    if (joined) {
      await runUpdatesScanForEntity(organizationId, joined.entity.id, {
        contextProductName: product.name,
      });
    }
    console.log(`[Competitors] Refresh ${runId} for facet ${profileId}: ${succeeded ? "success" : "failed"}`);
  })().catch((err) => {
    console.error(`[Competitors] Refresh ${runId} error:`, err);
  }));
  return { runId };
}

// ── Entity-scoped scans (ADR 003 §2.7: once per entity node) ────────────────

const RELEASE_SOURCE_CACHE_TTL_DAYS = 7;

/**
 * The classification an entity-scoped scan records on its change rows: the
 * observing context. "competitor" wins when any facing product classifies the
 * node as a direct competitor; otherwise the first facet's category.
 */
function dominantSourceCategory(facets: CompetitorProfile[]): "competitor" | "adjacent" {
  const relevant = facets.filter(f => f.sourceCategory !== "own_product");
  return relevant.some(f => f.sourceCategory === "competitor")
    ? "competitor"
    : (relevant[0]?.sourceCategory === "adjacent" ? "adjacent" : "competitor");
}

/**
 * Dual-stream market/product signal scan for ONE entity node, writing new
 * entity-keyed `competitor_changes` rows (dedup by title + sourceUrl).
 * Release-source URLs are probed once and cached on the entity for 7 days.
 */
export async function runUpdatesScanForEntity(
  organizationId: string,
  entityId: string,
  options: { contextProductName?: string } = {},
): Promise<{ savedCount: number; totalFound: number; summary: string; failureReason?: string }> {
  const entity = await storage.getCompetitorEntityById(entityId);
  if (!entity) {
    return { savedCount: 0, totalFound: 0, summary: "Competitor entity not found" };
  }

  const facets = await storage.getCompetitorProfilesByEntity(entity.id);
  const relevantFacets = facets.filter(f => f.sourceCategory !== "own_product");
  const sourceCategory = dominantSourceCategory(facets);

  // Prompt context: "competitors of X". Prefer the caller's product; fall
  // back to the first faceted product's name.
  let contextProductName = options.contextProductName;
  if (!contextProductName) {
    const firstFacet = relevantFacets[0] ?? facets[0];
    const contextProduct = firstFacet ? await getProduct(firstFacet.productId) : undefined;
    contextProductName = contextProduct?.name ?? "our product";
  }

  const scanCompetitor = entityToScanCompetitor(entity, sourceCategory);

  // Fetch cached release sources; probe + persist when the cache is stale.
  const cacheExpiryCutoff = new Date();
  cacheExpiryCutoff.setDate(cacheExpiryCutoff.getDate() - RELEASE_SOURCE_CACHE_TTL_DAYS);

  const confirmedReleaseSources: Record<string, string[]> = {};
  try {
    const cached = entity.validReleaseSources as { urls: string[]; checkedAt: string } | null | undefined;
    const cacheIsFresh = cached?.checkedAt && new Date(cached.checkedAt) >= cacheExpiryCutoff;

    if (cacheIsFresh && cached!.urls.length > 0) {
      console.log(`[Competitors] Using cached release sources for ${entity.name} (${cached!.urls.length} URLs)`);
      confirmedReleaseSources[entity.name] = cached!.urls;
    } else {
      const confirmedUrls = await probeProductReleaseSources({
        name: entity.name,
        url: entity.url || undefined,
        helpCenterUrl: entity.helpCenterUrl || undefined,
      });
      confirmedReleaseSources[entity.name] = confirmedUrls;
      await storage.updateCompetitorEntity(entity.id, {
        validReleaseSources: { urls: confirmedUrls, checkedAt: new Date().toISOString() },
      });
      console.log(`[Competitors] Cached ${confirmedUrls.length} release sources for ${entity.name}`);
    }
  } catch (probeErr) {
    console.warn(`[Competitors] Release-source probe failed for ${entity.name}: ${probeErr instanceof Error ? probeErr.message : probeErr}`);
  }

  // NOTE: trusted news sources come from the Sources module — later sprint;
  // undefined here means the agent falls back to open web search.
  const result = await scanCompetitorUpdates(
    contextProductName,
    [scanCompetitor],
    organizationId,
    undefined,
    undefined,
    confirmedReleaseSources,
    undefined,
  );

  if (result.failureReason) {
    console.warn(`[Competitors] Updates scan FAILURE for entity ${entity.name}: reason=${result.failureReason} | ${result.searchSummary}`);
  }

  let savedCount = 0;
  const existingChanges = await storage.getCompetitorChangesByEntity(entity.id, 200);
  // Dedupe key: title + source URL — seeded from stored changes AND updated
  // within this batch ("no silent duplicates" is the pitch).
  const seen = new Set(existingChanges.map(c => `${c.changeTitle}::${c.sourceUrl ?? ""}`));

  // Post-tracking clamp (§10a honesty ruling, 4 Aug 2026): the scan looks
  // back 180 days, so the FIRST run would otherwise backfill months of
  // historic changelog/news entries as freshly "detected" changes. The feed
  // records what changed while we were watching: only items whose published
  // date falls on or after the day the entity began being tracked
  // (createdAt, day-granular to be fair to date-only changelog stamps) are
  // written. Items whose date cannot be parsed are dropped too — we cannot
  // establish they are post-tracking. This applies to every scan, not just
  // the first: the dedupe set makes re-scans a non-issue, and a pre-tracking
  // date is historic context regardless of when we happen to observe it.
  // UTC day-start: date-only changelog stamps ("2026-07-15") parse as UTC
  // midnight, so the clamp boundary must be UTC-day-granular too.
  const createdAt = entity.createdAt ? new Date(entity.createdAt) : null;
  const trackingStart = createdAt
    ? new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate()))
    : null;

  for (const update of result.updates) {
    if (trackingStart) {
      const published = update.publishedDate ? new Date(update.publishedDate) : null;
      if (!published || Number.isNaN(published.getTime()) || published < trackingStart) {
        console.log(`[Competitors] Skipped pre-tracking item for ${entity.name}: "${update.changeTitle}" (published ${update.publishedDate ?? "unknown"}, tracking since ${trackingStart.toISOString().slice(0, 10)})`);
        continue;
      }
    }
    const key = `${update.changeTitle}::${update.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await storage.createCompetitorChange({
      entityId: entity.id,
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

  console.log(`[Competitors] Updates scan complete for ${entity.name}: ${savedCount} new updates saved (${result.updates.length} found)`);
  return { savedCount, totalFound: result.updates.length, summary: result.searchSummary, ...(result.failureReason ? { failureReason: result.failureReason } : {}) };
}

/**
 * Scheduled features refresh for ONE entity node (entity research — features
 * are entity facts, §2.2). Throws on failure so trackAgentExecution records a
 * failed run and the circuit breaker can fire. The baseline-vs-diff rule
 * (first observation silent, later scans record additions as change rows)
 * lives in applyFeaturesResult, shared with the add-flow enrichment.
 */
export async function runFeaturesScanForEntity(
  organizationId: string,
  entityId: string,
): Promise<{ processed: boolean }> {
  const entity = await storage.getCompetitorEntityById(entityId);
  if (!entity) return { processed: false };

  const competitorTimeoutMs = 90_000;
  const result = await Promise.race([
    getCompetitorFeatures(
      entity.name,
      entity.url || "",
      entity.helpCenterUrl || undefined,
      organizationId,
      undefined,
      undefined,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[Competitors] Per-competitor timeout (${competitorTimeoutMs / 1000}s) fired for ${entity.name}`)), competitorTimeoutMs),
    ),
  ]);

  if (result && result.features && result.features.length > 0) {
    const facets = await storage.getCompetitorProfilesByEntity(entity.id);
    await applyFeaturesResult(entity, result, dominantSourceCategory(facets));
    return { processed: true };
  }
  return { processed: false };
}

// ── Competitor review mining (entity-scoped, ADR 004 §2) ────────────────────

/**
 * Run review mining for ONE entity node and conditional-merge the result onto
 * the entity review columns (scheduler.ts:2849–2985 logic, re-keyed to the
 * entity; the feedback-bridge tail is deleted — competitor voice lives on the
 * competitor object). Only fields the run actually returned overwrite; the
 * §10a baseline rule applies via the entity merge helper.
 */
export async function runReviewsScanForEntity(
  organizationId: string,
  entityId: string,
): Promise<{ processed: boolean }> {
  const { getCompetitorReviews } = await import("./agents/reviews.js");
  const { getFeedbackSourcesByProduct } = await import("../customers/storage.js");

  const entity = await storage.getCompetitorEntityById(entityId);
  if (!entity) return { processed: false };

  // Trusted sources: union across the products holding tracked facets.
  const facets = (await storage.getCompetitorProfilesByEntity(entity.id))
    .filter(f => f.status === "tracked" && f.sourceCategory !== "own_product");
  const sourceMap = new Map<string, { name: string; url: string }>();
  for (const facet of facets) {
    for (const source of await getFeedbackSourcesByProduct(facet.productId)) {
      if (source.type === "review" || source.type === "comparison") {
        sourceMap.set(source.url, { name: source.name, url: source.url });
      }
    }
  }
  const trustedFeedbackSources = [...sourceMap.values()];

  const result = await getCompetitorReviews(
    entity.name,
    organizationId,
    trustedFeedbackSources.length > 0 ? trustedFeedbackSources : undefined,
  );
  if (!result) return { processed: false };

  // Conditional merge — only include fields with actual non-empty data so an
  // incomplete run never wipes cached review data (SaaS semantics preserved).
  const reviewUpdate: Record<string, unknown> = {};
  if (result.quotes.length > 0) {
    reviewUpdate["reviews"] = result.quotes.map(q => ({
      text: q.text,
      source: q.source,
      sourceUrl: q.sourceUrl,
      sentiment: q.rating ? Math.round(q.rating * 20) : null,
      date: q.date ?? null,
      verified: !!q.sourceUrl,
      sourceType: "web_search",
      fetchedAt: result.lastUpdated,
    }));
  }
  if (result.platforms.length > 0) reviewUpdate["reviewPlatforms"] = result.platforms;
  if (result.positiveThemes.length > 0) reviewUpdate["reviewPositiveThemes"] = result.positiveThemes;
  if (result.negativeThemes.length > 0) reviewUpdate["reviewNegativeThemes"] = result.negativeThemes;
  if (result.averageRating !== undefined && result.averageRating !== null) reviewUpdate["reviewAverageRating"] = result.averageRating;
  if (result.totalReviews !== undefined && result.totalReviews !== null) reviewUpdate["reviewTotalCount"] = result.totalReviews;

  if (Object.keys(reviewUpdate).length > 0) {
    await storage.mergeCompetitorEntityFacts(entity.id, reviewUpdate);
  }
  return { processed: true };
}

/**
 * Append mined quotes to a tracked entity's `reviews` (ADR 004 §2
 * cross-allocation — the allowed cross-module write path). Dedup by the
 * ported 100-char lowercase prefix key.
 */
export async function appendEntityReviews(
  entityId: string,
  quotes: Array<{ text: string; source: string; sourceUrl: string; sentiment: number | null; verified: boolean; sourceCreatedAt?: string | null }>,
): Promise<number> {
  const entity = await storage.getCompetitorEntityById(entityId);
  if (!entity) return 0;
  const existing = (entity.reviews as Array<{ text?: string }> | null) ?? [];
  const keys = new Set(existing.map(r => (r.text || "").toLowerCase().trim().substring(0, 100)));
  const appended = [...existing];
  let added = 0;
  const now = new Date().toISOString();
  for (const quote of quotes) {
    if (!quote.text || quote.text.trim().length < 10) continue;
    const key = quote.text.toLowerCase().trim().substring(0, 100);
    if (keys.has(key)) continue;
    keys.add(key);
    appended.push({
      text: quote.text,
      source: quote.source,
      sourceUrl: quote.sourceUrl,
      sentiment: quote.sentiment,
      verified: quote.verified,
      sourceType: "web_search",
      fetchedAt: now,
      date: quote.sourceCreatedAt ?? null,
    } as { text?: string });
    added++;
  }
  if (added > 0) {
    await storage.mergeCompetitorEntityFacts(entityId, { reviews: appended });
  }
  return added;
}

/**
 * Resolve a mined competitor mention to a TRACKED entity for this product
 * (ADR 004 §2): match against competitor_entities by normalised name; no
 * tracked facet for the product → null (caller drops and logs — an untracked
 * competitor must not accumulate context).
 */
export async function resolveTrackedCompetitorForProduct(
  organizationId: string,
  productId: string,
  name: string,
): Promise<{ entityId: string; entityName: string } | null> {
  const entity = await storage.findCompetitorEntityByNormalizedName(organizationId, normalizeCompetitorName(name));
  if (!entity) return null;
  const facet = await storage.getCompetitorProfileByProductAndEntity(productId, entity.id);
  if (!facet || facet.status !== "tracked" || facet.sourceCategory === "own_product") return null;
  return { entityId: entity.id, entityName: entity.name };
}

/** Tracked competitor names for a product (cross-allocation known-name list). */
export async function listTrackedCompetitorNames(productId: string): Promise<string[]> {
  const joined = await storage.getFacetsWithEntitiesByProduct(productId);
  return joined
    .filter(j => j.profile.status === "tracked" && j.profile.sourceCategory !== "own_product")
    .map(j => j.entity.name);
}

// ── Entity agent target resolution (scheduler wiring, ADR 003 §2.7) ─────────

const FALLBACK_TIMEZONE = "Europe/London";

function resolveProductSchedule(product: Product, scheduleKey: string): AgentSchedule {
  const schedules = (product.agentSchedules ?? {}) as Record<string, AgentSchedule | undefined>;
  return schedules[scheduleKey] ?? computeDefaultSchedules(product)[scheduleKey] ?? {
    enabled: true,
    frequencyValue: 7,
    frequencyUnit: "days",
    timeOfDay: "09:00",
  };
}

function resolveProductTimezone(product: Product): string {
  const schedules = (product.agentSchedules ?? {}) as Record<string, unknown>;
  const tz = schedules["timezone"];
  return typeof tz === "string" && tz ? tz : FALLBACK_TIMEZONE;
}

/**
 * Resolve the run targets for an entity-scoped agent: every entity node in
 * every org with ≥1 tracked (non-own-product) facet. The effective schedule
 * for a node shared by several products is the MOST DEMANDING one (shortest
 * interval) among the products facing it — no product's expectation is
 * starved, and the run still happens once ("track Mixpanel from five
 * products, research it once").
 */
export async function listEntityAgentTargets(scheduleKey: string): Promise<EntityAgentTarget[]> {
  const products = await getAllProducts();
  if (products.length === 0) return [];
  const productById = new Map(products.map(p => [p.id, p]));
  const organizationIds = [...new Set(products.map(p => p.organizationId))];

  const targets: EntityAgentTarget[] = [];
  for (const organizationId of organizationIds) {
    const entities = await storage.getEntitiesWithTrackedFacets(organizationId);
    for (const { entity, trackedFacets } of entities) {
      let best: { schedule: AgentSchedule; timezone: string } | null = null;
      for (const facet of trackedFacets) {
        const product = productById.get(facet.productId);
        if (!product) continue;
        const schedule = resolveProductSchedule(product, scheduleKey);
        if (!schedule.enabled) continue;
        if (!best || frequencyToMs(schedule.frequencyValue, schedule.frequencyUnit) < frequencyToMs(best.schedule.frequencyValue, best.schedule.frequencyUnit)) {
          best = { schedule, timezone: resolveProductTimezone(product) };
        }
      }
      if (!best) continue; // every facing product has the agent disabled
      targets.push({
        entityId: entity.id,
        entityName: entity.name,
        organizationId,
        schedule: best.schedule,
        timezone: best.timezone,
      });
    }
  }
  return targets;
}
