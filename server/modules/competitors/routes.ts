/**
 * Competitors API (ADR 002 §6, rebased by ADR 003).
 *
 * Product-scoped surface under /api/products/:productId (§1.1) — the
 * productContext middleware resolves the product; handlers read req.ctx /
 * req.product and never call products[0]. The stable competitor id remains
 * the FACET id (§2.5); cards carry entityId plus resolved lineage. Org-level
 * entity reads live under /api/entities/competitors.
 *
 * Shapes align with client/src/mock/types.ts where the mock is right; two
 * classifications only, and provenance-carrying keyDifferentiators (risk 6
 * ruling — no invented theyBeatYouOn/youBeatThemOn data).
 */
import type { Express, Request } from "express";
import { Router } from "express";
import type { CompetitorEntity, CompetitorProfile } from "@shared/schema";
import { asyncHandler } from "../../http/asyncHandler.js";
import { ConflictWithPayloadError, NotFoundError } from "../../http/errors.js";
import { productContext, requireProductFromRequest } from "../../http/productContext.js";
import { getProductsByOrganization } from "../products/storage.js";
import {
  classificationToSourceCategory,
  createCompetitorBodySchema,
  patchCompetitorBodySchema,
  sourceCategoryToClassification,
} from "./schemas.js";
import * as service from "./service.js";
import * as storage from "./storage.js";
import type { FacetWithEntity, ProductChangeRow } from "./storage.js";

// ── Serialisation ───────────────────────────────────────────────────────────

export interface CompetitorCardEntityRef {
  id: string;
  name: string;
  /** The company root when this competitor is one of a company's sub-branded products (§2.9). */
  parent: { id: string; name: string } | null;
}

export interface CompetitorCard {
  /** The FACET id — the stable competitor id on this surface (§2.5). */
  id: string;
  entityId: string;
  name: string;
  /** Lifecycle (spec 2.4 review-before-save gate): proposed rows await accept. */
  status: "proposed" | "tracked";
  classification: "DIRECT" | "ADJACENT";
  domain: string | null;
  summary: string | null;
  threatLevel: "none" | "watch" | "competitive" | "big_threat";
  enrichmentStatus: "pending" | "enriching" | "completed" | "failed";
  lastVerifiedAt: string | null;
  sentiment: number | null;
  reviewCount: number | null;
  entity: CompetitorCardEntityRef;
  /**
   * Products (other than this one) holding a TRACKED facet on the same entity
   * node — the adoption signal ("Already researched for [Product A]") and the
   * cross-product "also tracked by …" link (§2.5). Client contract field.
   */
  alsoTrackedBy: Array<{ productId: string; productName: string }>;
}

export function toCompetitorCard(
  joined: FacetWithEntity,
  alsoTrackedBy: Array<{ productId: string; productName: string }> = [],
): CompetitorCard {
  const { profile, entity, parent } = joined;
  // Child→root fact fallback (§2.9.2): a child node inherits company facts it
  // doesn't carry itself.
  const facts = service.entityFactsWithFallback(entity, parent);
  return {
    id: profile.id,
    entityId: entity.id,
    name: entity.name,
    status: profile.status === "proposed" ? "proposed" : "tracked",
    classification: sourceCategoryToClassification(profile.sourceCategory),
    domain: facts.domain ?? service.extractDomain(facts.url),
    summary: facts.description ?? null,
    threatLevel: (profile.threatLevel ?? "none") as CompetitorCard["threatLevel"],
    enrichmentStatus: (profile.enrichmentStatus ?? "pending") as CompetitorCard["enrichmentStatus"],
    // ISO only — the client renders "verified 2h ago"; never format dates server-side.
    lastVerifiedAt: profile.lastEnrichedAt ? new Date(profile.lastEnrichedAt).toISOString() : null,
    // Null until the reviews sprint — the client block stays unrendered (§6).
    sentiment: null,
    reviewCount: facts.reviewTotalCount ?? null,
    entity: {
      id: entity.id,
      name: entity.name,
      parent: parent ? { id: parent.id, name: parent.name } : null,
    },
    alsoTrackedBy,
  };
}

