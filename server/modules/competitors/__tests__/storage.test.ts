/**
 * Carved competitor storage against in-memory PGlite: the verbatim method
 * bodies must behave exactly as the SaaS versions — in particular
 * upsertCompetitorProfile's "merge, don't replace" null/empty-array stripping.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { createProduct } from "../../products/storage.js";
import * as storage from "../storage.js";

let productId: string;

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  const product = await createProduct({
    organizationId: LOCAL_ORGANIZATION_ID,
    name: "Test product",
    slug: "test-product",
  });
  productId = product.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe("upsertCompetitorProfile (merge, don't replace)", () => {
  it("Given an enriched profile, When a partial agent run upserts nulls and empty arrays, Then existing data survives", async () => {
    const created = await storage.upsertCompetitorProfile({
      productId,
      competitorName: "MergeCo",
      competitorUrl: "https://mergeco.example",
      description: "Original description",
      keyDifferentiators: ["Original differentiator"],
      sourceCategory: "competitor",
    });
    expect(created.id).toBeTruthy();

    // A failed/partial run writes nulls and empty arrays — they must be stripped.
    const merged = await storage.upsertCompetitorProfile({
      productId,
      competitorName: "MergeCo",
      description: null,
      keyDifferentiators: [],
      competitorUrl: null,
      threatLevel: "watch", // real change comes through
    });

    expect(merged.id).toBe(created.id); // same row — no silent duplicates
    expect(merged.description).toBe("Original description");
    expect(merged.keyDifferentiators).toEqual(["Original differentiator"]);
    expect(merged.competitorUrl).toBe("https://mergeco.example");
    expect(merged.threatLevel).toBe("watch");
  });

  it("Given no existing profile, When upserted, Then a new row is created with defaults", async () => {
    const profile = await storage.upsertCompetitorProfile({
      productId,
      competitorName: "FreshCo",
      sourceCategory: "adjacent",
      enrichmentStatus: "pending",
    });
    expect(profile.enrichmentStatus).toBe("pending");
    expect(profile.sourceCategory).toBe("adjacent");

    const fetched = await storage.getCompetitorProfileById(profile.id);
    expect(fetched?.competitorName).toBe("FreshCo");
  });
});

describe("competitor changes (paginated feed)", () => {
  it("Given a mix of changes, When paginated with limit/offset and filters, Then counts and ordering hold", async () => {
    for (let i = 0; i < 5; i++) {
      await storage.createCompetitorChange({
        productId,
        competitorName: i % 2 === 0 ? "MergeCo" : "FreshCo",
        sourceCategory: i % 2 === 0 ? "competitor" : "adjacent",
        changeType: "feature",
        changeTitle: `Change ${i}`,
        changeDescription: `Description ${i}`,
        sourceUrl: `https://example.com/change/${i}`,
        stream: "product",
        severity: "minor",
      });
    }

    const page1 = await storage.getCompetitorChangesByProductPaginated(productId, { limit: 2, offset: 0 });
    expect(page1.changes).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);

    const page3 = await storage.getCompetitorChangesByProductPaginated(productId, { limit: 2, offset: 4 });
    expect(page3.changes).toHaveLength(1);
    expect(page3.hasMore).toBe(false);

    const filtered = await storage.getCompetitorChangesByProductPaginated(productId, {
      limit: 10,
      offset: 0,
      competitorFilter: "MergeCo",
    });
    expect(filtered.total).toBe(3);
    expect(filtered.changes.every(c => c.competitorName === "MergeCo")).toBe(true);

    const byCategory = await storage.getCompetitorChangesByProductPaginated(productId, {
      limit: 10,
      offset: 0,
      categoryFilter: "adjacent",
    });
    expect(byCategory.total).toBe(2);

    const searched = await storage.getCompetitorChangesByProductPaginated(productId, {
      limit: 10,
      offset: 0,
      search: "description 3",
    });
    expect(searched.total).toBe(1);
    expect(searched.changes[0]?.changeTitle).toBe("Change 3");

    const byName = await storage.getCompetitorChangesByProductAndName(productId, "FreshCo", 10);
    expect(byName).toHaveLength(2);
  });
});

describe("threat level history", () => {
  it("Given recorded changes, When queried by profile and by recent window, Then rows come back newest-first", async () => {
    const profile = await storage.getCompetitorProfile(productId, "MergeCo");
    await storage.createCompetitorThreatLevelHistory({
      productId,
      competitorProfileId: profile!.id,
      competitorName: "MergeCo",
      previousLevel: "none",
      newLevel: "watch",
    });
    await storage.createCompetitorThreatLevelHistory({
      productId,
      competitorProfileId: profile!.id,
      competitorName: "MergeCo",
      previousLevel: "watch",
      newLevel: "big_threat",
    });

    const history = await storage.getCompetitorThreatLevelHistory(profile!.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.newLevel).toBe("big_threat");

    const recent = await storage.getRecentThreatLevelChangesByProduct(productId, 30);
    expect(recent.length).toBeGreaterThanOrEqual(2);
  });
});

describe("delete by id (stable-ID surface)", () => {
  it("Given a profile, When deleted by id, Then it is gone and other rows survive", async () => {
    const doomed = await storage.upsertCompetitorProfile({
      productId,
      competitorName: "DoomedCo",
      sourceCategory: "competitor",
    });
    await storage.deleteCompetitorProfileById(doomed.id);
    expect(await storage.getCompetitorProfileById(doomed.id)).toBeUndefined();
    expect(await storage.getCompetitorProfile(productId, "MergeCo")).toBeDefined();
  });
});
