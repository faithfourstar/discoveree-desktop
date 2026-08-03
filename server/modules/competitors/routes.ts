/**
 * Competitors API (ADR 002 §6). Stable-ID surface: every id is
 * `competitor_profiles.id`, org-scoped via req.ctx (never from the URL).
 * Shapes align with client/src/mock/types.ts where the mock is right;
 * two classifications only, and provenance-carrying keyDifferentiators
 * (risk 6 ruling — no invented theyBeatYouOn/youBeatThemOn data).
 *
 * Handler logic ported from the SaaS routes.ts (line refs in ADR 002 §5),
 * rewritten against profile-canonical ids and req.ctx.
 */
import type { Express } from "express";
import { Router } from "express";
import type { CompetitorChange, CompetitorProfile, Product } from "@shared/schema";
import { asyncHandler } from "../../http/asyncHandler.js";
import { BadRequestError, ConflictError, ConflictWithPayloadError, NotFoundError } from "../../http/errors.js";
import { getProductsByOrganization } from "../products/storage.js";
import {
  classificationToSourceCategory,
  createCompetitorBodySchema,
  patchCompetitorBodySchema,
  sourceCategoryToClassification,
} from "./schemas.js";
import * as service from "./service.js";
import * as storage from "./storage.js";

// ── Serialisation ───────────────────────────────────────────────────────────

export interface CompetitorCard {
  id: string;
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
}