/**
 * Batch-resolve the alsoTrackedBy contract field: for each entity, the OTHER
 * products of the org holding a tracked facet on it.
 */
async function alsoTrackedByForEntities(
  organizationId: string,
  entityIds: string[],
  excludeProductId: string,
): Promise<Map<string, Array<{ productId: string; productName: string }>>> {
  const map = new Map<string, Array<{ productId: string; productName: string }>>();
  if (entityIds.length === 0) return map;
  const facets = await storage.getCompetitorProfilesByEntities(entityIds);
  const products = await getProductsByOrganization(organizationId);
  const productNames = new Map(products.map(p => [p.id, p.name]));
  for (const facet of facets) {
    if (facet.productId === excludeProductId) continue;
    if (facet.status !== "tracked") continue;
    const list = map.get(facet.entityId) ?? [];
    list.push({ productId: facet.productId, productName: productNames.get(facet.productId) ?? "" });
    map.set(facet.entityId, list);
  }
  return map;
}

/**
 * Resolve the provenance URL for a differentiator bullet: a trailing [n]
 * citation marker maps to summaryCitations[n-1]; otherwise fall back to the
 * summary's own source URL. Exported for tests.
 */
export function resolveCitationUrl(
  text: string,
  citations: string[] | null | undefined,
  fallback: string | null,
): string | null {
  const match = text.match(/\[(\d+)\]/);
  if (match && citations && citations.length > 0) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < citations.length) {
      return citations[index] ?? fallback;
    }
  }
  return fallback;
}

interface ChangeView {
  id: string;
  entityId: string;
  changeType: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  detectedAt: string;
}

function toChange(change: { id: string; entityId: string; changeType: string; changeTitle: string; changeDescription: string | null; sourceUrl: string | null; detectedAt: Date | null }): ChangeView {
  return {
    id: change.id,
    entityId: change.entityId,
    changeType: change.changeType,
    title: change.changeTitle,
    description: change.changeDescription ?? "",
    sourceUrl: change.sourceUrl ?? null,
    detectedAt: change.detectedAt ? new Date(change.detectedAt).toISOString() : new Date(0).toISOString(),
  };
}

// ── Scoping helpers ─────────────────────────────────────────────────────────

async function requireFacet(req: Request, id: string): Promise<FacetWithEntity> {
  const product = requireProductFromRequest(req);
  const joined = await storage.getFacetWithEntityById(id);
  if (!joined || joined.profile.productId !== product.id) {
    throw new NotFoundError("Competitor not found");
  }
  return joined;
}

// ── Product-scoped routes (/api/products/:productId/...) ────────────────────

