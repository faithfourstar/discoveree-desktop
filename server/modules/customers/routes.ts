/**
 * Customers API (ADR 004 §6) — product-scoped under /api/products/:productId
 * per ADR 003 §1.1; facet ids are the stable ids. Evidence status is served
 * on every segment payload — absence is honest, never fabricated.
 */
import type { Express, Request } from "express";
import { Router } from "express";
import type {
  CustomerSegmentProfile,
  FeedbackEntry,
  FeedbackTheme,
  Persona,
  PersonaFacet,
  SegmentEntity,
} from "@shared/schema";
import { asyncHandler } from "../../http/asyncHandler.js";
import { BadRequestError, NotFoundError } from "../../http/errors.js";
import { productContext, requireProductFromRequest } from "../../http/productContext.js";
import { getProductsByOrganization } from "../products/storage.js";
import {
  createFeedbackBodySchema,
  createFeedbackSourceBodySchema,
  createPersonaBodySchema,
  createSegmentBodySchema,
  mergeThemeBodySchema,
  patchFeedbackBodySchema,
  patchPersonaBodySchema,
  patchSegmentBodySchema,
  patchThemeBodySchema,
} from "./schemas.js";
import { sanitizeSourceDate } from "../../lib/reviews/search.js";
import * as evidence from "./evidence.js";
import * as service from "./service.js";
import * as storage from "./storage.js";

// ── Serialisation ───────────────────────────────────────────────────────────

interface PersonaWithFacetView {
  id: string; // persona id (org identity)
  facetId: string;
  title: string;
  description: string | null;
  demographics: unknown;
  behaviours: unknown;
  goals: unknown;
  painPoints: unknown;
  jobsToBeDone: unknown;
  facetStatus: string;
  provenance: string;
}

export function toPersonaView(persona: Persona, facet: PersonaFacet): PersonaWithFacetView {
  return {
    id: persona.id,
    facetId: facet.id,
    title: persona.title,
    description: persona.description ?? null,
    demographics: persona.demographics ?? null,
    behaviours: persona.behaviours ?? null,
    goals: facet.goals ?? null,
    painPoints: facet.painPoints ?? null,
    jobsToBeDone: facet.jobsToBeDone ?? null,
    facetStatus: facet.status,
    provenance: facet.provenance,
  };
}

export async function toSegmentCard(
  facet: CustomerSegmentProfile,
  entity: SegmentEntity,
  personaCount: number,
): Promise<Record<string, unknown>> {
  const { status } = await evidence.collectSegmentEvidence(facet.productId, facet);
  return {
    id: facet.id, // facet id — the stable segment id
    entityId: entity.id,
    name: entity.name,
    segmentType: entity.segmentType ?? "customer_segment",
    status: facet.status,
    provenance: facet.provenance,
    isIcp: facet.isIcp ?? false,
    icpFit: facet.icpFit ?? null,
    personaCount,
    evidenceStatus: status,
    enrichmentStatus: facet.enrichmentStatus ?? "pending",
    lastEnrichedAt: facet.lastEnrichedAt ? new Date(facet.lastEnrichedAt).toISOString() : null,
  };
}

export function toFeedbackView(entry: FeedbackEntry): Record<string, unknown> {
  return {
    id: entry.id,
    isCompetitor: entry.isCompetitor,
    competitorEntityId: entry.competitorEntityId ?? null,
    sourceName: entry.sourceName,
    sourceUrl: entry.sourceUrl ?? null,
    sourceType: entry.sourceType,
    verified: entry.verified,
    topic: entry.topic ?? null,
    quotedText: entry.quotedText,
    sentiment: entry.sentiment ?? null,
    reviewerName: entry.reviewerName ?? null,
    collectedAt: entry.collectedAt ? new Date(entry.collectedAt).toISOString() : null,
    // Date discipline: the client renders authored-at honestly; null = undated.
    sourceCreatedAt: entry.sourceCreatedAt ? new Date(entry.sourceCreatedAt).toISOString() : null,
    archivedAt: entry.archivedAt ? new Date(entry.archivedAt).toISOString() : null,
  };
}

