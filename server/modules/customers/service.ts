/**
 * Customers orchestration (ADR 004 §4): segment add/adopt/discard on the 3a
 * entity/facet shapes, persona lifecycle with per-facet gating (§7), the
 * evidence-gated enrichment fan-out (§3.3 — gather then synthesise), the
 * §3.6.1 classify-first theme run, and the feedback collection run with
 * entity-resolved cross-allocation (§2).
 */
import { randomUUID } from "node:crypto";
import type {
  CustomerSegmentProfile,
  FeedbackTheme,
  Persona,
  PersonaFacet,
  Product,
  SegmentEntity,
} from "@shared/schema";
import { ConflictError, UnprocessableError } from "../../http/errors.js";
import { trackAgentExecution } from "../../lib/agents/executions.js";
import { AgentSlugs } from "../../lib/agents/slugs.js";
import { fetchProductReviews } from "../../lib/reviews/fetch.js";
import {
  appendEntityReviews,
  listTrackedCompetitorNames,
  resolveTrackedCompetitorForProduct,
} from "../competitors/service.js";
import {
  collectSegmentEvidence,
  computeOverallSatisfaction,
  distinctSourcesForRefs,
  EVIDENCE_THRESHOLDS,
  evidenceStatusFor,
  findInvalidEvidenceRefs,
  type EvidenceItem,
  type EvidenceRef,
  type EvidenceStatus,
} from "./evidence.js";
import { normalizeSegmentName } from "./normalization.js";
import { findCustomerSegmentQuotes } from "./agents/segmentQuotes.js";
import { synthesiseSegmentInsights } from "./agents/segmentInsights.js";
import { extractFeaturesFromReviews } from "./agents/gatherFeedback.js";
import { scoreUnscoredFeedback } from "./agents/sentiment.js";
import {
  classifyEntriesIntoThemes,
  clusterResidueEntries,
  findThemeByNameOrAlias,
  normalizeThemeName,
  pruneOrphanedThemesForProduct,
  semanticCreationGate,
} from "./agents/themes.js";
import type { PersonaProposal, ResidueThemeCandidate } from "./schemas.js";
import * as storage from "./storage.js";

// ── Background task tracking (tests await settleBackgroundTasks) ────────────

const backgroundTasks = new Set<Promise<unknown>>();

function trackBackground<T>(promise: Promise<T>): Promise<T> {
  backgroundTasks.add(promise);
  void promise.finally(() => backgroundTasks.delete(promise)).catch(() => {});
  return promise;
}

/** Await every in-flight background run (test helper). */
export async function settleCustomerBackgroundTasks(): Promise<void> {
  while (backgroundTasks.size > 0) {
    await Promise.allSettled([...backgroundTasks]);
  }
}

// ── Segments: add/adopt (ADR 004 §6.1, mechanics mirror competitors §2.3) ───

export interface AddSegmentInput {
  name: string;
  description?: string | undefined;
  segmentType?: string | undefined;
  /** §7: owner-created facets are tracked immediately; agent-created propose. */
  provenance: "owner" | "agent";
}

export interface AddSegmentResult {
  facet: CustomerSegmentProfile;
  entity: SegmentEntity;
  adopted: boolean;
}

export async function addSegment(
  organizationId: string,
  product: Product,
  input: AddSegmentInput,
): Promise<AddSegmentResult> {
  // Blocklist honoured (product-scoped, ADR 003 §2.6): a deleted name is not
  // silently recreated — the owner unblocks it first (§6.1 blocked-segments).
  if (await storage.isSegmentNameBlocked(product.id, input.name)) {
    throw new ConflictError(
      "This segment name was previously deleted for this product. Unblock it under blocked segments before adding it again.",
    );
  }

  const normalizedName = normalizeSegmentName(input.name);
  let entity = await storage.findSegmentEntityByNormalizedName(organizationId, normalizedName);
  const adopted = !!entity;

  if (entity) {
    const existing = await storage.getSegmentFacetByProductAndEntity(product.id, entity.id);
    if (existing) {
      throw new ConflictError("A segment with this name already exists.");
    }
  } else {
    entity = await storage.createSegmentEntity({
      organizationId,
      name: input.name,
      normalizedName,
      segmentType: input.segmentType ?? "customer_segment",
      description: input.description ?? null,
    });
  }

  const facet = await storage.createSegmentFacet({
    productId: product.id,
    organizationId,
    segmentEntityId: entity.id,
    status: input.provenance === "owner" ? "tracked" : "proposed",
    provenance: input.provenance,
    enrichmentStatus: "pending",
  });

  return { facet, entity, adopted };
}

/**
 * Segment facet delete + entity GC (flat — no tree) + the product-scoped
 * blocklist write suppressing agent re-proposal (§6.1).
 */