export function registerCompetitorRoutes(app: Express): void {
  const router = Router({ mergeParams: true });

  // GET .../competitors → { competitors: CompetitorCard[] }
  // Tracked rows only by default; ?include=proposed adds proposed rows (each
  // card carries its status so the client can distinguish) — spec 2.4 gate.
  router.get("/competitors", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const includeProposed = String(req.query["include"] ?? "")
      .split(",")
      .map(v => v.trim())
      .includes("proposed");
    const joined = await storage.getFacetsWithEntitiesByProduct(product.id);
    const visible = joined
      .filter(j => j.profile.sourceCategory !== "own_product")
      .filter(j => includeProposed || j.profile.status !== "proposed");
    const alsoTracked = await alsoTrackedByForEntities(
      req.ctx.organizationId,
      visible.map(j => j.entity.id),
      product.id,
    );
    res.json({
      competitors: visible.map(j => toCompetitorCard(j, alsoTracked.get(j.entity.id) ?? [])),
    });
  }));

  // POST .../competitors → 201 { competitor, adopted }
  // The dedup/adoption flow (§2.3): an entity that already exists in the org
  // is ADOPTED — the proposal card renders its researched profile instantly
  // and only facet-scoped enrichment runs. A new name creates entity + facet;
  // both enrichment scopes run in the background.
  router.post("/competitors", asyncHandler(async (req, res) => {
    const body = createCompetitorBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);

    const { profile, entity, adopted } = await service.addCompetitor(req.ctx.organizationId, product, {
      name: body.name,
      url: body.url,
      classification: body.classification,
    });

    void service.startEnrichment(req.ctx.organizationId, product, profile.id, { facetOnly: adopted });

    const parent = entity.parentEntityId
      ? (await storage.getCompetitorEntityById(entity.parentEntityId)) ?? null
      : null;
    const alsoTracked = await alsoTrackedByForEntities(req.ctx.organizationId, [entity.id], product.id);
    res.status(201).json({
      competitor: toCompetitorCard({ profile, entity, parent }, alsoTracked.get(entity.id) ?? []),
      adopted,
    });
  }));

  // GET .../competitors/runs/active — must register before /competitors/:id
  router.get("/competitors/runs/active", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const active = await service.findActiveExecutionForCompetitor(product.id);
    if (!active) {
      res.json({ active: false });
      return;
    }
    let competitorId: string | null = null;
    if (active.competitorName) {
      const entity = await storage.findCompetitorEntityByNormalizedName(
        req.ctx.organizationId,
        service.normalizeCompetitorName(active.competitorName),
      );
      if (entity) {
        const profile = await storage.getCompetitorProfileByProductAndEntity(product.id, entity.id);
        competitorId = profile?.id ?? null;
      }
    }
    res.json({
      active: true,
      competitorId,
      competitorName: active.competitorName,
      agentLabel: active.agentLabel,
      startedAt: active.startedAt,
    });
  }));

  // GET .../competitors/:id → card + provenance detail + recent changes
  router.get("/competitors/:id", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const joined = await requireFacet(req, req.params["id"]!);
    const { profile, entity, parent } = joined;
    const facts = service.entityFactsWithFallback(entity, parent);
    const alsoTracked = await alsoTrackedByForEntities(req.ctx.organizationId, [entity.id], product.id);

    const citations = (facts.summaryCitations as string[] | null) ?? null;
    const summarySourceUrl = facts.descriptionSourceUrl || null;

    const keyDifferentiators = ((profile.keyDifferentiators as string[] | null) ?? []).map(text => ({
      text,
      sourceUrl: resolveCitationUrl(text, citations, summarySourceUrl),
    }));

    const keyFeatures = ((facts.keyFeatures as Array<{ feature?: string; name?: string; sourceUrl?: string | null }> | null) ?? [])
      .map(f => ({
        feature: f.feature || f.name || "",
        sourceUrl: f.sourceUrl ?? null,
      }))
      .filter(f => f.feature);

    const markets = ((facts.markets as Array<{ market?: string; sourceUrl?: string | null }> | null) ?? [])
      .map(m => ({ market: m.market || "", sourceUrl: m.sourceUrl ?? null }))
      .filter(m => m.market);

    const changes = await storage.getCompetitorChangesByEntity(entity.id, 20);

    res.json({
      competitor: {
        ...toCompetitorCard(joined, alsoTracked.get(entity.id) ?? []),
        keyDifferentiators,
        keyFeatures,
        markets,
        summarySourceUrl,
      },
      changes: changes.map(toChange),
      // DeepDiveThread — strategy sprint; shape reserved per mock/types.ts
      openThread: null,
      filedThreads: [],
    });
  }));

  // POST .../competitors/:id/refresh → 202 { runId } | 409 { error, activeRun }
  router.post("/competitors/:id/refresh", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const { profile, entity } = await requireFacet(req, req.params["id"]!);

    const activeRun = await service.findActiveExecutionForCompetitor(product.id, entity.name);
    if (activeRun) {
      throw new ConflictWithPayloadError(
        "A refresh is already running for this competitor.",
        { activeRun },
      );
    }

    const { runId } = await service.refreshCompetitor(req.ctx.organizationId, product, profile.id);
    res.status(202).json({ runId });
  }));

  // POST .../competitors/:id/accept → 200 { competitor } — spec 2.4 accept.
  // Flips proposed → tracked. Succeeds regardless of enrichmentStatus (a
  // failed enrichment is the save-unverified path); accepting an
  // already-tracked competitor is a no-op 200.
  router.post("/competitors/:id/accept", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const joined = await requireFacet(req, req.params["id"]!);
    const alsoTracked = await alsoTrackedByForEntities(req.ctx.organizationId, [joined.entity.id], product.id);
    const also = alsoTracked.get(joined.entity.id) ?? [];
    if (joined.profile.status === "proposed") {
      const updated = await storage.updateCompetitorProfile(joined.profile.id, { status: "tracked" });
      res.json({ competitor: toCompetitorCard({ ...joined, profile: updated }, also) });
      return;
    }
    res.json({ competitor: toCompetitorCard(joined, also) });
  }));

  // DELETE .../competitors/:id → 204
  // Facet delete + tree-aware entity GC (§2.3): the last facet on a tree
  // takes the tree and its change rows with it — for a discarded proposal
  // this is "a proposal that was never accepted leaves no history"; when
  // other facets exist anywhere on the tree, only this facet goes.
  router.delete("/competitors/:id", asyncHandler(async (req, res) => {
    const { profile } = await requireFacet(req, req.params["id"]!);
    await service.deleteFacetWithGc(profile);
    res.status(204).end();
  }));

  // PATCH .../competitors/:id { name?, classification?, threatLevel?, url? }
  router.patch("/competitors/:id", asyncHandler(async (req, res) => {
    const body = patchCompetitorBodySchema.parse(req.body);
    const product = requireProductFromRequest(req);
    const found = await requireFacet(req, req.params["id"]!);
    let { profile, entity } = found;

    // Rename is an ENTITY-row update (§2.4): change history is FK'd, so the
    // sprint-2 "tracked competitors cannot be renamed" restriction is lifted.
    // Collision rule is org-wide (the entity dedup key), 409 like POST.
    if (body.name !== undefined && body.name !== entity.name) {
      entity = await service.renameCompetitor(req.ctx.organizationId, entity, body.name);
    }

    // url is an entity fact (identity); classification/threat are facet data.
    if (body.url !== undefined) {
      entity = await storage.updateCompetitorEntity(entity.id, {
        url: body.url,
        urlSource: "manual",
        domain: service.extractDomain(body.url),
      });
    }

    const update: Record<string, unknown> = {};
    if (body.classification !== undefined) {
      update["sourceCategory"] = classificationToSourceCategory(body.classification);
    }

    if (body.threatLevel !== undefined) {
      const previousLevel = profile.threatLevel || "none";
      update["threatLevel"] = body.threatLevel;
      // Record history if the threat level changed (routes.ts:8885 port)
      if (previousLevel !== body.threatLevel) {
        await storage.createCompetitorThreatLevelHistory({
          productId: product.id,
          competitorProfileId: profile.id,
          competitorName: entity.name,
          previousLevel,
          newLevel: body.threatLevel,
        });
      }
    }

    const updated = Object.keys(update).length > 0
      ? await storage.updateCompetitorProfile(profile.id, update)
      : profile;
    const alsoTracked = await alsoTrackedByForEntities(req.ctx.organizationId, [entity.id], product.id);
    res.json({
      competitor: toCompetitorCard(
        { profile: updated, entity, parent: found.parent },
        alsoTracked.get(entity.id) ?? [],
      ),
    });
  }));

  // GET .../changes?limit&offset — product-relevant change feed (§2.4): a
  // join over the product's TRACKED facets. Proposed competitors are excluded
  // by the join predicate, not a name filter.
  router.get("/changes", asyncHandler(async (req, res) => {
    const product = requireProductFromRequest(req);
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "20"), 10) || 20, 1), 100);
    const offset = Math.max(parseInt(String(req.query["offset"] ?? "0"), 10) || 0, 0);
    const daysLimit = parseInt(String(req.query["days"] ?? "30"), 10) || 30;

    const result = await storage.getCompetitorChangesForProductPaginated(product.id, {
      limit,
      offset,
      daysLimit,
    });
    res.json({
      changes: result.changes.map((c: ProductChangeRow) => ({ ...toChange(c), competitorName: c.competitorName })),
      total: result.total,
    });
  }));

  app.use("/api/products/:productId", productContext, router);

  registerEntityRoutes(app);
}