export function toThemeView(
  theme: FeedbackTheme,
  consolidationSuggested: boolean,
  sourceNameByEntryId: Map<string, string>,
): Record<string, unknown> {
  const entryIds = (theme.feedbackEntryIds as string[] | null) ?? [];
  // §3.5: the surfaced confidence is the COMPUTED pair (count + distinct
  // sources over the member entries), served here so the client never
  // re-derives it lossily from a capped feedback fetch.
  const distinctSources = new Set(
    entryIds
      .map(id => sourceNameByEntryId.get(id)?.toLowerCase().trim())
      .filter((s): s is string => !!s),
  ).size;
  return {
    id: theme.id,
    themeName: theme.themeName,
    aliases: (theme.aliases as string[] | null) ?? [],
    summary: theme.summary ?? null,
    status: theme.status,
    priority: theme.priority ?? null,
    mentionCount: theme.mentionCount,
    averageSentiment: theme.averageSentiment ?? null,
    evidence: { count: entryIds.length, distinctSources },
    confidence: theme.confidence ?? null,
    coherence: theme.coherence ?? null,
    feedbackEntryIds: entryIds,
    consolidationSuggested,
    lastUpdatedAt: theme.lastUpdatedAt ? new Date(theme.lastUpdatedAt).toISOString() : null,
  };
}

/**
 * The SegmentDetail payload (ADR 004 §6.1) — exported so the route and the
 * MCP `get_segment` tool serve ONE projection (ADR 005 §2.2).
 */
export async function buildSegmentDetailPayload(
  productId: string,
  facet: CustomerSegmentProfile,
  entity: SegmentEntity,
): Promise<Record<string, unknown>> {
  const personas = await storage.getPersonasWithFacetsForProduct(entity.id, productId);
  const card = await toSegmentCard(facet, entity, personas.length);
  return {
    ...card,
    description: entity.description ?? null,
    needsSummary: facet.needsSummary ?? null,
    needs: facet.needs ?? [],
    jobsToBeDone: facet.jobsToBeDone ?? null,
    overallSatisfaction: facet.overallSatisfaction ?? null, // computed, §3.4
    csatScore: facet.csatScore ?? null,
    npsScore: facet.npsScore ?? null,
    quotes: facet.quotes ?? [],
    researchItems: facet.researchItems ?? [],
    segmentInsights: facet.segmentInsights ?? null,
    opportunities: facet.opportunities ?? [],
    recommendations: facet.recommendations ?? [],
    personas: personas.map(p => toPersonaView(p.persona, p.facet)),
  };
}

/** Batch-load the member entries' source names for a set of themes. */
export async function sourceNamesForThemes(themes: FeedbackTheme[]): Promise<Map<string, string>> {
  const allIds = [...new Set(themes.flatMap(t => (t.feedbackEntryIds as string[] | null) ?? []))];
  const entries = await storage.getFeedbackEntriesByIds(allIds);
  return new Map(entries.map(e => [e.id, e.sourceName]));
}

// ── Scoping helpers ─────────────────────────────────────────────────────────

async function requireSegment(req: Request, id: string): Promise<{ facet: CustomerSegmentProfile; entity: SegmentEntity }> {
  const product = requireProductFromRequest(req);
  const facet = await storage.getSegmentFacetById(id);
  if (!facet || facet.productId !== product.id) throw new NotFoundError("Segment not found");
  const entity = await storage.getSegmentEntityById(facet.segmentEntityId);
  if (!entity) throw new NotFoundError("Segment not found");
  return { facet, entity };
}

