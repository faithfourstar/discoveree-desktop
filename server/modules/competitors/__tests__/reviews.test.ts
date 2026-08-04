/**
 * Competitor review mining as the third ENTITY-kind agent (ADR 004 §2/§6.4):
 * mined once per org per entity node, conditional-merge onto the entity
 * review columns, and the card/detail contract fields ADR 002 §6 reserved
 * (sentiment, reviewCount, the "What buyers say" block) filled from them.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const mockState = vi.hoisted(() => ({
  reviewsResult: null as unknown,
}));

vi.mock("../../../lib/llm/router.js", () => ({
  callLLM: vi.fn(async (config: { agentSlug?: string }) => {
    const base = { promptTokens: 1, completionTokens: 1, model: "mock", provider: "gemini" as const };
    if (config.agentSlug === "competitor-reviews-agent") {
      return { ...base, text: JSON.stringify(mockState.reviewsResult ?? null) };
    }
    if (config.agentSlug === "competitor-summary-agent") {
      return { ...base, text: JSON.stringify({ summary: "Acme is a project management tool." }) };
    }
    if (config.agentSlug === "competitor-features-agent") {
      return { ...base, text: JSON.stringify({ features: [] }) };
    }
    return { ...base, text: JSON.stringify({ updates: [], searchSummary: "" }) };
  }),
  clearLlmClientCaches: vi.fn(),
  collectAllowedSourceUrls: vi.fn(() => new Set<string>()),
  enforceSourceUrlAllowList: vi.fn((value: unknown) => ({ value, stripped: [] })),
}));

vi.mock("../../../lib/web/fetch.js", () => ({
  validateUrlWithSoft404Detection: vi.fn(async (url: string) =>
    url.includes("dead-link") ? null : url),
  validateUrlsWithSoft404Detection: vi.fn(async (urls: string[]) => urls),
  fetchViaJina: vi.fn(async () => null),
}));

import { buildApp } from "../../../app.js";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { seedAgents } from "../../../lib/agents/seed.js";
import { runReviewsScanForEntity, settleBackgroundTasks } from "../service.js";
import * as storage from "../storage.js";

let app: Express;
let productId: string;
let competitorId: string;
let entityId: string;

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  await seedAgents();
  app = buildApp();

  const product = await request(app).post("/api/products").send({ name: "Our Product" });
  productId = product.body.product.id;
  const comp = await request(app)
    .post(`/api/products/${productId}/competitors`)
    .send({ name: "Acme", url: "https://acme.example", classification: "DIRECT" });
  competitorId = comp.body.competitor.id;
  entityId = comp.body.competitor.entityId;
  await settleBackgroundTasks();
  await request(app).post(`/api/products/${productId}/competitors/${competitorId}/accept`);
});

afterAll(async () => {
  await settleBackgroundTasks();
  await closeDatabase();
});

describe("runReviewsScanForEntity (entity-scoped, conditional merge)", () => {
  it("writes the entity review columns; a dead quote URL is cleared, never faked", async () => {
    mockState.reviewsResult = {
      averageRating: 4.4,
      totalReviews: 312,
      platforms: [
        { name: "G2", url: "https://www.g2.com/products/acme/reviews", rating: 4.5, reviewCount: 200 },
        { name: "Capterra", url: "https://capterra.example/dead-link", rating: 4.2, reviewCount: 112 },
      ],
      positiveThemes: ["Easy to use", "Great support"],
      negativeThemes: ["Expensive", "Limited integrations"],
      quotes: [
        { text: "Support replies within the hour, every time.", source: "G2", sourceUrl: "https://www.g2.com/products/acme/reviews#r1", rating: 5, date: "2026-04-10" },
        { text: "Pricing stings once you add seats.", source: "Capterra", sourceUrl: "https://capterra.example/dead-link#r2", rating: 3, date: "2026-02-01" },
      ],
    };

    const result = await runReviewsScanForEntity(LOCAL_ORGANIZATION_ID, entityId);
    expect(result.processed).toBe(true);

    const entity = await storage.getCompetitorEntityById(entityId);
    expect(entity!.reviewAverageRating).toBe(4.4);
    expect(entity!.reviewTotalCount).toBe(312);
    expect(entity!.reviewPositiveThemes).toEqual(["Easy to use", "Great support"]);
    expect(entity!.reviewNegativeThemes).toEqual(["Expensive", "Limited integrations"]);

    const reviews = entity!.reviews as Array<{ text: string; sourceUrl: string; verified: boolean; sentiment: number | null }>;
    expect(reviews).toHaveLength(2);
    // rating × 20 sentiment derivation; the dead URL was cleared and flagged.
    expect(reviews[0]).toMatchObject({ sentiment: 100, verified: true });
    expect(reviews[1]).toMatchObject({ sourceUrl: "", verified: false, sentiment: 60 });

    // The dead Capterra platform URL fell back to a known search URL.
    const platforms = entity!.reviewPlatforms as Array<{ name: string; url: string }>;
    expect(platforms.find(p => p.name === "Capterra")!.url).toContain("capterra.com/search");
  });

  it("card sentiment/reviewCount and the detail 'What buyers say' block serve the entity columns (§6.4)", async () => {
    const list = await request(app).get(`/api/products/${productId}/competitors`);
    expect(list.body.competitors[0]).toMatchObject({
      sentiment: 88, // 4.4 × 20 — no longer hardwired null
      reviewCount: 312,
    });

    const detail = await request(app).get(`/api/products/${productId}/competitors/${competitorId}`);
    const reviews = detail.body.competitor.reviews;
    expect(reviews).toMatchObject({ averageRating: 4.4, totalCount: 312 });
    expect(reviews.positiveThemes).toContain("Easy to use");
    expect(reviews.quotes).toHaveLength(2);
    expect(reviews.quotes[0]).toMatchObject({ verified: true });
    expect(reviews.quotes[1]).toMatchObject({ verified: false, sourceUrl: "" }); // flagged, not laundered
  });

  it("conditional merge: an incomplete later run never wipes cached review data", async () => {
    mockState.reviewsResult = {
      averageRating: null,
      totalReviews: null,
      platforms: [],
      positiveThemes: [],
      negativeThemes: ["New complaint about exports"],
      quotes: [],
    };

    await runReviewsScanForEntity(LOCAL_ORGANIZATION_ID, entityId);
    const entity = await storage.getCompetitorEntityById(entityId);
    // Only the field the run returned was overwritten.
    expect(entity!.reviewNegativeThemes).toEqual(["New complaint about exports"]);
    expect(entity!.reviewAverageRating).toBe(4.4);
    expect(entity!.reviewTotalCount).toBe(312);
    expect((entity!.reviews as unknown[]).length).toBe(2);
    expect(entity!.reviewPositiveThemes).toEqual(["Easy to use", "Great support"]);
  });

  it("the entity-agent target list includes the tracked entity for the competitorReviews key", async () => {
    const { listEntityAgentTargets } = await import("../service.js");
    const targets = await listEntityAgentTargets("competitorReviews");
    expect(targets.some(t => t.entityId === entityId)).toBe(true);
  });
});