function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function toCompetitorCard(profile: CompetitorProfile): CompetitorCard {
  return {
    id: profile.id,
    name: profile.competitorName,
    status: profile.status === "proposed" ? "proposed" : "tracked",
    classification: sourceCategoryToClassification(profile.sourceCategory),
    domain: domainFromUrl(profile.competitorUrl),
    summary: profile.description ?? null,
    threatLevel: (profile.threatLevel ?? "none") as CompetitorCard["threatLevel"],
    enrichmentStatus: (profile.enrichmentStatus ?? "pending") as CompetitorCard["enrichmentStatus"],
    // ISO only — the client renders "verified 2h ago"; never format dates server-side.
    lastVerifiedAt: profile.lastEnrichedAt ? new Date(profile.lastEnrichedAt).toISOString() : null,
    // Null until the reviews sprint — the client block stays unrendered (§6).
    sentiment: null,
    reviewCount: profile.reviewTotalCount ?? null,
  };
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

function toChange(change: CompetitorChange): {
  id: string;
  changeType: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  detectedAt: string;
} {
  return {
    id: change.id,
    changeType: change.changeType,
    title: change.changeTitle,
    description: change.changeDescription ?? "",
    sourceUrl: change.sourceUrl ?? null,
    detectedAt: change.detectedAt ? new Date(change.detectedAt).toISOString() : new Date(0).toISOString(),
  };
}

// ── Product scoping helpers ─────────────────────────────────────────────────

async function findProduct(organizationId: string): Promise<Product | undefined> {
  const products = await getProductsByOrganization(organizationId);
  return products[0];
}

async function requireProduct(organizationId: string): Promise<Product> {
  const product = await findProduct(organizationId);
  if (!product) {
    throw new ConflictError("No product profile exists yet. Set up your product before adding competitors.");
  }
  return product;
}

async function requireProfile(organizationId: string, id: string): Promise<{ product: Product; profile: CompetitorProfile }> {
  const product = await requireProduct(organizationId);
  const profile = await storage.getCompetitorProfileById(id);
  if (!profile || profile.productId !== product.id) {
    throw new NotFoundError("Competitor not found");
  }
  return { product, profile };
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerCompetitorRoutes(app: Express): void {
  const router = Router();

  // GET /api/competitors → { competitors: CompetitorCard[] }
  // Tracked rows only by default; ?include=proposed adds proposed rows (each
  // card carries its status so the client can distinguish) — spec 2.4 gate.
  router.get("/competitors", asyncHandler(async (req, res) => {
    const product = await findProduct(req.ctx.organizationId);
    if (!product) {
      res.json({ competitors: [] });
      return;
    }
    const includeProposed = String(req.query["include"] ?? "")
      .split(",")
      .map(v => v.trim())
      .includes("proposed");
    const profiles = await storage.getCompetitorProfilesByProduct(product.id);
    const visible = profiles
      .filter(p => p.sourceCategory !== "own_product")
      .filter(p => includeProposed || p.status !== "proposed");
    res.json({ competitors: visible.map(toCompetitorCard) });
  }));

  // POST /api/competitors → 201 { competitor } (enrichment starts in background)
  router.post("/competitors", asyncHandler(async (req, res) => {
    const body = createCompetitorBodySchema.parse(req.body);
    const product = await requireProduct(req.ctx.organizationId);

    // Duplicate name (case-insensitive) → 409 (replaces the SaaS 400)
    const existing = await storage.getCompetitorProfilesByProduct(product.id);
    const isDuplicate = existing.some(
      p => p.competitorName.toLowerCase() === body.name.toLowerCase(),
    );
    if (isDuplicate) {
      throw new ConflictError("A competitor with this name already exists.");
    }

    // Created as a PROPOSAL (spec 2.4): nothing is tracked until the human
    // accepts via POST /:id/accept. Enrichment still runs so the proposal
    // card can show the drafted profile.
    const profile = await storage.upsertCompetitorProfile({
      productId: product.id,
      competitorName: body.name,
      competitorUrl: body.url || null,
      competitorUrlSource: body.url ? "manual" : "ai-discovered",
      sourceCategory: classificationToSourceCategory(body.classification),
      enrichmentStatus: "pending",
      status: "proposed",
    });

    // Enrichment (summary → features) starts in the background.
    void service.startEnrichment(req.ctx.organizationId, product, profile.id);

    res.status(201).json({ competitor: toCompetitorCard(profile) });
  }));

  // GET /api/competitors/runs/active — must register before /competitors/:id
  router.get("/competitors/runs/active", asyncHandler(async (req, res) => {
    const product = await findProduct(req.ctx.organizationId);
    if (!product) {
      res.json({ active: false });
      return;
    }
    const active = await service.findActiveExecutionForCompetitor(product.id);
    if (!active) {
      res.json({ active: false });
      return;
    }
    let competitorId: string | null = null;
    if (active.competitorName) {
      const profile = await storage.getCompetitorProfile(product.id, active.competitorName);
      competitorId = profile?.id ?? null;
    }
    res.json({
      active: true,
      competitorId,
      competitorName: active.competitorName,
      agentLabel: active.agentLabel,
      startedAt: active.startedAt,
    });
  }));

  // GET /api/competitors/:id → card + provenance detail + recent changes
  router.get("/competitors/:id", asyncHandler(async (req, res) => {
    const { product, profile } = await requireProfile(req.ctx.organizationId, req.params["id"]!);

    const citations = (profile.summaryCitations as string[] | null) ?? null;
    const summarySourceUrl = profile.descriptionSourceUrl || null;

    const keyDifferentiators = ((profile.keyDifferentiators as string[] | null) ?? []).map(text => ({
      text,
      sourceUrl: resolveCitationUrl(text, citations, summarySourceUrl),
    }));

    const keyFeatures = ((profile.keyFeatures as Array<{ feature?: string; name?: string; sourceUrl?: string | null }> | null) ?? [])
      .map(f => ({
        feature: f.feature || f.name || "",
        sourceUrl: f.sourceUrl ?? null,
      }))
      .filter(f => f.feature);

    const markets = ((profile.markets as Array<{ market?: string; sourceUrl?: string | null }> | null) ?? [])
      .map(m => ({ market: m.market || "", sourceUrl: m.sourceUrl ?? null }))
      .filter(m => m.market);

    const changes = await storage.getCompetitorChangesByProductAndName(product.id, profile.competitorName, 20);

    res.json({
      competitor: {
        ...toCompetitorCard(profile),
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

  // POST /api/competitors/:id/refresh → 202 { runId } | 409 { error, activeRun }
  router.post("/competitors/:id/refresh", asyncHandler(async (req, res) => {
    const { product, profile } = await requireProfile(req.ctx.organizationId, req.params["id"]!);

    const activeRun = await service.findActiveExecutionForCompetitor(product.id, profile.competitorName);
    if (activeRun) {
      throw new ConflictWithPayloadError(
        "A refresh is already running for this competitor.",
        { activeRun },
      );
    }

    const { runId } = await service.refreshCompetitor(req.ctx.organizationId, product, profile.id);
    res.status(202).json({ runId });
  }));

  // POST /api/competitors/:id/accept → 200 { competitor } — spec 2.4 accept.
  // Flips proposed → tracked. Succeeds regardless of enrichmentStatus (a
  // failed enrichment is the save-unverified path); accepting an
  // already-tracked competitor is a no-op 200.
  router.post("/competitors/:id/accept", asyncHandler(async (req, res) => {
    const { profile } = await requireProfile(req.ctx.organizationId, req.params["id"]!);
    if (profile.status === "proposed") {
      const updated = await storage.updateCompetitorProfile(profile.id, { status: "tracked" });
      res.json({ competitor: toCompetitorCard(updated) });
      return;
    }
    res.json({ competitor: toCompetitorCard(profile) });
  }));

  // DELETE /api/competitors/:id → 204
  router.delete("/competitors/:id", asyncHandler(async (req, res) => {
    const { product, profile } = await requireProfile(req.ctx.organizationId, req.params["id"]!);
    if (profile.status === "proposed") {
      // Discarding a proposal removes it completely (spec 2.4): a proposal
      // that was never accepted leaves no history — draft change rows and any
      // threat-level history go with the row.
      await storage.deleteCompetitorChangesByProductAndName(product.id, profile.competitorName);
      await storage.deleteCompetitorThreatLevelHistoryByProfile(profile.id);
      await storage.deleteCompetitorProfileById(profile.id);
      res.status(204).end();
      return;
    }
    await storage.deleteCompetitorProfileById(profile.id);
    // Change rows are kept for TRACKED competitors: they are observed history,
    // and the feed carries the competitor name for attribution.
    res.status(204).end();
  }));

  // PATCH /api/competitors/:id { name?, classification?, threatLevel?, url? }
  router.patch("/competitors/:id", asyncHandler(async (req, res) => {
    const body = patchCompetitorBodySchema.parse(req.body);
    const found = await requireProfile(req.ctx.organizationId, req.params["id"]!);
    const product = found.product;
    let profile = found.profile;

    // Inline-rename (spec 2.4 proposal card) — allowed ONLY while proposed.
    // Tracked renames are deferred: change history is name-keyed (§9 addendum),
    // so renaming a tracked competitor would orphan its observed history.
    if (body.name !== undefined) {
      if (profile.status !== "proposed") {
        throw new BadRequestError(
          "Renaming is only available while a competitor is still proposed. Tracked competitors cannot be renamed yet.",
        );
      }
      if (body.name !== profile.competitorName) {
        // Collision rules match POST: case-insensitive, 409, excluding self.
        const siblings = await storage.getCompetitorProfilesByProduct(product.id);
        const collides = siblings.some(
          p => p.id !== profile.id && p.competitorName.toLowerCase() === body.name!.toLowerCase(),
        );
        if (collides) {
          throw new ConflictError("A competitor with this name already exists.");
        }
        // Transactional: the draft change rows (name-keyed, no profile FK)
        // must follow the rename or the discard-purge and feed exclusion break.
        profile = await storage.renameCompetitorProfile(
          profile.id,
          product.id,
          profile.competitorName,
          body.name,
        );
      }
    }

    const update: Record<string, unknown> = {};

    if (body.classification !== undefined) {
      update["sourceCategory"] = classificationToSourceCategory(body.classification);
    }
    if (body.url !== undefined) {
      update["competitorUrl"] = body.url;
      update["competitorUrlSource"] = "manual";
    }

    if (body.threatLevel !== undefined) {
      const previousLevel = profile.threatLevel || "none";
      update["threatLevel"] = body.threatLevel;
      // Record history if the threat level changed (routes.ts:8885 port)
      if (previousLevel !== body.threatLevel) {
        await storage.createCompetitorThreatLevelHistory({
          productId: product.id,
          competitorProfileId: profile.id,
          competitorName: profile.competitorName,
          previousLevel,
          newLevel: body.threatLevel,
        });
      }
    }

    const updated = await storage.updateCompetitorProfile(profile.id, update);
    res.json({ competitor: toCompetitorCard(updated) });
  }));

  // GET /api/changes?limit&offset — product-wide change feed
  router.get("/changes", asyncHandler(async (req, res) => {
    const product = await findProduct(req.ctx.organizationId);
    if (!product) {
      res.json({ changes: [], total: 0 });
      return;
    }
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "20"), 10) || 20, 1), 100);
    const offset = Math.max(parseInt(String(req.query["offset"] ?? "0"), 10) || 0, 0);
    const daysLimit = parseInt(String(req.query["days"] ?? "30"), 10) || 30;

    // The feed must never include changes from proposed competitors (spec 2.4
    // gate) — their draft changes stay on the proposal card (GET /:id) only.
    const profiles = await storage.getCompetitorProfilesByProduct(product.id);
    const proposedNames = profiles.filter(p => p.status === "proposed").map(p => p.competitorName);

    const result = await storage.getCompetitorChangesByProductPaginated(product.id, {
      limit,
      offset,
      daysLimit,
      excludeCompetitorNames: proposedNames,
    });
    res.json({ changes: result.changes.map(toChange), total: result.total });
  }));

  app.use("/api", router);
}