// ── Org-level entity routes (/api/entities/competitors, §1.1/§2.5) ──────────

interface EntityView {
  id: string;
  name: string;
  parentEntityId: string | null;
  url: string | null;
  domain: string | null;
  description: string | null;
  enrichmentStatus: string | null;
  lastEnrichedAt: string | null;
  /** Which products hold facets on this node ("also tracked by …"). */
  facets: Array<{
    id: string;
    productId: string;
    productName: string | null;
    status: string;
    classification: "DIRECT" | "ADJACENT";
    threatLevel: string | null;
  }>;
}

function toEntityView(
  entity: CompetitorEntity,
  facets: CompetitorProfile[],
  productNames: Map<string, string>,
): EntityView {
  return {
    id: entity.id,
    name: entity.name,
    parentEntityId: entity.parentEntityId ?? null,
    url: entity.url ?? null,
    domain: entity.domain ?? null,
    description: entity.description ?? null,
    enrichmentStatus: entity.enrichmentStatus ?? null,
    lastEnrichedAt: entity.lastEnrichedAt ? new Date(entity.lastEnrichedAt).toISOString() : null,
    facets: facets.map(f => ({
      id: f.id,
      productId: f.productId,
      productName: productNames.get(f.productId) ?? null,
      status: f.status,
      classification: sourceCategoryToClassification(f.sourceCategory),
      threatLevel: f.threatLevel ?? null,
    })),
  };
}