export function registerCustomerRoutes(app: Express): void {
  const router = Router({ mergeParams: true });

  // ── Run status (competitors runs/active pattern) ──────────────────────────
  // The client settles the three 202s (collect / aggregate / enrich) here
  // instead of watching side-effects: single most-recent live run, 2h stale
  // threshold, from the execution-tracking rows the runs already write.
  router.get("/customers/runs/active", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const active = await service.findActiveCustomerRun(product.id);
    if (!active) {
      res.json({ active: false });
      return;
    }
    res.json({
      active: true,
      kind: active.kind,
      ...(active.targetId ? { targetId: active.targetId } : {}),
      agentLabel: active.agentLabel,
      startedAt: active.startedAt,
    });
  }));

  // ── Segments (§6.1) ───────────────────────────────────────────────────────

  router.get("/segments", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const includeProposed = String(req.query["include"] ?? "").split(",").map(v => v.trim()).includes("proposed");
    const joined = await storage.getSegmentFacetsWithEntitiesByProduct(product.id);
    const visible = joined.filter(j => includeProposed || j.facet.status !== "proposed");
    const cards = [];
    for (const { facet, entity } of visible) {
      const personas = await storage.getPersonasWithFacetsForProduct(entity.id, product.id);
      cards.push(await toSegmentCard(facet, entity, personas.length));
    }
    res.json({ segments: cards });
  }));

  router.post("/segments", asyncHandler(async (req, res) => {
    const body = createSegmentBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    // Owner-created: tracked immediately, provenance owner (§7 — data entry of
    // the owner's own assertion; forcing them to accept it is ceremony).
    const { facet, entity, adopted } = await service.addSegment(req.ctx.organizationId, product, {
      name: body.name,
      description: body.description,
      segmentType: body.segmentType,
      provenance: "owner",
    });
    res.status(201).json({ segment: await toSegmentCard(facet, entity, 0), adopted });
  }));

  router.get("/segments/blocked", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const blocked = await storage.getBlockedSegmentsForProduct(product.id);
    res.json({ blocked });
  }));

  router.delete("/segments/blocked/:blockId", asyncHandler(async (req, res) => {
    requireProductFromRequest(req);
    await storage.unblockSegment(Number(req.params["blockId"]));
    res.status(204).end();
  }));

  router.get("/segments/:id", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const { facet, entity } = await requireSegment(req, req.params["id"]!);
    res.json({ segment: await buildSegmentDetailPayload(product.id, facet, entity) });
  }));

  router.patch("/segments/:id", asyncHandler(async (req, res) => {
    const body = patchSegmentBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    let { facet, entity } = await requireSegment(req, req.params["id"]!);

    // name/description/type → entity row; the rest → facet (§6.1)
    const entityUpdate: Record<string, unknown> = {};
    if (body.name !== undefined && body.name !== entity.name) {
      const { normalizeSegmentName } = await import("./normalization.js");
      entityUpdate["name"] = body.name;
      entityUpdate["normalizedName"] = normalizeSegmentName(body.name);
    }
    if (body.description !== undefined) entityUpdate["description"] = body.description;
    if (body.segmentType !== undefined) entityUpdate["segmentType"] = body.segmentType;
    if (Object.keys(entityUpdate).length > 0) {
      entity = await storage.updateSegmentEntity(entity.id, entityUpdate);
    }

    const facetUpdate: Record<string, unknown> = {};
    if (body.icpFit !== undefined) facetUpdate["icpFit"] = body.icpFit;
    if (body.isIcp !== undefined) facetUpdate["isIcp"] = body.isIcp;
    // §3.4: scores are owner-entered only; the "ai" dataSource value does not exist.
    if (body.csatScore !== undefined) { facetUpdate["csatScore"] = body.csatScore; facetUpdate["csatDataSource"] = "user"; }
    if (body.npsScore !== undefined) { facetUpdate["npsScore"] = body.npsScore; facetUpdate["npsDataSource"] = "user"; }
    if (body.needsSummary !== undefined) facetUpdate["needsSummary"] = body.needsSummary;
    if (body.researchItems !== undefined) {
      facetUpdate["researchItems"] = body.researchItems;
      facetUpdate["researchUpdatedAt"] = new Date();
    }
    if (Object.keys(facetUpdate).length > 0) {
      facet = await storage.updateSegmentFacet(facet.id, facetUpdate);
    }

    const personas = await storage.getPersonasWithFacetsForProduct(entity.id, product.id);
    res.json({ segment: await toSegmentCard(facet, entity, personas.length) });
  }));

  router.post("/segments/:id/accept", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const { facet, entity } = await requireSegment(req, req.params["id"]!);
    const updated = facet.status === "proposed"
      ? await storage.updateSegmentFacet(facet.id, { status: "tracked" })
      : facet;
    const personas = await storage.getPersonasWithFacetsForProduct(entity.id, product.id);
    res.json({ segment: await toSegmentCard(updated, entity, personas.length) });
  }));

  router.delete("/segments/:id", asyncHandler(async (req, res) => {
    const { facet, entity } = await requireSegment(req, req.params["id"]!);
    await service.deleteSegmentWithGc(facet, entity);
    res.status(204).end();
  }));

  // §3.3 manual trigger: 202 { runId } | 422 { error, evidenceStatus }
  router.post("/segments/:id/enrich", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const { facet } = await requireSegment(req, req.params["id"]!);
    await service.requireEvidenceForEnrichment(product.id, facet);
    const { runId } = await service.enrichSegment(req.ctx.organizationId, product, facet.id);
    res.status(202).json({ runId });
  }));

  // ── Personas (§6.2) ───────────────────────────────────────────────────────

  router.get("/segments/:id/personas", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const { entity } = await requireSegment(req, req.params["id"]!);
    const personas = await storage.getPersonasWithFacetsForProduct(entity.id, product.id);
    res.json({ personas: personas.map(p => toPersonaView(p.persona, p.facet)) });
  }));

  router.post("/segments/:id/personas", asyncHandler(async (req, res) => {
    const body = createPersonaBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    const { entity } = await requireSegment(req, req.params["id"]!);
    const { persona, facet } = await service.createOwnerPersona(product.id, entity.id, body);
    res.status(201).json({ persona: toPersonaView(persona, facet) });
  }));

  async function requirePersona(req: Request, personaId: string): Promise<{ persona: Persona; facet: PersonaFacet }> {
    const product = requireProductFromRequest(req);
    const persona = await storage.getPersonaById(personaId);
    if (!persona) throw new NotFoundError("Persona not found");
    const facet = await storage.getPersonaFacet(persona.id, product.id);
    // A persona with no facet for the product is not part of its context.
    if (!facet) throw new NotFoundError("Persona not found");
    return { persona, facet };
  }

  router.patch("/personas/:personaId", asyncHandler(async (req, res) => {
    const body = patchPersonaBodySchema.parse(req.body);
    let { persona, facet } = await requirePersona(req, req.params["personaId"]!);

    // identity fields → personas row; goals/painPoints/JTBD → this product's facet
    const identityUpdate: Record<string, unknown> = {};
    if (body.title !== undefined) identityUpdate["title"] = body.title;
    if (body.description !== undefined) identityUpdate["description"] = body.description;
    if (body.demographics !== undefined) identityUpdate["demographics"] = body.demographics;
    if (body.behaviours !== undefined) identityUpdate["behaviours"] = body.behaviours;
    if (Object.keys(identityUpdate).length > 0) {
      persona = await storage.updatePersona(persona.id, identityUpdate);
    }

    const ownerClaim = (text: string) => ({ text, evidenceRefs: [{ kind: "owner" }] });
    const facetUpdate: Record<string, unknown> = {};
    if (body.goals !== undefined) facetUpdate["goals"] = body.goals.map(ownerClaim);
    if (body.painPoints !== undefined) facetUpdate["painPoints"] = body.painPoints.map(ownerClaim);
    if (body.jobsToBeDone !== undefined) facetUpdate["jobsToBeDone"] = body.jobsToBeDone;
    if (Object.keys(facetUpdate).length > 0) {
      facet = await storage.updatePersonaFacet(facet.id, facetUpdate);
    }

    res.json({ persona: toPersonaView(persona, facet) });
  }));

  router.post("/personas/:personaId/accept", asyncHandler(async (req, res) => {
    const { persona, facet } = await requirePersona(req, req.params["personaId"]!);
    const updated = facet.status === "proposed"
      ? await storage.updatePersonaFacet(facet.id, { status: "tracked" })
      : facet;
    res.json({ persona: toPersonaView(persona, updated) });
  }));

  router.delete("/personas/:personaId", asyncHandler(async (req, res) => {
    const { persona, facet } = await requirePersona(req, req.params["personaId"]!);
    await service.deletePersonaFacetWithGc(persona, facet);
    res.status(204).end();
  }));

  // ── Feedback (§6.3) ───────────────────────────────────────────────────────

  router.get("/feedback", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query["offset"] ?? "0"), 10) || 0, 0);
    const options: Parameters<typeof storage.getFeedbackEntriesByProduct>[1] = { limit, offset };
    if (req.query["isCompetitor"] !== undefined) options.isCompetitor = String(req.query["isCompetitor"]) === "true";
    if (req.query["topic"]) options.topic = String(req.query["topic"]);
    if (String(req.query["archived"] ?? "") === "true") options.includeArchived = true;

    let entries = await storage.getFeedbackEntriesByProduct(product.id, options);
    if (String(req.query["unfiled"] ?? "") === "true") {
      const unfiled = new Set((await storage.getUnfiledFeedbackEntries(product.id)).map(e => e.id));
      entries = entries.filter(e => unfiled.has(e.id));
    }
    res.json({ feedback: entries.map(toFeedbackView) });
  }));

  // DIRECT-ADD, no gate (§7): observations, not vocabulary; provenance owner.
  router.post("/feedback", asyncHandler(async (req, res) => {
    const body = createFeedbackBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    const now = new Date();
    // Date discipline: explicit authored-at date when given (sanity-checked);
    // otherwise entry time approximates occurrence for owner entries.
    let sourceCreatedAt: Date | null = now;
    if (body.sourceCreatedAt !== undefined) {
      const sanitised = sanitizeSourceDate(body.sourceCreatedAt, "manual feedback");
      if (!sanitised) {
        throw new BadRequestError("The provided date could not be understood. Use an ISO date such as 2026-05-14.");
      }
      sourceCreatedAt = sanitised;
    }
    const entry = await storage.createFeedbackEntry({
      productId: product.id,
      // Crossover ruling: ABOUT-the-competitor only when explicitly flagged;
      // a competitorEntityId reference alone is own-product feedback with a
      // competitor chip (cross-allocation mining sets true on its own path).
      isCompetitor: body.isCompetitor ?? false,
      competitorEntityId: body.competitorEntityId ?? null,
      sourceName: body.sourceName ?? "Manual",
      sourceType: "manual",
      verified: true,
      collectedAt: now,
      sourceCreatedAt,
      topic: body.topic ?? null,
      quotedText: body.quotedText,
      sentiment: body.sentiment ?? null,
      reviewerName: body.reviewerName ?? null,
    });
    res.status(201).json({ feedback: toFeedbackView(entry) });
  }));

  router.patch("/feedback/:entryId", asyncHandler(async (req, res) => {
    const body = patchFeedbackBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    const entry = await storage.getFeedbackEntryById(req.params["entryId"]!);
    if (!entry || entry.productId !== product.id) throw new NotFoundError("Feedback entry not found");

    const update: Record<string, unknown> = {};
    if (body.topic !== undefined) update["topic"] = body.topic;
    if (body.sentiment !== undefined) update["sentiment"] = body.sentiment;
    if (body.archived !== undefined) update["archivedAt"] = body.archived ? new Date() : null;
    const updated = await storage.updateFeedbackEntry(entry.id, update);
    res.json({ feedback: toFeedbackView(updated) });
  }));

  router.delete("/feedback/:entryId", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const entry = await storage.getFeedbackEntryById(req.params["entryId"]!);
    if (!entry || entry.productId !== product.id) throw new NotFoundError("Feedback entry not found");
    await storage.deleteFeedbackEntry(entry.id);
    res.status(204).end();
  }));

  router.post("/feedback/collect", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const { runId } = service.startFeedbackCollection(req.ctx.organizationId, product);
    res.status(202).json({ runId });
  }));

  // ── Themes (§6.3) ─────────────────────────────────────────────────────────

  router.get("/themes", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const themes = await storage.getFeedbackThemesByProduct(product.id);
    const unfiledCount = (await storage.getUnfiledFeedbackEntries(product.id)).length;
    const consolidationSuggested = themes.filter(t => t.status !== "dismissed").length >= service.THEME_SOFT_CAP;
    const sourceNames = await sourceNamesForThemes(themes);
    res.json({
      themes: themes.map(t => toThemeView(t, consolidationSuggested, sourceNames)),
      unfiledCount,
    });
  }));

  // Human-only identity operations (§3.6.1 step 7): rename + status triage.
  router.patch("/themes/:themeId", asyncHandler(async (req, res) => {
    const body = patchThemeBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    const theme = await storage.getFeedbackThemeById(req.params["themeId"]!);
    if (!theme || theme.productId !== product.id) throw new NotFoundError("Theme not found");

    const update: Record<string, unknown> = {};
    if (body.status !== undefined) update["status"] = body.status;
    if (body.themeName !== undefined && body.themeName !== theme.themeName) {
      // Human rename records the old name as an alias — matching vocabulary forever.
      const aliases = [...new Set([...((theme.aliases as string[] | null) ?? []), theme.themeName])];
      update["themeName"] = body.themeName;
      update["aliases"] = aliases;
    }
    const updated = await storage.updateFeedbackTheme(theme.id, update);
    res.json({ theme: toThemeView(updated, false, await sourceNamesForThemes([updated])) });
  }));

  router.post("/themes/:themeId/merge", asyncHandler(async (req, res) => {
    const body = mergeThemeBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    const survivor = await storage.getFeedbackThemeById(req.params["themeId"]!);
    const absorbed = await storage.getFeedbackThemeById(body.absorbThemeId);
    if (!survivor || survivor.productId !== product.id) throw new NotFoundError("Theme not found");
    if (!absorbed || absorbed.productId !== product.id) throw new NotFoundError("Theme to absorb not found");
    const merged = await service.mergeThemes(survivor, absorbed);
    res.json({ theme: toThemeView(merged, false, await sourceNamesForThemes([merged])) });
  }));

  router.post("/themes/aggregate", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const { runId } = service.startThemeAggregation(req.ctx.organizationId, product);
    res.status(202).json({ runId });
  }));

  // ── Feedback sources (§6.3, manual CRUD) ──────────────────────────────────

  router.get("/feedback-sources", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const sources = await storage.getFeedbackSourcesByProduct(product.id);
    res.json({ sources });
  }));

  router.post("/feedback-sources", asyncHandler(async (req, res) => {
    const body = createFeedbackSourceBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    const source = await storage.createFeedbackSource({
      organizationId: req.ctx.organizationId,
      productId: product.id,
      name: body.name,
      url: body.url,
      type: body.type,
      isManual: true,
    });
    res.status(201).json({ source });
  }));

  router.delete("/feedback-sources/:sourceId", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const source = await storage.getFeedbackSourceById(req.params["sourceId"]!);
    if (!source || source.productId !== product.id) throw new NotFoundError("Feedback source not found");
    await storage.deleteFeedbackSource(source.id);
    res.status(204).end();
  }));

  app.use("/api/products/:productId", productContext, router);

  // ── Org vocabulary view (§6.1, mirrors /entities/competitors) ─────────────
  const entityRouter = Router();
  entityRouter.get("/entities/segments", asyncHandler(async (req, res) => {
    const entities = await storage.getSegmentEntitiesByOrganization(req.ctx.organizationId);
    const products = await getProductsByOrganization(req.ctx.organizationId);
    const productNames = new Map(products.map(p => [p.id, p.name]));
    const views = [];
    for (const entity of entities) {
      const facets = await storage.getSegmentFacetsByEntity(entity.id);
      views.push({
        id: entity.id,
        name: entity.name,
        segmentType: entity.segmentType ?? "customer_segment",
        description: entity.description ?? null,
        facets: facets.map(f => ({
          id: f.id,
          productId: f.productId,
          productName: productNames.get(f.productId) ?? null,
          status: f.status,
          provenance: f.provenance,
        })),
      });
    }
    res.json({ entities: views });
  }));
  app.use("/api", entityRouter);
}