export async function deleteSegmentWithGc(facet: CustomerSegmentProfile, entity: SegmentEntity): Promise<void> {
  // Personas hang off the entity; this product's persona facets go with the
  // segment facet, and persona identity GCs when no facets remain anywhere.
  const segmentPersonas = await storage.getPersonasBySegmentEntity(entity.id);
  for (const persona of segmentPersonas) {
    const personaFacet = await storage.getPersonaFacet(persona.id, facet.productId);
    if (personaFacet) await storage.deletePersonaFacetById(personaFacet.id);
    const remaining = await storage.getPersonaFacetsByPersona(persona.id);
    if (remaining.length === 0) await storage.deletePersonaById(persona.id);
  }

  await storage.deleteSegmentFacetById(facet.id);
  await storage.recordDeletedSegmentName(facet.productId, entity.name);

  const remainingFacets = await storage.getSegmentFacetsByEntity(entity.id);
  if (remainingFacets.length === 0) {
    await storage.deleteSegmentEntityById(entity.id);
  }
}

// ── Personas (§6.2, §7) ─────────────────────────────────────────────────────

export async function createOwnerPersona(
  productId: string,
  segmentEntityId: string,
  input: {
    title: string;
    description?: string | undefined;
    demographics?: Record<string, unknown> | undefined;
    behaviours?: string[] | undefined;
    facet?: { goals?: string[] | undefined; painPoints?: string[] | undefined; jobsToBeDone?: unknown } | undefined;
  },
): Promise<{ persona: Persona; facet: PersonaFacet }> {
  const persona = await storage.createPersona({
    segmentEntityId,
    title: input.title,
    description: input.description ?? null,
    demographics: input.demographics ?? null,
    behaviours: input.behaviours ?? null,
    provenance: "owner",
  });
  // Owner claims carry `owner` evidence refs — first-class, clearly labelled.
  const ownerClaim = (text: string) => ({ text, evidenceRefs: [{ kind: "owner" as const }] });
  const facet = await storage.createPersonaFacet({
    personaId: persona.id,
    productId,
    status: "tracked",
    provenance: "owner",
    goals: (input.facet?.goals ?? []).map(ownerClaim),
    painPoints: (input.facet?.painPoints ?? []).map(ownerClaim),
    jobsToBeDone: input.facet?.jobsToBeDone ?? null,
  });
  return { persona, facet };
}

/** Facet delete; persona identity GC'd when zero facets remain (§6.2). */
export async function deletePersonaFacetWithGc(persona: Persona, facet: PersonaFacet): Promise<void> {
  await storage.deletePersonaFacetById(facet.id);
  const remaining = await storage.getPersonaFacetsByPersona(persona.id);
  if (remaining.length === 0) {
    await storage.deletePersonaById(persona.id);
  }
}

// ── Evidence-gated enrichment (§3.3) ────────────────────────────────────────

export async function getSegmentEvidence(
  productId: string,
  facet: CustomerSegmentProfile,
): Promise<{ items: EvidenceItem[]; status: EvidenceStatus }> {
  return collectSegmentEvidence(productId, facet);
}

/**
 * The §3.3 manual trigger and scheduled body: gather quotes (web ON), then —
 * only when the pool clears the threshold — synthesise (web OFF, enumerated
 * evidence). Below threshold the synthesiser has no target; the caller serves
 * the absence honestly.
 */
export async function enrichSegment(
  organizationId: string,
  product: Product,
  facetId: string,
  options: { gatherQuotes?: boolean } = {},
): Promise<{ runId: string }> {
  const runId = randomUUID();
  trackBackground((async () => {
    const facet = await storage.getSegmentFacetById(facetId);
    if (!facet) return;
    const entity = await storage.getSegmentEntityById(facet.segmentEntityId);
    if (!entity) return;

    await storage.updateSegmentFacet(facet.id, { enrichmentStatus: "enriching" });
    let succeeded = false;

    // Gather (customer-quotes-agent): its output IS evidence — URL-cited.
    if (options.gatherQuotes !== false) {
      try {
        await trackAgentExecution(
          { agentSlug: AgentSlugs.CUSTOMER_QUOTES, triggerType: "api", productId: product.id, inputData: { segmentName: entity.name, facetId: facet.id } },
          () => runQuotesGatherForFacet(organizationId, product, facet.id),
        );
        succeeded = true;
      } catch (err) {
        console.error(`[Customers] Quotes gathering failed for "${entity.name}":`, err instanceof Error ? err.message : err);
      }
    }

    // Synthesise (customer-insights-agent): only with sufficient evidence.
    try {
      const fresh = await storage.getSegmentFacetById(facet.id);
      const { items, status } = await collectSegmentEvidence(product.id, fresh ?? facet);
      if (status.sufficientFor.includes("insights") || status.sufficientFor.includes("personas")) {
        await trackAgentExecution(
          { agentSlug: AgentSlugs.CUSTOMER_INSIGHTS, triggerType: "api", productId: product.id, inputData: { segmentName: entity.name, facetId: facet.id } },
          () => runInsightsSynthesisForFacet(organizationId, product, facet.id, items),
        );
        succeeded = true;
      } else {
        console.log(`[Customers] Skipping insights synthesis for "${entity.name}" — insufficient evidence (${status.count} items, ${status.distinctSources} sources)`);
      }
    } catch (err) {
      console.error(`[Customers] Insights synthesis failed for "${entity.name}":`, err instanceof Error ? err.message : err);
    }

    await storage.updateSegmentFacet(facet.id, {
      enrichmentStatus: succeeded ? "completed" : "failed",
      lastEnrichedAt: succeeded ? new Date() : undefined,
    });
  })().catch(err => console.error(`[Customers] Enrichment run ${runId} error:`, err)));
  return { runId };
}