function registerEntityRoutes(app: Express): void {
  const router = Router();

  // GET /api/entities/competitors → org-level canonical entity list with
  // per-product facet attribution ("which products track X").
  router.get("/entities/competitors", asyncHandler(async (req, res) => {
    const entities = await storage.getCompetitorEntitiesByOrganization(req.ctx.organizationId);
    const facets = await storage.getCompetitorProfilesByEntities(entities.map(e => e.id));
    const products = await getProductsByOrganization(req.ctx.organizationId);
    const productNames = new Map(products.map(p => [p.id, p.name]));

    const facetsByEntity = new Map<string, CompetitorProfile[]>();
    for (const facet of facets) {
      const list = facetsByEntity.get(facet.entityId) ?? [];
      list.push(facet);
      facetsByEntity.set(facet.entityId, list);
    }

    res.json({
      entities: entities.map(e => toEntityView(e, facetsByEntity.get(e.id) ?? [], productNames)),
    });
  }));

  // GET /api/entities/competitors/:entityId → full entity facts + facets +
  // child nodes (for company roots).
  router.get("/entities/competitors/:entityId", asyncHandler(async (req, res) => {
    const entity = await storage.getCompetitorEntityById(req.params["entityId"]!);
    if (!entity || entity.organizationId !== req.ctx.organizationId) {
      throw new NotFoundError("Competitor entity not found");
    }
    const facets = await storage.getCompetitorProfilesByEntity(entity.id);
    const children = entity.parentEntityId ? [] : await storage.getChildCompetitorEntities(entity.id);
    const products = await getProductsByOrganization(req.ctx.organizationId);
    const productNames = new Map(products.map(p => [p.id, p.name]));

    res.json({
      entity: {
        ...toEntityView(entity, facets, productNames),
        keyFeatures: entity.keyFeatures ?? null,
        markets: entity.markets ?? null,
        summaryCitations: entity.summaryCitations ?? null,
        descriptionSourceUrl: entity.descriptionSourceUrl ?? null,
      },
      children: await Promise.all(children.map(async child =>
        toEntityView(child, await storage.getCompetitorProfilesByEntity(child.id), productNames),
      )),
    });
  }));

  app.use("/api", router);
}
