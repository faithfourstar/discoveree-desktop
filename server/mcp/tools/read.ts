/**
 * The ten read tools (ADR 005 §2.2) — thin wrappers over module services and
 * the EXISTING route serialisers (MCP never invents a second projection).
 * Consumption-grade per §2.4: stable IDs, citations, ISO freshness stamps,
 * honest absence, and the `_context` envelope on every response.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import { z } from "zod/v4";
import type { FeedbackTheme, Product } from "@shared/schema";
import { getProductsByOrganization } from "../../modules/products/storage.js";
import { toProductView } from "../../modules/products/routes.js";
import * as competitorsStorage from "../../modules/competitors/storage.js";
import {
  alsoTrackedByForEntities,
  buildCompetitorDetailPayload,
  toCompetitorCard,
} from "../../modules/competitors/routes.js";
import { normalizeCompetitorName } from "../../modules/competitors/service.js";
import * as customersStorage from "../../modules/customers/storage.js";
import {
  buildSegmentDetailPayload,
  sourceNamesForThemes,
  toFeedbackView,
  toSegmentCard,
  toThemeView,
} from "../../modules/customers/routes.js";
import { THEME_SOFT_CAP } from "../../modules/customers/service.js";
import { normalizeSegmentName } from "../../modules/customers/normalization.js";
import { clampLimit, McpToolError, resolveProductParam, withContext } from "../payloads.js";
import { registerToolDef, type McpToolCtx } from "../registry.js";

const productParam = {
  product: z.string().optional().describe("Product id or slug. Omit when the workspace has exactly one product."),
};

async function resolveProduct(ctx: McpToolCtx, args: Record<string, unknown>): Promise<Product> {
  return resolveProductParam(ctx.organizationId, args["product"] as string | undefined, ctx.productPin);
}

// ── list_products (org-level) ───────────────────────────────────────────────

registerToolDef({
  name: "list_products",
  title: "List products",
  description: "List the products in this Discoveree workspace (id, slug, name, description, url). Org-level — takes no product parameter.",
  category: "read",
  inputSchema: {},
  handler: async (ctx) => {
    const products = await getProductsByOrganization(ctx.organizationId);
    return withContext({ products: products.map(toProductView) }, null);
  },
});

// ── get_context_health (computed, never synthesised — ADR 005 §2.6) ─────────

registerToolDef({
  name: "get_context_health",
  title: "Get context health",
  description: "The Context Health summary for a product: per-module counts, freshness stamps, staleness flags, pending intel proposals and the unfiled feedback count. Computed, never generated — call this first in a fresh conversation.",
  category: "read",
  inputSchema: { ...productParam },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    const STALE_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const facets = await competitorsStorage.getFacetsWithEntitiesByProduct(product.id);
    const competitorFacets = facets.filter(f => f.profile.sourceCategory !== "own_product");
    const trackedCompetitors = competitorFacets.filter(f => f.profile.status === "tracked");
    const staleCompetitors = trackedCompetitors.filter(f =>
      !f.profile.lastEnrichedAt || now - new Date(f.profile.lastEnrichedAt).getTime() > STALE_MS);
    const changeFeed = await competitorsStorage.getCompetitorChangesForProductPaginated(product.id, { limit: 1, offset: 0, daysLimit: 3650 });

    const segments = await customersStorage.getSegmentFacetsWithEntitiesByProduct(product.id);
    const themes = await customersStorage.getFeedbackThemesByProduct(product.id);
    const unfiled = await customersStorage.getUnfiledFeedbackEntries(product.id);
    const feedbackCount = await customersStorage.countFeedbackEntriesByProduct(product.id);
    const recentFeedback = await customersStorage.getFeedbackEntriesByProduct(product.id, { limit: 1 });
    const pendingProposals = await competitorsStorage.countPendingIntelProposals(product.id);

    return withContext({
      product: { id: product.id, name: product.name, updatedAt: product.updatedAt ? new Date(product.updatedAt).toISOString() : null },
      competitors: {
        tracked: trackedCompetitors.length,
        proposed: competitorFacets.filter(f => f.profile.status === "proposed").length,
        staleCount: staleCompetitors.length,
        newestChangeAt: changeFeed.changes[0]?.detectedAt ? new Date(changeFeed.changes[0].detectedAt).toISOString() : null,
      },
      segments: {
        tracked: segments.filter(s => s.facet.status === "tracked").length,
        proposed: segments.filter(s => s.facet.status === "proposed").length,
      },
      themes: {
        count: themes.length,
        unfiledCount: unfiled.length,
        consolidationSuggested: themes.filter(t => t.status !== "dismissed").length >= THEME_SOFT_CAP,
      },
      feedback: {
        count: feedbackCount,
        newestAt: recentFeedback[0]?.collectedAt ? new Date(recentFeedback[0].collectedAt).toISOString() : null,
      },
      intelProposals: { pending: pendingProposals },
      seat: { seat: ctx.caller.seat },
    }, product);
  },
});

// ── get_product_profile ─────────────────────────────────────────────────────

registerToolDef({
  name: "get_product_profile",
  title: "Get product profile",
  description: "The product's own profile context: name, description, url, markets, audience, business model — with its updatedAt freshness stamp.",
  category: "read",
  inputSchema: { ...productParam },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    return withContext({
      profile: {
        ...toProductView(product),
        markets: product.markets ?? null,
        audience: product.audience ?? null,
        businessModel: product.businessModel ?? null,
        distribution: product.distribution ?? null,
        updatedAt: product.updatedAt ? new Date(product.updatedAt).toISOString() : null,
      },
    }, product);
  },
});

// ── list_competitors ────────────────────────────────────────────────────────

registerToolDef({
  name: "list_competitors",
  title: "List competitors",
  description: "The product's competitor cards: stable facet ids, entity lineage, threat level, classification, review sentiment, freshness stamps and which sibling products also track each entity.",
  category: "read",
  inputSchema: {
    ...productParam,
    include_proposed: z.boolean().optional().describe("Include proposed (not yet accepted) competitors. Default false."),
  },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    const joined = await competitorsStorage.getFacetsWithEntitiesByProduct(product.id);
    const visible = joined
      .filter(j => j.profile.sourceCategory !== "own_product")
      .filter(j => args["include_proposed"] === true || j.profile.status !== "proposed");
    const alsoTracked = await alsoTrackedByForEntities(ctx.organizationId, visible.map(j => j.entity.id), product.id);
    return withContext({
      competitors: visible.map(j => toCompetitorCard(j, alsoTracked.get(j.entity.id) ?? [])),
    }, product);
  },
});

// ── get_competitor (id OR name — ADR 005 §2.5) ──────────────────────────────

registerToolDef({
  name: "get_competitor",
  title: "Get competitor",
  description: "One competitor in full: entity facts with per-feature source URLs, pricing with its source, the facet's differentiators, the 'what buyers say' reviews block (quotes with URLs and verified flags) and monitoring stamps. Accepts the facet id or the competitor's name.",
  category: "read",
  inputSchema: {
    ...productParam,
    competitor: z.string().min(1).describe("The competitor's facet id (preferred, stable) or its name."),
  },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    const ref = String(args["competitor"]);

    // Id lookup first, then normalised-name lookup across both tree levels.
    let joined = await competitorsStorage.getFacetWithEntityById(ref);
    if (joined && joined.profile.productId !== product.id) joined = undefined;
    if (!joined) {
      const entity = await competitorsStorage.findCompetitorEntityByNormalizedName(
        ctx.organizationId, normalizeCompetitorName(ref));
      if (entity) {
        const profile = await competitorsStorage.getCompetitorProfileByProductAndEntity(product.id, entity.id);
        if (profile) joined = await competitorsStorage.getFacetWithEntityById(profile.id);
      }
    }
    if (!joined) {
      const all = await competitorsStorage.getFacetsWithEntitiesByProduct(product.id);
      throw new McpToolError({
        error: "competitor_not_found",
        message: `No competitor matches "${ref}" for ${product.name}.`,
        candidates: all
          .filter(j => j.profile.sourceCategory !== "own_product")
          .map(j => ({ id: j.profile.id, name: j.entity.name })),
      });
    }

    const alsoTracked = await alsoTrackedByForEntities(ctx.organizationId, [joined.entity.id], product.id);
    const changes = await competitorsStorage.getCompetitorChangesByEntity(joined.entity.id, 20);
    return withContext({
      competitor: buildCompetitorDetailPayload(joined, alsoTracked.get(joined.entity.id) ?? []),
      recentChanges: changes.map(c => ({
        id: c.id,
        changeType: c.changeType,
        changeTitle: c.changeTitle,
        changeDescription: c.changeDescription ?? "",
        sourceUrl: c.sourceUrl ?? null,
        urlVerified: c.urlVerified ?? null,
        detectedAt: c.detectedAt ? new Date(c.detectedAt).toISOString() : null,
      })),
    }, product);
  },
});

// ── list_competitor_changes ─────────────────────────────────────────────────

registerToolDef({
  name: "list_competitor_changes",
  title: "List competitor changes",
  description: "The product's competitor change feed (entity-joined, tracked competitors only): releases, pricing moves, announcements — each with source URL, verification flag and detection stamp.",
  category: "read",
  inputSchema: {
    ...productParam,
    limit: z.number().int().optional().describe("Max items, up to 100. Default 20."),
    since: z.string().optional().describe("ISO date — only changes detected on or after it."),
  },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    const limit = clampLimit(args["limit"] as number | undefined, 20, 100);
    let daysLimit = 30;
    if (args["since"]) {
      const since = new Date(String(args["since"]));
      if (Number.isNaN(since.getTime())) {
        throw new McpToolError({ error: "invalid_since", message: `"${String(args["since"])}" is not a valid ISO date.` });
      }
      daysLimit = Math.max(1, Math.ceil((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)));
    }
    const feed = await competitorsStorage.getCompetitorChangesForProductPaginated(product.id, { limit, offset: 0, daysLimit });
    return withContext({
      changes: feed.changes.map(c => ({
        id: c.id,
        entityId: c.entityId,
        competitorName: c.competitorName,
        changeType: c.changeType,
        changeTitle: c.changeTitle,
        changeDescription: c.changeDescription ?? "",
        sourceUrl: c.sourceUrl ?? null,
        urlVerified: c.urlVerified ?? null,
        stream: c.stream ?? null,
        severity: c.severity ?? null,
        detectedAt: c.detectedAt ? new Date(c.detectedAt).toISOString() : null,
      })),
      total: feed.total,
    }, product);
  },
});

// ── list_segments ───────────────────────────────────────────────────────────

registerToolDef({
  name: "list_segments",
  title: "List segments",
  description: "The product's customer segment cards, each with its honest evidenceStatus (evidence counts, distinct sources, thresholds, what the evidence currently supports). Absence of evidence is stated, never papered over.",
  category: "read",
  inputSchema: {
    ...productParam,
    include_proposed: z.boolean().optional().describe("Include proposed (not yet accepted) segments. Default false."),
  },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    const joined = await customersStorage.getSegmentFacetsWithEntitiesByProduct(product.id);
    const visible = joined.filter(j => args["include_proposed"] === true || j.facet.status !== "proposed");
    const segments = [];
    for (const { facet, entity } of visible) {
      const personas = await customersStorage.getPersonasWithFacetsForProduct(entity.id, product.id);
      segments.push(await toSegmentCard(facet, entity, personas.length));
    }
    return withContext({ segments }, product);
  },
});

// ── get_segment (id OR name) ────────────────────────────────────────────────

registerToolDef({
  name: "get_segment",
  title: "Get segment",
  description: "One segment in full: needs and jobs-to-be-done with their evidence references, personas (owner or agent provenance) with goals and pain points, quotes with URLs, and the computed satisfaction. Accepts the segment's facet id or its name.",
  category: "read",
  inputSchema: {
    ...productParam,
    segment: z.string().min(1).describe("The segment's facet id (preferred, stable) or its name."),
  },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    const ref = String(args["segment"]);

    let facet = await customersStorage.getSegmentFacetById(ref);
    if (facet && facet.productId !== product.id) facet = undefined;
    if (!facet) {
      const entity = await customersStorage.findSegmentEntityByNormalizedName(
        ctx.organizationId, normalizeSegmentName(ref));
      if (entity) {
        facet = await customersStorage.getSegmentFacetByProductAndEntity(product.id, entity.id);
      }
    }
    if (!facet) {
      const all = await customersStorage.getSegmentFacetsWithEntitiesByProduct(product.id);
      throw new McpToolError({
        error: "segment_not_found",
        message: `No segment matches "${ref}" for ${product.name}.`,
        candidates: all.map(j => ({ id: j.facet.id, name: j.entity.name })),
      });
    }
    const entity = (await customersStorage.getSegmentEntityById(facet.segmentEntityId))!;
    return withContext({
      segment: await buildSegmentDetailPayload(product.id, facet, entity),
    }, product);
  },
});

// ── list_feedback_themes ────────────────────────────────────────────────────

registerToolDef({
  name: "list_feedback_themes",
  title: "List feedback themes",
  description: "The product's stable feedback theme catalogue with evidence counts, distinct sources, confidence/coherence, aliases from human merges, and the honest count of unfiled feedback entries.",
  category: "read",
  inputSchema: { ...productParam },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    const themes = await customersStorage.getFeedbackThemesByProduct(product.id);
    const unfiledCount = (await customersStorage.getUnfiledFeedbackEntries(product.id)).length;
    const consolidationSuggested = themes.filter((t: FeedbackTheme) => t.status !== "dismissed").length >= THEME_SOFT_CAP;
    const sourceNames = await sourceNamesForThemes(themes);
    return withContext({
      themes: themes.map((t: FeedbackTheme) => toThemeView(t, consolidationSuggested, sourceNames)),
      unfiledCount,
    }, product);
  },
});

// ── list_feedback ───────────────────────────────────────────────────────────

registerToolDef({
  name: "list_feedback",
  title: "List feedback",
  description: "Raw feedback entries: verbatim quotes with source names/URLs, verification flags, sentiment, when they were authored (sourceCreatedAt — null means the source showed no date) and when they were collected. Filterable by theme, topic, or competitor flag.",
  category: "read",
  inputSchema: {
    ...productParam,
    theme_id: z.string().optional().describe("Only entries belonging to this theme."),
    topic: z.string().optional(),
    is_competitor: z.boolean().optional(),
    since: z.string().optional().describe("ISO date — only entries collected on or after it."),
    limit: z.number().int().optional().describe("Max entries, up to 200. Default 50."),
    offset: z.number().int().optional(),
  },
  handler: async (ctx, args) => {
    const product = await resolveProduct(ctx, args);
    const limit = clampLimit(args["limit"] as number | undefined, 50, 200);
    const offset = Math.max(0, Math.trunc((args["offset"] as number | undefined) ?? 0));

    const options: Parameters<typeof customersStorage.getFeedbackEntriesByProduct>[1] = {};
    if (args["topic"]) options.topic = String(args["topic"]);
    if (args["is_competitor"] !== undefined) options.isCompetitor = args["is_competitor"] === true;
    let entries = await customersStorage.getFeedbackEntriesByProduct(product.id, options);

    if (args["theme_id"]) {
      const theme = await customersStorage.getFeedbackThemeById(String(args["theme_id"]));
      if (!theme || theme.productId !== product.id) {
        throw new McpToolError({ error: "theme_not_found", message: `No theme matches "${String(args["theme_id"])}".` });
      }
      const memberIds = new Set((theme.feedbackEntryIds as string[] | null) ?? []);
      entries = entries.filter(e => memberIds.has(e.id));
    }
    if (args["since"]) {
      const since = new Date(String(args["since"]));
      if (Number.isNaN(since.getTime())) {
        throw new McpToolError({ error: "invalid_since", message: `"${String(args["since"])}" is not a valid ISO date.` });
      }
      entries = entries.filter(e => e.collectedAt && new Date(e.collectedAt) >= since);
    }

    const total = entries.length;
    const page = entries.slice(offset, offset + limit);
    return withContext({
      entries: page.map(toFeedbackView),
      total,
      nextOffset: offset + page.length < total ? offset + page.length : null,
    }, product);
  },
});

// Registration side-effect module: importing this file registers the tools.