/** §3.3 layer 1: manual enrich below threshold → 422 with the status attached. */
export async function requireEvidenceForEnrichment(
  productId: string,
  facet: CustomerSegmentProfile,
): Promise<EvidenceStatus> {
  const { status } = await collectSegmentEvidence(productId, facet);
  // The quotes gatherer can always run; the SYNTHESIS threshold is the gate
  // for the manual "enrich now" that promises personas/insights.
  if (!status.sufficientFor.includes("personas") && !status.sufficientFor.includes("insights")) {
    throw new UnprocessableError("insufficient_evidence", { evidenceStatus: status });
  }
  return status;
}

export async function runQuotesGatherForFacet(
  organizationId: string,
  product: Product,
  facetId: string,
): Promise<{ added: number }> {
  const facet = await storage.getSegmentFacetById(facetId);
  if (!facet) return { added: 0 };
  const entity = await storage.getSegmentEntityById(facet.segmentEntityId);
  if (!entity) return { added: 0 };

  const existingQuotes = (facet.quotes as Array<{ text?: string }> | null) ?? [];
  const quotes = await findCustomerSegmentQuotes(
    product.name,
    product.url || "",
    entity.name,
    entity.description || "",
    existingQuotes,
    organizationId,
  );

  // Merge, don't replace: dedup by 50-char prefix (matches the existing-quotes
  // prompt exclusion window).
  const keys = new Set(existingQuotes.map(q => (q.text || "").toLowerCase().slice(0, 50)));
  const merged = [...existingQuotes];
  let added = 0;
  for (const quote of quotes) {
    const key = quote.text.toLowerCase().slice(0, 50);
    if (keys.has(key)) continue;
    keys.add(key);
    merged.push(quote as unknown as { text?: string });
    added++;
  }
  if (added > 0) {
    await storage.updateSegmentFacet(facet.id, { quotes: merged });
  }
  console.log(`[Customers] Quotes gather for "${entity.name}": ${added} new quote(s)`);
  return { added };
}

export async function runInsightsSynthesisForFacet(
  organizationId: string,
  product: Product,
  facetId: string,
  pool: EvidenceItem[],
): Promise<{ personasProposed: number }> {
  const facet = await storage.getSegmentFacetById(facetId);
  if (!facet) return { personasProposed: 0 };
  const entity = await storage.getSegmentEntityById(facet.segmentEntityId);
  if (!entity) return { personasProposed: 0 };

  const output = await synthesiseSegmentInsights(entity.name, entity.description, product.name, pool, organizationId);
  if (!output) return { personasProposed: 0 };

  // §3.3 layer 3 second half: verify every cited ref against the ledger.
  const allRefs: EvidenceRef[] = [];
  const gather = (refs?: EvidenceRef[]) => { if (refs) allRefs.push(...refs); };
  for (const p of output.personas) { gather(p.evidenceRefs); p.goals.forEach(g => gather(g.evidenceRefs)); p.painPoints.forEach(g => gather(g.evidenceRefs)); }
  output.needs.forEach(n => gather(n.evidenceRefs));
  if (output.jobsToBeDone) {
    gather(output.jobsToBeDone.coreJob?.evidenceRefs ?? undefined);
    for (const list of [output.jobsToBeDone.functionalJobs, output.jobsToBeDone.emotionalJobs, output.jobsToBeDone.socialJobs, output.jobsToBeDone.desiredOutcomes]) {
      list.forEach(j => gather(j.evidenceRefs));
    }
  }
  gather(output.segmentInsights?.evidenceRefs ?? undefined);

  const invalid = findInvalidEvidenceRefs(allRefs, pool);
  if (invalid.length > 0) {
    throw new Error(`Customer insights output cited ${invalid.length} evidence ref(s) not present in the ledger — rejected, nothing stored`);
  }

  // Facet enrichment data (agent maintenance of tracked context — ungated):
  const entryIds = allRefs.filter((r): r is Extract<EvidenceRef, { kind: "feedback_entry" }> => r.kind === "feedback_entry").map(r => r.id);
  const entriesById = new Map((await storage.getFeedbackEntriesByIds(entryIds)).map(e => [e.id, e]));
  await storage.updateSegmentFacet(facet.id, {
    needsSummary: output.needsSummary ?? undefined,
    needs: output.needs.length > 0 ? output.needs : undefined,
    jobsToBeDone: output.jobsToBeDone ?? undefined,
    segmentInsights: output.segmentInsights?.text ?? undefined,
    // §3.4: computed from cited feedback sentiment, never estimated.
    overallSatisfaction: computeOverallSatisfaction(allRefs, entriesById) ?? undefined,
  });

  // Personas: the most context-shaping objects — PROPOSED facets (§7), with
  // the ≥2-distinct-sources check enforced here (the schema enforces ≥3 refs).
  let personasProposed = 0;
  for (const proposal of output.personas) {
    if (distinctSourcesForRefs(proposal.evidenceRefs, pool) < EVIDENCE_THRESHOLDS.personaDistinctSources) {
      console.warn(`[Customers] Persona "${proposal.title}" rejected: fewer than ${EVIDENCE_THRESHOLDS.personaDistinctSources} distinct sources cited`);
      continue;
    }
    await createAgentPersonaProposal(facet.productId, entity.id, proposal);
    personasProposed++;
  }

  return { personasProposed };
}

/** Agent-proposed persona: identity + PROPOSED facet for this product (§7). */
export async function createAgentPersonaProposal(
  productId: string,
  segmentEntityId: string,
  proposal: PersonaProposal,
): Promise<{ persona: Persona; facet: PersonaFacet }> {
  // Adopt an existing persona identity when the title matches (per-facet gate:
  // attaching an existing persona to another product is a new proposed facet).
  const existing = (await storage.getPersonasBySegmentEntity(segmentEntityId))
    .find(p => p.title.toLowerCase().trim() === proposal.title.toLowerCase().trim());
  const persona = existing ?? await storage.createPersona({
    segmentEntityId,
    title: proposal.title,
    description: proposal.description ?? null,
    demographics: proposal.demographics ?? null,
    behaviours: proposal.behaviours,
    provenance: "agent",
  });

  const existingFacet = await storage.getPersonaFacet(persona.id, productId);
  if (existingFacet) {
    // Merge, don't replace on the existing facet's claim arrays.
    const mergeClaims = (prior: unknown, incoming: Array<{ text: string; evidenceRefs: EvidenceRef[] }>) => {
      const existingClaims = (prior as Array<{ text?: string }> | null) ?? [];
      const keys = new Set(existingClaims.map(c => (c.text || "").toLowerCase().trim()));
      const merged = [...existingClaims];
      for (const claim of incoming) {
        if (!keys.has(claim.text.toLowerCase().trim())) merged.push(claim);
      }
      return merged;
    };
    const updated = await storage.updatePersonaFacet(existingFacet.id, {
      goals: mergeClaims(existingFacet.goals, proposal.goals),
      painPoints: mergeClaims(existingFacet.painPoints, proposal.painPoints),
      jobsToBeDone: proposal.jobsToBeDone ?? existingFacet.jobsToBeDone,
    });
    return { persona, facet: updated };
  }

  const facet = await storage.createPersonaFacet({
    personaId: persona.id,
    productId,
    status: "proposed",
    provenance: "agent",
    goals: proposal.goals,
    painPoints: proposal.painPoints,
    jobsToBeDone: proposal.jobsToBeDone ?? null,
  });
  return { persona, facet };
}

// ── Active-run detection (competitors runs/active pattern) ──────────────────

const CUSTOMER_RUN_KINDS: Record<string, { kind: "collect" | "aggregate" | "enrich"; agentLabel: string }> = {
  [AgentSlugs.GATHER_FEEDBACK]: { kind: "collect", agentLabel: "Feedback collection" },
  [AgentSlugs.THEME_AGGREGATION]: { kind: "aggregate", agentLabel: "Theme maintenance" },
  [AgentSlugs.CUSTOMER_QUOTES]: { kind: "enrich", agentLabel: "Customer voice gathering" },
  [AgentSlugs.CUSTOMER_INSIGHTS]: { kind: "enrich", agentLabel: "Segment synthesis" },
};

const CUSTOMER_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours, matching competitors

export interface ActiveCustomerRun {
  kind: "collect" | "aggregate" | "enrich";
  /** The segment facet id for enrich runs; absent for product-wide runs. */
  targetId: string | null;
  agentLabel: string;
  startedAt: string | null;
}

/**
 * The single most-recent live customers run for this product — how the client
 * settles the three 202s (collect / aggregate / enrich) instead of watching
 * side-effects. Mirrors findActiveExecutionForCompetitor exactly: recent
 * execution rows, `running` status, 2-hour stale threshold.
 */
export async function findActiveCustomerRun(productId: string): Promise<ActiveCustomerRun | null> {
  const { getAiAgentExecutionsByProduct } = await import("../../lib/agents/executions.js");
  const executions = await getAiAgentExecutionsByProduct(productId, 20);
  const staleThreshold = new Date(Date.now() - CUSTOMER_STALE_THRESHOLD_MS);
  const running = executions.filter(
    e => e.status === "running" && e.startedAt != null && e.startedAt > staleThreshold,
  );
  for (const execution of running) {
    const mapping = execution.agentSlug ? CUSTOMER_RUN_KINDS[execution.agentSlug] : undefined;
    if (!mapping) continue;
    let targetId: string | null = null;
    const params = execution.inputParameters;
    if (params && typeof params === "object" && !Array.isArray(params)) {
      const rawId = (params as Record<string, unknown>)["facetId"];
      targetId = typeof rawId === "string" ? rawId : null;
    }
    return {
      kind: mapping.kind,
      targetId,
      agentLabel: mapping.agentLabel,
      startedAt: execution.startedAt ? new Date(execution.startedAt).toISOString() : null,
    };
  }
  return null;
}

// ── Scheduled bodies (product-kind registrations, §9) ───────────────────────

/** customer-quotes-agent scheduled body: iterate the product's tracked facets. */
export async function runSegmentQuotesForProduct(organizationId: string, product: Product): Promise<{ facets: number }> {
  const joined = await storage.getSegmentFacetsWithEntitiesByProduct(product.id);
  const tracked = joined.filter(j => j.facet.status === "tracked");
  for (const { facet } of tracked) {
    try {
      await runQuotesGatherForFacet(organizationId, product, facet.id);
    } catch (err) {
      console.error(`[Customers] Scheduled quotes gather failed for facet ${facet.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { facets: tracked.length };
}

/**
 * customer-insights-agent scheduled body — §3.3 layer 1: the target list
 * contains ONLY facets passing the evidence threshold. Below threshold the
 * agent simply has no target; no fake execution rows are written. (The SaaS
 * gap-fill scheduler that mass-enriched EMPTY profiles has no successor —
 * this is its inverse.)
 */
export async function runSegmentInsightsForProduct(organizationId: string, product: Product): Promise<{ targets: number; skipped: number }> {
  const joined = await storage.getSegmentFacetsWithEntitiesByProduct(product.id);
  let targets = 0;
  let skipped = 0;
  for (const { facet, entity } of joined.filter(j => j.facet.status === "tracked")) {
    const { items, status } = await collectSegmentEvidence(product.id, facet);
    if (!status.sufficientFor.includes("personas") && !status.sufficientFor.includes("insights")) {
      skipped++;
      continue;
    }
    targets++;
    try {
      await runInsightsSynthesisForFacet(organizationId, product, facet.id, items);
    } catch (err) {
      console.error(`[Customers] Scheduled insights synthesis failed for "${entity.name}":`, err instanceof Error ? err.message : err);
    }
  }
  return { targets, skipped };
}

// ── Feedback collection run (§2, reshaped collectFeedbackForProduct) ────────

export async function runFeedbackCollection(
  organizationId: string,
  product: Product,
): Promise<{ newEntriesCount: number; competitorEntriesCount: number; droppedUntracked: number }> {
  const productName = product.name;
  const now = new Date();

  const feedbackSources = await storage.getFeedbackSourcesByProduct(product.id);
  const reviewComparisonSources = feedbackSources.filter(s => s.type === "review" || s.type === "comparison");
  const trustedFeedbackSources = reviewComparisonSources.map(s => ({ name: s.name, url: s.url }));

  const knownCompetitors = await listTrackedCompetitorNames(product.id);

  let newEntriesCount = 0;
  let competitorEntriesCount = 0;
  let droppedUntracked = 0;

  const productReviews = await fetchProductReviews(
    productName,
    20,
    trustedFeedbackSources.length > 0 ? trustedFeedbackSources : undefined,
    organizationId,
    knownCompetitors,
  );

  // Feature topics in batch
  const reviewsForFeatureExtraction = productReviews.quotes.map(q => ({ text: q.text }));
  const featureMap = await extractFeaturesFromReviews(reviewsForFeatureExtraction, productName, organizationId);

  // Own-product entries (dedup by the ported 100-char prefix key)
  const existingEntries = await storage.getFeedbackEntriesByProduct(product.id, { isCompetitor: false, includeArchived: true });
  const seenKeys = new Set(existingEntries.map(e => (e.quotedText || "").toLowerCase().trim().substring(0, 100)));
  for (const quote of productReviews.quotes) {
    if (!quote.text || quote.text.trim().length < 10) continue;
    const key = quote.text.toLowerCase().trim().substring(0, 100);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const feature = featureMap.get(quote.text.substring(0, 100)) || "General";
    await storage.createFeedbackEntry({
      productId: product.id,
      isCompetitor: false,
      sourceName: quote.source,
      sourceUrl: quote.sourceUrl || null,
      sourceType: quote.sourceType,
      verified: quote.verified || false,
      collectedAt: now,
      topic: feature,
      quotedText: quote.text,
      sentiment: quote.sentiment,
      // Date discipline: authored-at-source or null — never ingestion time.
      sourceCreatedAt: quote.sourceCreatedAt ? new Date(quote.sourceCreatedAt) : null,
    });
    newEntriesCount++;
  }

  // Cross-allocated reviews resolve against COMPETITOR ENTITIES (§2): a match
  // with a tracked facet appends to the entity's reviews and records an entry
  // with competitorEntityId; no tracked entity → drop and log.
  for (const quote of productReviews.crossAllocatedQuotes) {
    const resolved = await resolveTrackedCompetitorForProduct(organizationId, product.id, quote.matchedCompetitor);
    if (!resolved) {
      droppedUntracked++;
      console.log(`[Feedback Collection] Dropped cross-allocated mention of untracked competitor "${quote.matchedCompetitor}" — an untracked competitor must not accumulate context`);
      continue;
    }

    await appendEntityReviews(resolved.entityId, [{
      text: quote.text,
      source: quote.source,
      sourceUrl: quote.sourceUrl,
      sentiment: quote.sentiment,
      verified: quote.verified,
      sourceCreatedAt: quote.sourceCreatedAt,
    }]);

    const key = quote.text.toLowerCase().trim().substring(0, 100);
    const existingCompetitorEntries = await storage.getFeedbackEntriesByProduct(product.id, {
      isCompetitor: true,
      competitorEntityId: resolved.entityId,
      includeArchived: true,
    });
    const competitorKeys = new Set(existingCompetitorEntries.map(e => (e.quotedText || "").toLowerCase().trim().substring(0, 100)));
    if (!competitorKeys.has(key)) {
      await storage.createFeedbackEntry({
        productId: product.id,
        isCompetitor: true,
        competitorEntityId: resolved.entityId,
        sourceName: quote.source,
        sourceUrl: quote.sourceUrl || null,
        sourceType: quote.sourceType,
        verified: quote.verified || false,
        collectedAt: now,
        topic: "General",
        quotedText: quote.text,
        sentiment: quote.sentiment,
        sourceCreatedAt: quote.sourceCreatedAt ? new Date(quote.sourceCreatedAt) : null,
      });
      competitorEntriesCount++;
    }
  }

  // Sentiment pass at run end — a pipeline stage, not a scheduled agent (§9).
  await scoreUnscoredFeedback(product.id, productName, organizationId);

  console.log(`[Feedback Collection] ${productName}: ${newEntriesCount} new entries, ${competitorEntriesCount} competitor entries, ${droppedUntracked} untracked mentions dropped`);
  return { newEntriesCount, competitorEntriesCount, droppedUntracked };
}

export function startFeedbackCollection(
  organizationId: string,
  product: Product,
): { runId: string } {
  const runId = randomUUID();
  trackBackground(
    trackAgentExecution(
      { agentSlug: AgentSlugs.GATHER_FEEDBACK, triggerType: "api", productId: product.id },
      () => runFeedbackCollection(organizationId, product),
    ).catch(err => console.error(`[Feedback Collection] Run ${runId} error:`, err)),
  );
  return { runId };
}

// ── Theme maintenance: the §3.6.1 classify-first run ────────────────────────

const UNFILED_RUN_CAP = 300;
export const THEME_SOFT_CAP = 15;

function themePriority(mentionCount: number): string {
  return mentionCount >= 10 ? "high" : mentionCount >= 5 ? "medium" : "low";
}

/** Recompute a theme's §3.5 stats deterministically from its members. */
async function recomputeThemeStats(theme: FeedbackTheme, entryIds: string[], summaryIfGrew?: string): Promise<void> {
  const entries = await storage.getFeedbackEntriesByIds(entryIds);
  const sentiments = entries.map(e => e.sentiment).filter((s): s is number => typeof s === "number");
  const grew = entryIds.length > ((theme.feedbackEntryIds as string[] | null)?.length ?? 0);
  await storage.updateFeedbackTheme(theme.id, {
    feedbackEntryIds: entryIds,
    mentionCount: entryIds.length,
    averageSentiment: sentiments.length > 0 ? Math.round(sentiments.reduce((a, b) => a + b, 0) / sentiments.length) : theme.averageSentiment,
    priority: themePriority(entryIds.length),
    // The summary describes evidence; refresh only when the theme grew —
    // the NAME is identity and no run path writes it (§3.6.1 step 2).
    ...(grew && summaryIfGrew ? { summary: summaryIfGrew } : {}),
  });
}

export interface ThemeRunResult {
  classified: number;
  created: number;
  convertedToClassification: number;
  leftUnfiled: number;
  pruned: { deleted: number; updated: number };
}

/**
 * §3.6.1 steps 1–6: load catalogue + unfiled → CLASSIFY (batched ≤100) →
 * RESIDUE clustering → CREATION GATE (name+aliases, semantic-vs-catalogue,
 * ≥3 entries, coherence ≥70; soft-cap escalation) → PRUNE. Identity is input,
 * not output.
 */
export async function runThemeAggregation(
  organizationId: string,
  product: Product,
): Promise<ThemeRunResult> {
  const result: ThemeRunResult = { classified: 0, created: 0, convertedToClassification: 0, leftUnfiled: 0, pruned: { deleted: 0, updated: 0 } };

  // 1. LOAD
  const catalogue = await storage.getFeedbackThemesByProduct(product.id);
  const unfiledAll = await storage.getUnfiledFeedbackEntries(product.id);
  const unfiled = unfiledAll.slice(0, UNFILED_RUN_CAP); // newest-first, rotation on later runs

  if (unfiled.length === 0) {
    result.pruned = await pruneOrphanedThemesForProduct(product.id);
    return result;
  }

  const additionsByTheme = new Map<string, Set<string>>();
  let residueEntries = unfiled;

  // 2. CLASSIFY (batched ≤100) — only against a non-empty catalogue.
  if (catalogue.length > 0) {
    const catalogueInput = catalogue.map(t => ({ id: t.id, themeName: t.themeName, summary: t.summary }));
    const stillUnfiled: typeof unfiled = [];
    for (let i = 0; i < unfiled.length; i += 100) {
      const batch = unfiled.slice(i, i + 100);
      const assignments = await classifyEntriesIntoThemes(
        catalogueInput,
        batch.map(e => ({ id: e.id, quotedText: e.quotedText, topic: e.topic })),
        organizationId,
      );
      const byId = new Map(assignments.map(a => [a.entryId, a.themeId]));
      for (const entry of batch) {
        const themeId = byId.get(entry.id) ?? null;
        if (themeId) {
          const set = additionsByTheme.get(themeId) ?? new Set<string>();
          set.add(entry.id);
          additionsByTheme.set(themeId, set);
          result.classified++;
        } else {
          stillUnfiled.push(entry);
        }
      }
    }
    residueEntries = stillUnfiled;

    // Write-set to existing themes: feedbackEntryIds ∪, recomputed stats.
    for (const [themeId, ids] of additionsByTheme) {
      const theme = catalogue.find(t => t.id === themeId)!;
      const union = [...new Set([...((theme.feedbackEntryIds as string[] | null) ?? []), ...ids])];
      await recomputeThemeStats(theme, union);
    }
  }

  // 3. RESIDUE clustering — "leave entries unassigned rather than force".
  let candidates: ResidueThemeCandidate[] = [];
  if (residueEntries.length > 0) {
    candidates = await clusterResidueEntries(
      residueEntries.map(e => ({ id: e.id, quotedText: e.quotedText, topic: e.topic, sentiment: e.sentiment, sourceName: e.sourceName })),
      product.name,
      organizationId,
    );
  }

  // 4. CREATION GATE — in order (a) → (d); soft cap raises the bar (step 5).
  const freshCatalogue = await storage.getFeedbackThemesByProduct(product.id);
  const activeCount = freshCatalogue.filter(t => t.status !== "dismissed").length;
  const softCapActive = activeCount >= THEME_SOFT_CAP;
  const minEntries = softCapActive ? 5 : EVIDENCE_THRESHOLDS.theme;
  const minCoherence = softCapActive ? 85 : EVIDENCE_THRESHOLDS.themeCoherence;

  // (a) name-normalised dedup at creation (names + ALIASES)
  const survivingCandidates: ResidueThemeCandidate[] = [];
  for (const candidate of candidates) {
    const matchId = findThemeByNameOrAlias(candidate.themeName, freshCatalogue);
    if (matchId) {
      const theme = (await storage.getFeedbackThemeById(matchId))!;
      const union = [...new Set([...((theme.feedbackEntryIds as string[] | null) ?? []), ...candidate.feedbackEntryIds])];
      await recomputeThemeStats(theme, union, candidate.summary);
      result.convertedToClassification++;
      result.classified += candidate.feedbackEntryIds.length;
    } else {
      survivingCandidates.push(candidate);
    }
  }

  // (b) semantic dedup at creation, against the STORED set
  let gated = survivingCandidates;
  if (survivingCandidates.length > 0) {
    const verdicts = await semanticCreationGate(
      survivingCandidates,
      freshCatalogue.map(t => ({ id: t.id, themeName: t.themeName, aliases: t.aliases, summary: t.summary })),
      organizationId,
    );
    const drop = new Set<number>();
    for (const verdict of verdicts.verdicts) {
      const candidate = survivingCandidates[verdict.candidateIndex];
      if (!candidate || drop.has(verdict.candidateIndex)) continue;
      if (verdict.matchesExistingThemeId) {
        const theme = await storage.getFeedbackThemeById(verdict.matchesExistingThemeId);
        if (theme) {
          const union = [...new Set([...((theme.feedbackEntryIds as string[] | null) ?? []), ...candidate.feedbackEntryIds])];
          await recomputeThemeStats(theme, union, candidate.summary);
          result.convertedToClassification++;
          result.classified += candidate.feedbackEntryIds.length;
          drop.add(verdict.candidateIndex);
        }
      } else if (verdict.duplicateOfCandidateIndex !== null && verdict.duplicateOfCandidateIndex !== verdict.candidateIndex) {
        const target = survivingCandidates[verdict.duplicateOfCandidateIndex];
        if (target && !drop.has(verdict.duplicateOfCandidateIndex)) {
          target.feedbackEntryIds = [...new Set([...target.feedbackEntryIds, ...candidate.feedbackEntryIds])];
          drop.add(verdict.candidateIndex);
        }
      }
    }
    gated = survivingCandidates.filter((_, i) => !drop.has(i));
  }

  // (c) threshold + (d) coherence bar — failing leaves entries unfiled, honestly.
  for (const candidate of gated) {
    if (candidate.feedbackEntryIds.length < minEntries) {
      console.log(`[Themes] Candidate "${candidate.themeName}" below entry threshold (${candidate.feedbackEntryIds.length} < ${minEntries}) — entries stay unfiled`);
      continue;
    }
    if (candidate.coherence < minCoherence) {
      console.log(`[Themes] Candidate "${candidate.themeName}" below coherence bar (${candidate.coherence} < ${minCoherence}) — entries stay unfiled`);
      continue;
    }
    const entries = await storage.getFeedbackEntriesByIds(candidate.feedbackEntryIds);
    const sentiments = entries.map(e => e.sentiment).filter((s): s is number => typeof s === "number");
    await storage.createFeedbackTheme({
      productId: product.id,
      themeName: candidate.themeName,
      aliases: [],
      summary: candidate.summary,
      status: "needs_review",
      priority: themePriority(candidate.feedbackEntryIds.length),
      mentionCount: candidate.feedbackEntryIds.length,
      averageSentiment: sentiments.length > 0 ? Math.round(sentiments.reduce((a, b) => a + b, 0) / sentiments.length) : null,
      feedbackEntryIds: candidate.feedbackEntryIds,
      confidence: Math.round(candidate.confidence),
      coherence: Math.round(candidate.coherence),
    });
    result.created++;
  }

  // 6. PRUNE
  result.pruned = await pruneOrphanedThemesForProduct(product.id);

  result.leftUnfiled = (await storage.getUnfiledFeedbackEntries(product.id)).length;
  return result;
}

export function startThemeAggregation(organizationId: string, product: Product): { runId: string } {
  const runId = randomUUID();
  trackBackground(
    trackAgentExecution(
      { agentSlug: AgentSlugs.THEME_AGGREGATION, triggerType: "api", productId: product.id },
      () => runThemeAggregation(organizationId, product),
    ).catch(err => console.error(`[Themes] Run ${runId} error:`, err)),
  );
  return { runId };
}

// ── Human theme operations (§3.6.1 step 7 — identity changes are human-only) ─

/** Human merge: absorb one theme into another; the absorbed NAME becomes an alias. */
export async function mergeThemes(survivor: FeedbackTheme, absorbed: FeedbackTheme): Promise<FeedbackTheme> {
  if (survivor.id === absorbed.id) {
    throw new ConflictError("A theme cannot absorb itself.");
  }
  const union = [...new Set([
    ...((survivor.feedbackEntryIds as string[] | null) ?? []),
    ...((absorbed.feedbackEntryIds as string[] | null) ?? []),
  ])];
  const aliases = [...new Set([
    ...((survivor.aliases as string[] | null) ?? []),
    absorbed.themeName,
    ...((absorbed.aliases as string[] | null) ?? []),
  ])].filter(a => normalizeThemeName(a) !== normalizeThemeName(survivor.themeName));

  const entries = await storage.getFeedbackEntriesByIds(union);
  const sentiments = entries.map(e => e.sentiment).filter((s): s is number => typeof s === "number");
  const updated = await storage.updateFeedbackTheme(survivor.id, {
    feedbackEntryIds: union,
    aliases,
    mentionCount: union.length,
    averageSentiment: sentiments.length > 0 ? Math.round(sentiments.reduce((a, b) => a + b, 0) / sentiments.length) : survivor.averageSentiment,
    priority: themePriority(union.length),
  });
  await storage.deleteFeedbackTheme(absorbed.id);
  return updated;
}
